<?php
declare(strict_types=1);

namespace Tests\Feature;

use App\Identity\Protocol;
use App\PublicCard\SignedEditorialBindingAudit;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Carbon;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;
use OpenSSLAsymmetricKey;
use Symfony\Component\HttpKernel\Exception\HttpException;
use Tests\TestCase;

final class PublicCardSignedEditorialBindingAuditTest extends TestCase
{
    use RefreshDatabase;

    private const NOW = 1_800_000_000_000;
    private const OWNER = '11111111-1111-4111-8111-111111111111';
    private const SOURCE = '22222222-2222-4222-8222-222222222222';
    private const SAFE = '33333333-3333-4333-8333-333333333333';
    private const ASSIGNMENT = '44444444-4444-4444-8444-444444444444';
    private const LINK = '55555555-5555-4555-8555-555555555555';
    private const ZERO = '0000000000000000000000000000000000000000000000000000000000000000';

    private OpenSSLAsymmetricKey $key;
    private string $rootHash;
    private SignedEditorialBindingAudit $audit;

    protected function setUp(): void
    {
        parent::setUp();
        $this->travelTo(Carbon::createFromTimestampUTC(1800000000));
        $this->key = openssl_pkey_new([
            'private_key_type' => OPENSSL_KEYTYPE_EC,
            'curve_name' => 'prime256v1',
        ]);
        $spki = Protocol::encode(base64_decode(preg_replace(
            '/-----[^-]+-----|\s+/', '', openssl_pkey_get_details($this->key)['key']
        )));
        DB::table('identity_accounts')->insert([
            'id' => self::OWNER, 'operation_id' => (string) Str::uuid(),
            'prepare_hash' => str_repeat('c', 64), 'status' => 'ready',
            'account_spki' => $spki, 'reserved_until' => now()->addDay(),
            'created_at' => now(), 'updated_at' => now(),
        ]);
        $device = (string) Str::uuid();
        DB::table('identity_devices')->insert([
            'id' => $device, 'account_id' => self::OWNER,
            'signing_spki' => $spki, 'created_at' => now(), 'updated_at' => now(),
        ]);
        foreach ([
            [self::SOURCE, str_repeat('a', 64), self::NOW + 50_000],
            [self::SAFE, str_repeat('b', 64), self::NOW + 40_000],
        ] as [$id, $digest, $expiry]) {
            DB::table('media_files_v1')->insert([
                'id' => $id, 'account_id' => self::OWNER,
                'device_id' => $device, 'operation_id' => (string) Str::uuid(),
                'media_type' => 'photo', 'state' => 'active',
                'expires_at' => $expiry, 'plain_bytes' => 800,
                'cipher_bytes' => 816, 'contract_hash' => $digest,
                'contract_json' => '{}', 'signature' => 'fixture',
                'created_at' => now(), 'updated_at' => now(),
            ]);
        }
        $root = [
            'version' => 1, 'assignmentId' => self::ASSIGNMENT,
            'operationId' => (string) Str::uuid(), 'ownerAccountId' => self::OWNER,
            'revision' => 1, 'policyRevision' => 1, 'state' => 'active',
            'startsAt' => self::NOW - 1000, 'endsAt' => null,
            'photoGoal' => 30, 'allowedMedia' => ['photo'], 'privateEnvelope' => [],
        ];
        $json = self::canonical($root);
        $this->rootHash = hash('sha256', $json);
        DB::table('assignment_records_v1')->insert([
            'id' => self::ASSIGNMENT, 'owner_account_id' => self::OWNER,
            'operation_id' => $root['operationId'], 'contract_hash' => $this->rootHash,
            'contract_json' => $json,
            'owner_signature' => $this->sign("pb3.assignment.v1\n", $json),
            'private_envelope_json' => '{}', 'state' => 'active',
            'revision' => 1, 'policy_revision' => 1, 'starts_at' => self::NOW - 1000,
            'created_at' => now(), 'updated_at' => now(),
        ]);
        $this->persistCeiling('file');
        $this->persistCeiling('assignment');
        $this->persistLink();
        $this->audit = new SignedEditorialBindingAudit();
    }

    private static function canonical(array $contract): string
    {
        return json_encode($contract, JSON_UNESCAPED_SLASHES | JSON_THROW_ON_ERROR);
    }

    private function sign(string $domain, string $json): string
    {
        self::assertTrue(openssl_sign($domain.$json, $der, $this->key, OPENSSL_ALGO_SHA256));
        $offset = 2;
        $raw = '';
        for ($i = 0; $i < 2; $i++) {
            self::assertSame(2, ord($der[$offset++]));
            $len = ord($der[$offset++]);
            $number = ltrim(substr($der, $offset, $len), "\x00");
            self::assertLessThanOrEqual(32, strlen($number));
            $raw .= str_pad($number, 32, "\x00", STR_PAD_LEFT);
            $offset += $len;
        }
        return Protocol::encode($raw);
    }

    private function fields(string $kind): array
    {
        return [
            'description' => $kind === 'file',
            'capturedAt' => true,
            'updatedAt' => false,
            'tags' => false,
            'authorTeam' => false,
            'gps' => true,
            'metadata' => false,
        ];
    }

    private function persistCeiling(string $kind): void
    {
        $file = $kind === 'file';
        $contract = [
            'version' => 1,
            'operationId' => (string) Str::uuid(),
        ];
        if ($file) {
            $contract += [
                'accountId' => self::OWNER, 'sourceMediaId' => self::SOURCE,
                'safeMediaId' => self::SAFE,
                'sourceContractHash' => str_repeat('a', 64),
                'safeContractHash' => str_repeat('b', 64),
            ];
        } else {
            $contract += [
                'assignmentId' => self::ASSIGNMENT,
                'ownerAccountId' => self::OWNER,
                'rootPolicyHash' => $this->rootHash,
            ];
        }
        $contract += [
            'fromRevision' => 0, 'toRevision' => 1,
            'previousPolicyHash' => self::ZERO,
            'publication' => 'disabled', 'fields' => $this->fields($kind),
            'actions' => [
                'view' => false, 'copy' => false,
                'download' => false, 'share' => false,
            ],
            'expiresAt' => self::NOW + ($file ? 30_000 : 20_000),
        ];
        $json = self::canonical($contract);
        $sig = $this->sign(
            $file ? "pb3.media-file-preview-policy.v1\n"
                : "pb3.assignment-preview-ceiling.v1\n",
            $json
        );
        $hash = hash('sha256', $json);
        if ($file) {
            DB::table('media_file_preview_policy_events_v1')->insert([
                'operation_id' => $contract['operationId'],
                'account_id' => self::OWNER,
                'source_media_id' => self::SOURCE,
                'safe_media_id' => self::SAFE,
                'from_revision' => 0, 'to_revision' => 1,
                'previous_policy_hash' => self::ZERO,
                'contract_hash' => $hash, 'contract_json' => $json,
                'account_signature' => $sig, 'created_at' => now(),
            ]);
            DB::table('media_file_preview_policies_v1')->insert([
                'safe_media_id' => self::SAFE, 'account_id' => self::OWNER,
                'source_media_id' => self::SOURCE,
                'source_contract_hash' => str_repeat('a', 64),
                'safe_contract_hash' => str_repeat('b', 64),
                'revision' => 1, 'contract_hash' => $hash,
                'contract_json' => $json, 'account_signature' => $sig,
                'expires_at_ms' => $contract['expiresAt'],
                'created_at' => now(), 'updated_at' => now(),
            ]);
        } else {
            DB::table('assignment_preview_ceiling_events_v1')->insert([
                'operation_id' => $contract['operationId'],
                'assignment_id' => self::ASSIGNMENT,
                'owner_account_id' => self::OWNER,
                'from_revision' => 0, 'to_revision' => 1,
                'previous_policy_hash' => self::ZERO,
                'contract_hash' => $hash, 'contract_json' => $json,
                'owner_signature' => $sig, 'created_at' => now(),
            ]);
            DB::table('assignment_preview_ceilings_v1')->insert([
                'assignment_id' => self::ASSIGNMENT,
                'owner_account_id' => self::OWNER,
                'root_policy_hash' => $this->rootHash,
                'revision' => 1, 'contract_hash' => $hash,
                'contract_json' => $json, 'owner_signature' => $sig,
                'expires_at_ms' => $contract['expiresAt'],
                'created_at' => now(), 'updated_at' => now(),
            ]);
        }
    }

    private function linkJson(): string
    {
        return self::canonical([
            'version' => 1, 'linkId' => self::LINK,
            'operationId' => (string) Str::uuid(),
            'ownerAccountId' => self::OWNER,
            'assignmentId' => self::ASSIGNMENT,
            'sourceMediaId' => self::SOURCE,
            'safeMediaId' => self::SAFE,
            'sourceContractHash' => str_repeat('a', 64),
            'safeContractHash' => str_repeat('b', 64),
            'assignmentRootHash' => $this->rootHash,
            'expiresAt' => self::NOW + 10_000,
        ]);
    }

    private function persistLink(): void
    {
        $json = $this->linkJson();
        DB::table('safe_assignment_editorial_links_v1')->insert([
            'safe_media_id' => self::SAFE, 'link_id' => self::LINK,
            'owner_account_id' => self::OWNER,
            'assignment_id' => self::ASSIGNMENT,
            'source_media_id' => self::SOURCE,
            'source_contract_hash' => str_repeat('a', 64),
            'safe_contract_hash' => str_repeat('b', 64),
            'assignment_root_hash' => $this->rootHash,
            'contract_hash' => hash('sha256', $json),
            'contract_json' => $json,
            'account_signature' => $this->sign("pb3.safe-assignment-editorial-link.v1\n", $json),
            'state' => 'active', 'created_at' => now(), 'updated_at' => now(),
        ]);
    }

    private function inspect(): array
    {
        return $this->audit->inspect(self::OWNER, self::SAFE);
    }

    private function rejected(callable $operation, int $status): void
    {
        try {
            $operation();
            self::fail('Forged editorial binding unexpectedly accepted');
        } catch (HttpException $error) {
            self::assertSame($status, $error->getStatusCode());
        }
    }

    public function test_valid_signed_editorial_link_intersects_private_fields_but_never_publishes(): void
    {
        $result = $this->inspect();
        self::assertSame('owner-editorial-only', $result['linkKind']);
        self::assertSame(self::ASSIGNMENT, $result['assignmentId']);
        self::assertSame(self::SAFE, $result['safeMediaId']);
        self::assertSame(self::NOW + 10_000, $result['expiresAt']);
        self::assertFalse($result['published']);
        self::assertFalse($result['candidateFields']['description']);
        self::assertTrue($result['candidateFields']['capturedAt']);
        self::assertTrue($result['candidateFields']['gps']); // only prospective ceiling
        foreach ($result['effectivePublicFields'] as $allowed) {
            self::assertFalse($allowed);
        }
        foreach (['token', 'publicUrl', 'originalUrl', 'dek', 'gps', 'ciphertext'] as $key) {
            self::assertArrayNotHasKey($key, $result);
        }
    }

    public function test_untrusted_cross_owner_cannot_resolve_editorial_binding(): void
    {
        $this->rejected(fn () => $this->audit->inspect(
            '66666666-6666-4666-8666-666666666666', self::SAFE
        ), 404);
    }

    public function test_signed_link_signature_and_head_root_hash_cannot_be_forged(): void
    {
        DB::table('safe_assignment_editorial_links_v1')
            ->where('safe_media_id', self::SAFE)
            ->update(['account_signature' => Protocol::encode(str_repeat('a', 64))]);
        $this->rejected(fn () => $this->inspect(), 409);
    }

    public function test_signed_link_root_mismatch_is_rejected_even_if_current_database_row_is_modified(): void
    {
        DB::table('safe_assignment_editorial_links_v1')
            ->where('safe_media_id', self::SAFE)
            ->update(['assignment_root_hash' => str_repeat('e', 64)]);
        $this->rejected(fn () => $this->inspect(), 409);
    }

    public function test_invalid_detachment_does_not_resurrect_link_by_flipping_state(): void
    {
        DB::table('safe_assignment_editorial_links_v1')
            ->where('safe_media_id', self::SAFE)->update(['state' => 'detached']);
        $this->rejected(fn () => $this->inspect(), 410);
        DB::table('safe_assignment_editorial_links_v1')
            ->where('safe_media_id', self::SAFE)->update([
                'state' => 'active',
                'detach_operation_id' => (string) Str::uuid(),
                'detach_contract_hash' => str_repeat('f', 64),
                'detach_contract_json' => '{}',
                'detach_signature' => 'fixture',
            ]);
        $this->rejected(fn () => $this->inspect(), 409);
    }

    public function test_stale_assignment_ceiling_and_file_policy_are_rejected(): void
    {
        DB::table('assignment_preview_ceiling_events_v1')
            ->where('assignment_id', self::ASSIGNMENT)
            ->update(['contract_hash' => str_repeat('e', 64)]);
        $this->rejected(fn () => $this->inspect(), 409);
    }

    public function test_file_preview_missing_is_never_inferred_from_signed_link(): void
    {
        DB::table('media_file_preview_policy_events_v1')
            ->where('safe_media_id', self::SAFE)->delete();
        $this->rejected(fn () => $this->inspect(), 409);
    }

    public function test_source_account_drift_is_detected_before_any_field_candidate(): void
    {
        DB::table('media_files_v1')->where('id', self::SOURCE)
            ->update(['state' => 'deleting']);
        $this->rejected(fn () => $this->inspect(), 410);
    }

    public function test_owner_assignment_detached_or_retired_denies_editorial_use(): void
    {
        DB::table('assignment_records_v1')->where('id', self::ASSIGNMENT)
            ->update(['state' => 'deleted']);
        $this->rejected(fn () => $this->inspect(), 410);
    }

    public function test_signed_link_ttl_cannot_exceed_latest_private_ceiling(): void
    {
        DB::table('assignment_preview_ceilings_v1')
            ->where('assignment_id', self::ASSIGNMENT)
            ->update(['expires_at_ms' => self::NOW + 5_000]);
        $this->rejected(fn () => $this->inspect(), 409);
    }

    public function test_expired_but_signed_link_is_not_automatically_published(): void
    {
        $this->travelTo(Carbon::createFromTimestampUTC(1800000012));
        $this->rejected(fn () => $this->inspect(), 410);
    }

    public function test_no_link_is_implicit_permission_even_with_both_ceilings(): void
    {
        DB::table('safe_assignment_editorial_links_v1')
            ->where('safe_media_id', self::SAFE)->delete();
        $this->rejected(fn () => $this->inspect(), 404);
    }
}
