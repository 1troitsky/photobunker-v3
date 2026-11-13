<?php
declare(strict_types=1);

namespace Tests\Feature;

use App\Identity\Protocol;
use App\PublicCard\PublicationLedger;
use App\PublicCard\SignedPublicationIntent;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Carbon;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;
use OpenSSLAsymmetricKey;
use Symfony\Component\HttpKernel\Exception\HttpException;
use Tests\TestCase;

final class PublicCardGrantLedgerTest extends TestCase
{
    use RefreshDatabase;

    private const NOW = 1_800_000_000_000;
    private const ACCOUNT = '11111111-1111-4111-8111-111111111111';
    private const SOURCE = '22222222-2222-4222-8222-222222222222';
    private const SAFE = '33333333-3333-4333-8333-333333333333';

    private OpenSSLAsymmetricKey $key;
    private array $trusted;
    private array $intent;
    private PublicationLedger $ledger;

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
        ] as [$id, $hash, $expiry]) {
            DB::table('media_files_v1')->insert([
                'id' => $id, 'account_id' => self::ACCOUNT,
                'device_id' => $device, 'operation_id' => (string) Str::uuid(),
                'media_type' => 'photo', 'state' => 'active',
                'expires_at' => $expiry, 'plain_bytes' => 2048,
                'cipher_bytes' => 2112, 'contract_hash' => $hash,
                'contract_json' => '{}', 'signature' => 'fixture-signature',
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
            'safeDerivativeSha256' => hash('sha256', 'flattened-jpeg-fixture'),
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
    }

    private static function canonical(array $data): string
    {
        return json_encode($data, JSON_UNESCAPED_SLASHES | JSON_THROW_ON_ERROR);
    }

    private function sign(string $domain, string $json, ?OpenSSLAsymmetricKey $key = null): string
    {
        self::assertTrue(openssl_sign($domain.$json, $der, $key ?? $this->key, OPENSSL_ALGO_SHA256));
        $offset = 2;
        $raw = '';
        for ($i = 0; $i < 2; $i++) {
            self::assertSame(2, ord($der[$offset++]));
            $len = ord($der[$offset++]);
            $integer = ltrim(substr($der, $offset, $len), "\x00");
            self::assertLessThanOrEqual(32, strlen($integer));
            $raw .= str_pad($integer, 32, "\x00", STR_PAD_LEFT);
            $offset += $len;
        }
        return Protocol::encode($raw);
    }

    private function stage(?array $c = null, ?array $trusted = null): array
    {
        $json = self::canonical($c ?? $this->intent);
        return $this->ledger->stage(
            $json, $this->sign(SignedPublicationIntent::DOMAIN, $json),
            $trusted ?? $this->trusted
        );
    }

    private function revokePayload(array $staged): array
    {
        return [
            'version' => 1, 'operationId' => (string) Str::uuid(),
            'accountId' => self::ACCOUNT, 'safeMediaId' => self::SAFE,
            'tokenHash' => $this->intent['tokenHash'],
            'expectedRevision' => $staged['revision'] + 1,
            'previousEventHash' => $staged['eventHash'],
            'action' => 'revoke',
        ];
    }

    private function revoke(array $payload, ?OpenSSLAsymmetricKey $key = null): array
    {
        $json = self::canonical($payload);
        return $this->ledger->revoke(
            $json, $this->sign(PublicationLedger::REVOKE_DOMAIN, $json, $key)
        );
    }

    private function rejected(callable $action, int $expectedStatus): void
    {
        try {
            $action();
            self::fail('Unsafe publication operation was accepted');
        } catch (HttpException $failure) {
            self::assertSame($expectedStatus, $failure->getStatusCode());
        }
    }

    public function test_stage_is_append_only_private_audit_and_never_public_access(): void
    {
        $res = $this->stage();
        self::assertSame('staged', $res['state']);
        self::assertFalse($res['published']);
        self::assertFalse($res['unchanged']);
        self::assertSame(1, $res['revision']);
        $ownerStatus = $this->ledger->statusForOwner(self::ACCOUNT, self::SAFE);
        self::assertTrue($ownerStatus['unchanged']);
        self::assertSame($res['eventHash'], $ownerStatus['eventHash']);
        self::assertSame('staged', $ownerStatus['state']);
        self::assertSame(1, DB::table('public_card_intent_events_v1')->count());
        self::assertSame(1, DB::table('public_card_token_reservations_v1')->count());
        self::assertDatabaseHas('public_card_intent_heads_v1', [
            'safe_media_id' => self::SAFE, 'revision' => 1, 'state' => 'staged',
        ]);
        self::assertDatabaseMissing('public_card_intent_heads_v1', ['state' => 'published']);
    }

    public function test_lost_ack_replay_has_no_duplicate_event_or_token_reservation(): void
    {
        $original = $this->stage();
        $replayed = $this->stage();
        self::assertTrue($replayed['unchanged']);
        self::assertSame($original['eventHash'], $replayed['eventHash']);
        self::assertSame(1, DB::table('public_card_intent_events_v1')->count());
        self::assertSame(1, DB::table('public_card_token_reservations_v1')->count());
        $edited = $this->intent;
        $edited['safeDerivativeSha256'] = str_repeat('f', 64);
        $this->rejected(fn () => $this->stage($edited), 409);
    }

    public function test_signed_revoke_is_monotone_and_replay_cannot_resurrect_staged_token(): void
    {
        $staged = $this->stage();
        $revoke = $this->revokePayload($staged);
        $result = $this->revoke($revoke);
        self::assertSame('revoked', $result['state']);
        self::assertSame(2, $result['revision']);
        self::assertFalse($result['published']);
        self::assertSame($staged['eventHash'], DB::table('public_card_intent_events_v1')
            ->where('revision', 2)->value('previous_event_hash'));
        self::assertTrue($this->revoke($revoke)['unchanged']);
        self::assertSame(2, DB::table('public_card_intent_events_v1')->count());
        self::assertSame(1, DB::table('public_card_token_reservations_v1')->count());
        self::assertSame('revoked', $this->stage()['state']);
    }

    public function test_revoked_token_hash_cannot_be_reused_after_new_signed_revision(): void
    {
        $first = $this->stage();
        $revoked = $this->revoke($this->revokePayload($first));
        $new = $this->intent;
        $new['operationId'] = (string) Str::uuid();
        $new['revision'] = 3;
        $this->trusted['expectedRevision'] = 3;
        $this->rejected(fn () => $this->stage($new), 409);
        self::assertSame(2, DB::table('public_card_intent_events_v1')->count());
        $new['tokenHash'] = hash('sha256', random_bytes(32));
        $staged = $this->stage($new);
        self::assertSame(3, $staged['revision']);
        self::assertSame('staged', $staged['state']);
        self::assertSame($revoked['eventHash'], DB::table('public_card_intent_events_v1')
            ->where('revision', 3)->value('previous_event_hash'));
        self::assertSame(2, DB::table('public_card_token_reservations_v1')->count());
    }

    public function test_stale_revoke_wrong_root_key_and_wrong_binding_are_denied(): void
    {
        $first = $this->stage();
        $revoke = $this->revokePayload($first);
        $other = openssl_pkey_new([
            'private_key_type' => OPENSSL_KEYTYPE_EC,
            'curve_name' => 'prime256v1',
        ]);
        $this->rejected(fn () => $this->revoke($revoke, $other), 401);
        $stale = $revoke;
        $stale['previousEventHash'] = str_repeat('e', 64);
        $this->rejected(fn () => $this->revoke($stale), 409);
        $stale = $revoke;
        $stale['expectedRevision'] = 3;
        $this->rejected(fn () => $this->revoke($stale), 409);
        self::assertSame(1, DB::table('public_card_intent_events_v1')->count());
    }

    public function test_media_state_and_database_account_are_checked_not_just_trusted_arrays(): void
    {
        DB::table('media_files_v1')->where('id', self::SAFE)
            ->update(['state' => 'deleting']);
        $this->rejected(fn () => $this->stage(), 409);
        DB::table('media_files_v1')->where('id', self::SAFE)
            ->update(['state' => 'active', 'expires_at' => self::NOW + 10_000]);
        $this->rejected(fn () => $this->stage(), 409);
        DB::table('media_files_v1')->where('id', self::SAFE)
            ->update(['expires_at' => self::NOW + 30_000]);
        DB::table('identity_accounts')->where('id', self::ACCOUNT)
            ->update(['status' => 'retired']);
        $this->rejected(fn () => $this->stage(), 403);
        self::assertSame(0, DB::table('public_card_intent_heads_v1')->count());
    }

    public function test_missing_media_archive_and_tombstone_block_staging(): void
    {
        DB::table('media_files_v1')->where('id', self::SAFE)->delete();
        $this->rejected(fn () => $this->stage(), 409);
        self::assertSame(0, DB::table('public_card_intent_events_v1')->count());
    }

    public function test_revoke_remains_possible_after_file_expiry_and_owner_status_is_scoped(): void
    {
        $first = $this->stage();
        $this->travelTo(Carbon::createFromTimestampUTC(1800000045));
        $done = $this->revoke($this->revokePayload($first));
        self::assertSame('revoked', $done['state']);
        $this->rejected(
            fn () => $this->ledger->statusForOwner(
                '55555555-5555-4555-8555-555555555555', self::SAFE
            ), 404
        );
    }

    public function test_no_signed_revoke_can_change_foreign_or_unknown_head(): void
    {
        $payload = $this->revokePayload([
            'revision' => 1, 'eventHash' => str_repeat('a', 64),
        ]);
        $this->rejected(fn () => $this->revoke($payload), 404);
        self::assertSame(0, DB::table('public_card_intent_events_v1')->count());
    }
}
