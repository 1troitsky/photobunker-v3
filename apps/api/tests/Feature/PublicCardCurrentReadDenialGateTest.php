<?php

declare(strict_types=1);

namespace Tests\Feature;

use App\Identity\Protocol;
use App\PublicCard\CurrentReadDenialGate;
use App\PublicCard\PublicationLedger;
use App\PublicCard\SignedPublicationIntent;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Carbon;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;
use OpenSSLAsymmetricKey;
use Symfony\Component\HttpKernel\Exception\HttpException;
use Tests\TestCase;

/**
 * No live Public Card route/issuer exists yet. Verify complete historic
 * P-256 signed events and ACTUAL SQL media/expiry/tombstone/archive on
 * an owner-private diagnostic. Anonymous access MUST ALWAYS be denied.
 */
final class PublicCardCurrentReadDenialGateTest extends TestCase
{
    use RefreshDatabase;

    private const NOW = 1_800_000_000_000;
    private const ACCOUNT = '11111111-1111-4111-8111-111111111111';
    private const SOURCE = '22222222-2222-4222-8222-222222222222';
    private const SAFE = '33333333-3333-4333-8333-333333333333';

    private OpenSSLAsymmetricKey $key;
    private CurrentReadDenialGate $gate;
    private PublicationLedger $ledger;
    private array $intent;
    private array $trusted;

    protected function setUp(): void
    {
        parent::setUp();
        $this->travelTo(Carbon::createFromTimestampUTC(1800000000));
        $this->key = openssl_pkey_new([
            'private_key_type' => OPENSSL_KEYTYPE_EC,
            'curve_name' => 'prime256v1',
        ]);
        $public = openssl_pkey_get_details($this->key)['key'];
        $spki = Protocol::encode(base64_decode(
            preg_replace('/-----[^-]+-----|\s+/', '', $public)
        ));
        DB::table('identity_accounts')->insert([
            'id' => self::ACCOUNT, 'operation_id' => (string) Str::uuid(),
            'prepare_hash' => str_repeat('c', 64), 'status' => 'ready',
            'account_spki' => $spki, 'reserved_until' => now()->addDays(1),
            'created_at' => now(), 'updated_at' => now(),
        ]);
        $device = (string) Str::uuid();
        DB::table('identity_devices')->insert([
            'id' => $device, 'account_id' => self::ACCOUNT,
            'signing_spki' => $spki, 'created_at' => now(), 'updated_at' => now(),
        ]);
        foreach ([
            [self::SOURCE, str_repeat('a', 64), self::NOW + 40_000],
            [self::SAFE, str_repeat('b', 64), self::NOW + 30_000],
        ] as [$mediaId, $contractHash, $expiration]) {
            DB::table('media_files_v1')->insert([
                'id' => $mediaId, 'account_id' => self::ACCOUNT,
                'device_id' => $device, 'operation_id' => (string) Str::uuid(),
                'media_type' => 'photo', 'state' => 'active',
                'expires_at' => $expiration, 'plain_bytes' => 2048,
                'cipher_bytes' => 2112, 'contract_hash' => $contractHash,
                'contract_json' => '{}', 'signature' => 'test-fixture',
                'created_at' => now(), 'updated_at' => now(),
            ]);
        }
        $fields = [
            'description' => true, 'capturedAt' => false,
            'updatedAt' => false, 'tags' => false,
            'authorTeam' => false, 'gps' => false, 'metadata' => false,
        ];
        $actions = [
            'view' => true, 'copy' => false,
            'download' => false, 'share' => false,
        ];
        $this->intent = [
            'version' => 1, 'operationId' => (string) Str::uuid(),
            'accountId' => self::ACCOUNT, 'sourceMediaId' => self::SOURCE,
            'safeMediaId' => self::SAFE,
            'sourceContractHash' => str_repeat('a', 64),
            'safeContractHash' => str_repeat('b', 64),
            'safeDerivativeSha256' => hash('sha256', 'only-signed-declaration'),
            'tokenHash' => hash('sha256', random_bytes(32)),
            'revision' => 1, 'scope' => 'safe-photo-view-v1',
            'expiresAt' => self::NOW + 10_000,
            'fields' => $fields, 'actions' => $actions,
        ];
        $this->trusted = [
            'accountId' => self::ACCOUNT, 'accountSpki' => $spki,
            'accountReady' => true, 'expectedRevision' => 1,
            'sourceMediaId' => self::SOURCE, 'safeMediaId' => self::SAFE,
            'sourceContractHash' => str_repeat('a', 64),
            'safeContractHash' => str_repeat('b', 64),
            'sourceActive' => true, 'safeActive' => true,
            'sourcePhoto' => true, 'safePhoto' => true,
            'sourceArchived' => false, 'safeArchived' => false,
            'sourceTombstoned' => false, 'safeTombstoned' => false,
            'sourceExpiresAt' => self::NOW + 40_000,
            'safeExpiresAt' => self::NOW + 30_000,
            'assignmentExpiresAt' => self::NOW + 20_000,
            'assignmentAllowsPublic' => true, 'fileAllowsPublic' => true,
            'assignmentFields' => $fields, 'fileFields' => $fields,
            'assignmentActions' => $actions, 'fileActions' => $actions,
        ];
        $this->ledger = new PublicationLedger();
        $this->gate = new CurrentReadDenialGate();
    }

    private static function canonicalJson(array $x): string
    {
        return json_encode($x, JSON_UNESCAPED_SLASHES | JSON_THROW_ON_ERROR);
    }

    private function sign(string $domain, string $raw): string
    {
        self::assertTrue(openssl_sign($domain.$raw, $der, $this->key, OPENSSL_ALGO_SHA256));
        $offset = 2;
        $result = '';
        for ($n = 0; $n < 2; $n++) {
            self::assertSame(2, ord($der[$offset++]));
            $length = ord($der[$offset++]);
            $integer = ltrim(substr($der, $offset, $length), "\x00");
            self::assertLessThanOrEqual(32, strlen($integer));
            $result .= str_pad($integer, 32, "\x00", STR_PAD_LEFT);
            $offset += $length;
        }
        return Protocol::encode($result);
    }

    private function stage(?array $intent = null): array
    {
        $c = $intent ?? $this->intent;
        $raw = self::canonicalJson($c);
        return $this->ledger->stage(
            $raw, $this->sign(SignedPublicationIntent::DOMAIN, $raw),
            $this->trusted
        );
    }

    private function revoke(array $staged): array
    {
        $contract = [
            'version' => 1, 'operationId' => (string) Str::uuid(),
            'accountId' => self::ACCOUNT, 'safeMediaId' => self::SAFE,
            'tokenHash' => $this->intent['tokenHash'],
            'expectedRevision' => $staged['revision'] + 1,
            'previousEventHash' => $staged['eventHash'],
            'action' => 'revoke',
        ];
        $raw = self::canonicalJson($contract);
        return $this->ledger->revoke(
            $raw, $this->sign(PublicationLedger::REVOKE_DOMAIN, $raw)
        );
    }

    private function inspect(): array
    {
        return $this->gate->inspectForOwner(self::ACCOUNT, self::SAFE);
    }

    private function rejected(callable $attempt, int $status): void
    {
        try {
            $attempt();
            self::fail('Unsafe Public Card operation accepted');
        } catch (HttpException $e) {
            self::assertSame($status, $e->getStatusCode());
        }
    }

    public function test_signed_staged_intent_is_private_only_and_opaque_hash_never_opens_reader(): void
    {
        $staged = $this->stage();
        $status = $this->inspect();
        self::assertSame('staged', $status['state']);
        self::assertSame(1, $status['revision']);
        self::assertSame($staged['eventHash'], $status['eventHash']);
        self::assertFalse($status['published']);
        self::assertFalse($status['publicAuthorized']);
        self::assertFalse($status['anonymousReadable']);
        $this->rejected(
            fn () => $this->gate->requireAnonymousRead($this->intent['tokenHash']),
            404
        );
        $this->rejected(
            fn () => $this->gate->requireAnonymousRead(hash('sha256', 'unknown')),
            404
        );
        self::assertSame(1, DB::table('public_card_token_reservations_v1')->count());
    }

    public function test_real_signed_revoke_still_private_and_anonymous_read_stays_denied(): void
    {
        $staged = $this->stage();
        $revoked = $this->revoke($staged);
        $status = $this->inspect();
        self::assertSame('revoked', $status['state']);
        self::assertSame(2, $status['revision']);
        self::assertSame($revoked['eventHash'], $status['eventHash']);
        self::assertFalse($status['anonymousReadable']);
        $this->rejected(
            fn () => $this->gate->requireAnonymousRead($this->intent['tokenHash']),
            404
        );
    }

    public function test_revoked_chain_is_still_auditable_after_photo_and_intent_expiry(): void
    {
        $first = $this->stage();
        $this->revoke($first);
        $this->travelTo(Carbon::createFromTimestampUTC(1800000045));
        self::assertSame('revoked', $this->inspect()['state']);
        $this->rejected(
            fn () => $this->gate->requireAnonymousRead($this->intent['tokenHash']),
            404
        );
    }

    public function test_staged_expiry_and_deleted_media_fail_live_check(): void
    {
        $this->stage();
        $this->travelTo(Carbon::createFromTimestampUTC(1800000015));
        $this->rejected(fn () => $this->inspect(), 410);
        $this->travelTo(Carbon::createFromTimestampUTC(1800000000));
        DB::table('media_files_v1')->where('id', self::SAFE)->update(['state' => 'deleting']);
        $this->rejected(fn () => $this->inspect(), 410);
    }

    public function test_active_source_and_safe_contract_hashes_checked_against_actual_rows(): void
    {
        $this->stage();
        DB::table('media_files_v1')->where('id', self::SOURCE)
            ->update(['contract_hash' => str_repeat('d', 64)]);
        $this->rejected(fn () => $this->inspect(), 410);
        DB::table('media_files_v1')->where('id', self::SOURCE)
            ->update(['contract_hash' => str_repeat('a', 64)]);
        DB::table('media_files_v1')->where('id', self::SAFE)
            ->update(['expires_at' => self::NOW - 1]);
        $this->rejected(fn () => $this->inspect(), 410);
    }

    public function test_archive_prevents_staged_read_snapshot_even_if_media_is_active(): void
    {
        $this->stage();
        DB::table('browser_archive_entries_v1')->insert([
            'id' => (string) Str::uuid(),
            'account_id' => self::ACCOUNT, 'kind' => 'media',
            'asset_id' => self::SAFE, 'revision' => 1, 'state' => 'archived',
            'asset_expires_at_ms' => self::NOW + 30_000,
            'media_type' => 'photo', 'plain_bytes' => 2048,
            'last_operation_id' => (string) Str::uuid(),
            'created_at' => now(), 'updated_at' => now(),
        ]);
        $this->rejected(fn () => $this->inspect(), 410);
    }

    public function test_media_tombstone_blocks_future_staged_snapshot(): void
    {
        $this->stage();
        DB::table('media_tombstones_v1')->insert([
            'media_id' => self::SAFE, 'account_id' => self::ACCOUNT,
            'operation_id' => (string) Str::uuid(), 'object_keys' => '[]',
            'next_sweep_at' => now()->addHour(), 'created_at' => now(),
        ]);
        $this->rejected(fn () => $this->inspect(), 410);
    }

    public function test_owner_scope_mismatch_and_unready_identity_denied(): void
    {
        $this->stage();
        $this->rejected(fn () => $this->gate->inspectForOwner(
            '44444444-4444-4444-8444-444444444444', self::SAFE
        ), 404);
        DB::table('identity_accounts')->where('id', self::ACCOUNT)
            ->update(['status' => 'retired']);
        $this->rejected(fn () => $this->inspect(), 404);
    }

    public function test_mutated_signed_event_payload_and_signature_detected(): void
    {
        $this->stage();
        DB::table('public_card_intent_events_v1')
            ->where('revision', 1)->update(['owner_signature' => Protocol::encode(str_repeat("\x00", 64))]);
        $this->rejected(fn () => $this->inspect(), 409);
    }

    public function test_mutated_head_event_hash_and_token_reservation_detected(): void
    {
        $this->stage();
        DB::table('public_card_intent_heads_v1')->where('safe_media_id', self::SAFE)
            ->update(['current_event_hash' => str_repeat('f', 64)]);
        $this->rejected(fn () => $this->inspect(), 409);
        DB::table('public_card_intent_heads_v1')->where('safe_media_id', self::SAFE)
            ->update(['current_event_hash' => DB::table('public_card_intent_events_v1')
                ->where('revision', 1)->value('event_hash')]);
        DB::table('public_card_token_reservations_v1')->where('token_hash', $this->intent['tokenHash'])
            ->update(['safe_media_id' => self::SOURCE]);
        $this->rejected(fn () => $this->inspect(), 409);
    }

    public function test_signed_chain_gap_wrong_previous_hash_and_fake_revoke_are_detected(): void
    {
        $first = $this->stage();
        $this->revoke($first);
        DB::table('public_card_intent_events_v1')->where('revision', 2)
            ->update(['previous_event_hash' => str_repeat('e', 64)]);
        $this->rejected(fn () => $this->inspect(), 409);
        DB::table('public_card_intent_events_v1')->where('revision', 2)->delete();
        $this->rejected(fn () => $this->inspect(), 409);
    }

    public function test_staged_replay_after_revocation_never_upgrades_public_permission(): void
    {
        $first = $this->stage();
        $this->revoke($first);
        self::assertSame('revoked', $this->stage()['state']);
        self::assertSame('revoked', $this->inspect()['state']);
        $this->rejected(
            fn () => $this->gate->requireAnonymousRead($this->intent['tokenHash']),
            404
        );
    }
}
