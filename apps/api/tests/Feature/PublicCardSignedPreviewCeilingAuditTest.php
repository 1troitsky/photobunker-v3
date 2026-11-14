<?php
declare(strict_types=1);

namespace Tests\Feature;

use App\Identity\Protocol;
use App\PublicCard\SignedPreviewCeilingAudit;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Carbon;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;
use OpenSSLAsymmetricKey;
use Symfony\Component\HttpKernel\Exception\HttpException;
use Tests\TestCase;

final class PublicCardSignedPreviewCeilingAuditTest extends TestCase
{
    use RefreshDatabase;

    private const NOW = 1_800_000_000_000;
    private const ZERO = '0000000000000000000000000000000000000000000000000000000000000000';
    private const OWNER = '11111111-1111-4111-8111-111111111111';
    private const SOURCE = '22222222-2222-4222-8222-222222222222';
    private const SAFE = '33333333-3333-4333-8333-333333333333';
    private const ASSIGNMENT = '44444444-4444-4444-8444-444444444444';
    private OpenSSLAsymmetricKey $key;
    private SignedPreviewCeilingAudit $audit;
    private array $fields;
    private array $actions;
    private string $rootHash;

    protected function setUp(): void
    {
        parent::setUp();
        $this->travelTo(Carbon::createFromTimestampUTC(1800000000));
        $this->audit = new SignedPreviewCeilingAudit();
        $this->key = openssl_pkey_new([
            'private_key_type' => OPENSSL_KEYTYPE_EC, 'curve_name' => 'prime256v1',
        ]);
        $spki = Protocol::encode(base64_decode(preg_replace(
            '/-----[^-]+-----|\s+/', '', openssl_pkey_get_details($this->key)['key']
        )));
        DB::table('identity_accounts')->insert([
            'id' => self::OWNER, 'operation_id' => (string) Str::uuid(),
            'prepare_hash' => str_repeat('f', 64), 'status' => 'ready',
            'account_spki' => $spki, 'reserved_until' => now()->addDay(),
            'created_at' => now(), 'updated_at' => now(),
        ]);
        $device = (string) Str::uuid();
        DB::table('identity_devices')->insert([
            'id' => $device, 'account_id' => self::OWNER,
            'signing_spki' => $spki, 'created_at' => now(), 'updated_at' => now(),
        ]);
        foreach ([
            [self::SOURCE, str_repeat('a', 64), self::NOW + 40_000],
            [self::SAFE, str_repeat('b', 64), self::NOW + 30_000],
        ] as [$id, $hash, $expires]) {
            DB::table('media_files_v1')->insert([
                'id' => $id, 'account_id' => self::OWNER, 'device_id' => $device,
                'operation_id' => (string) Str::uuid(), 'media_type' => 'photo',
                'state' => 'active', 'expires_at' => $expires,
                'plain_bytes' => 2048, 'cipher_bytes' => 2064,
                'contract_hash' => $hash, 'contract_json' => '{}',
                'signature' => 'fixture', 'created_at' => now(), 'updated_at' => now(),
            ]);
        }
        $root = [
            'version' => 1, 'assignmentId' => self::ASSIGNMENT,
            'operationId' => (string) Str::uuid(), 'ownerAccountId' => self::OWNER,
            'revision' => 1, 'policyRevision' => 1, 'state' => 'active',
            'startsAt' => self::NOW - 1000, 'endsAt' => null,
            'photoGoal' => 30, 'allowedMedia' => ['photo'], 'privateEnvelope' => [],
        ];
        $raw = self::canonical($root);
        $this->rootHash = hash('sha256', $raw);
        DB::table('assignment_records_v1')->insert([
            'id' => self::ASSIGNMENT, 'owner_account_id' => self::OWNER,
            'operation_id' => $root['operationId'],
            'contract_hash' => $this->rootHash, 'contract_json' => $raw,
            'owner_signature' => $this->sign("pb3.assignment.v1\n", $raw),
            'private_envelope_json' => '{}', 'state' => 'active',
            'revision' => 1, 'policy_revision' => 1,
            'starts_at' => self::NOW - 1000, 'ends_at' => null,
            'created_at' => now(), 'updated_at' => now(),
        ]);
        $this->fields = [
            'description' => true, 'capturedAt' => true,
            'updatedAt' => false, 'tags' => false,
            'authorTeam' => false, 'gps' => true, 'metadata' => false,
        ];
        $this->actions = [
            'view' => false, 'copy' => false,
            'download' => false, 'share' => false,
        ];
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
            $part = ltrim(substr($der, $offset, $len), "\0");
            self::assertLessThanOrEqual(32, strlen($part));
            $raw .= str_pad($part, 32, "\0", STR_PAD_LEFT);
            $offset += $len;
        }
        return Protocol::encode($raw);
    }

    private function filePolicy(array $changes = [], int $revision = 1, string $previous = self::ZERO): string
    {
        $contract = array_replace([
            'version' => 1, 'operationId' => (string) Str::uuid(),
            'accountId' => self::OWNER, 'sourceMediaId' => self::SOURCE,
            'safeMediaId' => self::SAFE, 'sourceContractHash' => str_repeat('a', 64),
            'safeContractHash' => str_repeat('b', 64),
            'fromRevision' => $revision - 1, 'toRevision' => $revision,
            'previousPolicyHash' => $previous, 'publication' => 'disabled',
            'fields' => $this->fields, 'actions' => $this->actions,
            'expiresAt' => self::NOW + 20_000,
        ], $changes);
        $json = self::canonical($contract);
        $hash = hash('sha256', $json);
        $sig = $this->sign("pb3.media-file-preview-policy.v1\n", $json);
        DB::table('media_file_preview_policy_events_v1')->insert([
            'operation_id' => $contract['operationId'], 'account_id' => self::OWNER,
            'source_media_id' => self::SOURCE, 'safe_media_id' => self::SAFE,
            'from_revision' => $revision - 1, 'to_revision' => $revision,
            'previous_policy_hash' => $previous, 'contract_hash' => $hash,
            'contract_json' => $json, 'account_signature' => $sig,
            'created_at' => now(),
        ]);
        DB::table('media_file_preview_policies_v1')->updateOrInsert(
            ['safe_media_id' => self::SAFE],
            [
                'account_id' => self::OWNER, 'source_media_id' => self::SOURCE,
                'source_contract_hash' => str_repeat('a', 64),
                'safe_contract_hash' => str_repeat('b', 64),
                'revision' => $revision, 'contract_hash' => $hash,
                'contract_json' => $json, 'account_signature' => $sig,
                'expires_at_ms' => $contract['expiresAt'],
                'created_at' => now(), 'updated_at' => now(),
            ]
        );
        return $hash;
    }

    private function assignmentPolicy(array $changes = [], int $revision = 1, string $previous = self::ZERO): string
    {
        $contract = array_replace([
            'version' => 1, 'operationId' => (string) Str::uuid(),
            'assignmentId' => self::ASSIGNMENT, 'ownerAccountId' => self::OWNER,
            'rootPolicyHash' => $this->rootHash,
            'fromRevision' => $revision - 1, 'toRevision' => $revision,
            'previousPolicyHash' => $previous, 'publication' => 'disabled',
            'fields' => $this->fields, 'actions' => $this->actions,
            'expiresAt' => self::NOW + 15_000,
        ], $changes);
        $json = self::canonical($contract);
        $hash = hash('sha256', $json);
        $sig = $this->sign("pb3.assignment-preview-ceiling.v1\n", $json);
        DB::table('assignment_preview_ceiling_events_v1')->insert([
            'operation_id' => $contract['operationId'],
            'assignment_id' => self::ASSIGNMENT, 'owner_account_id' => self::OWNER,
            'from_revision' => $revision - 1, 'to_revision' => $revision,
            'previous_policy_hash' => $previous, 'contract_hash' => $hash,
            'contract_json' => $json, 'owner_signature' => $sig,
            'created_at' => now(),
        ]);
        DB::table('assignment_preview_ceilings_v1')->updateOrInsert(
            ['assignment_id' => self::ASSIGNMENT],
            [
                'owner_account_id' => self::OWNER, 'root_policy_hash' => $this->rootHash,
                'revision' => $revision, 'contract_hash' => $hash,
                'contract_json' => $json, 'owner_signature' => $sig,
                'expires_at_ms' => $contract['expiresAt'],
                'created_at' => now(), 'updated_at' => now(),
            ]
        );
        return $hash;
    }

    private function rejected(callable $call, int $status): void
    {
        try {
            $call();
            self::fail('Unsafe owner preview policy incorrectly accepted');
        } catch (HttpException $e) {
            self::assertSame($status, $e->getStatusCode());
        }
    }

    public function test_signed_file_and_assignment_ceilings_are_private_even_when_gps_field_is_allowed(): void
    {
        $this->filePolicy();
        $this->assignmentPolicy();
        $file = $this->audit->file(self::OWNER, self::SOURCE, self::SAFE);
        $assignment = $this->audit->assignment(self::OWNER, self::ASSIGNMENT);
        self::assertSame('file', $file['scope']);
        self::assertSame('assignment', $assignment['scope']);
        self::assertSame(1, $file['revision']);
        self::assertTrue($file['fields']['gps']); // display ceiling, NOT permission
        self::assertFalse($assignment['published']);
        self::assertSame('disabled', $file['publication']);
        self::assertSame('disabled', $assignment['publication']);
        foreach ([$file, $assignment] as $result) {
            self::assertSame(self::NOW + ($result['scope'] === 'file' ? 20_000 : 15_000), $result['expiresAt']);
            self::assertFalse($result['published']);
            self::assertSame([false, false, false, false], array_values($result['actions']));
            foreach (['token', 'url', 'image', 'dek', 'original', 'mediaKey'] as $secret) {
                self::assertArrayNotHasKey($secret, $result);
            }
        }
    }

    public function test_two_successive_signed_file_and_assignment_revisions_preserve_verified_hash_chain(): void
    {
        $f1 = $this->filePolicy();
        $a1 = $this->assignmentPolicy();
        $this->filePolicy(['fields' => array_replace($this->fields, ['description' => false])], 2, $f1);
        $this->assignmentPolicy(['fields' => array_replace($this->fields, ['gps' => false])], 2, $a1);
        self::assertSame(2, $this->audit->file(self::OWNER, self::SOURCE, self::SAFE)['revision']);
        self::assertFalse($this->audit->file(self::OWNER, self::SOURCE, self::SAFE)['fields']['description']);
        self::assertSame(2, $this->audit->assignment(self::OWNER, self::ASSIGNMENT)['revision']);
        self::assertFalse($this->audit->assignment(self::OWNER, self::ASSIGNMENT)['fields']['gps']);
    }

    public function test_validly_resigned_public_activation_cannot_bypass_legacy_disabled_contracts(): void
    {
        $this->filePolicy(['publication' => 'enabled']);
        $this->assignmentPolicy(['actions' => array_replace($this->actions, ['view' => true])]);
        $this->rejected(fn () => $this->audit->file(self::OWNER, self::SOURCE, self::SAFE), 409);
        $this->rejected(fn () => $this->audit->assignment(self::OWNER, self::ASSIGNMENT), 409);
    }

    public function test_file_policy_event_tampering_or_pointer_rewind_is_rejected(): void
    {
        $first = $this->filePolicy();
        DB::table('media_file_preview_policy_events_v1')
            ->where('safe_media_id', self::SAFE)->update(['contract_hash' => str_repeat('c', 64)]);
        $this->rejected(fn () => $this->audit->file(self::OWNER, self::SOURCE, self::SAFE), 409);
        DB::table('media_file_preview_policy_events_v1')
            ->where('safe_media_id', self::SAFE)->update(['contract_hash' => $first]);
        DB::table('media_file_preview_policies_v1')
            ->where('safe_media_id', self::SAFE)->update(['revision' => 2]);
        $this->rejected(fn () => $this->audit->file(self::OWNER, self::SOURCE, self::SAFE), 409);
    }

    public function test_assignment_event_replacement_and_root_hash_tampering_fail_closed(): void
    {
        $first = $this->assignmentPolicy();
        DB::table('assignment_preview_ceiling_events_v1')
            ->where('assignment_id', self::ASSIGNMENT)->update(['contract_hash' => str_repeat('e', 64)]);
        $this->rejected(fn () => $this->audit->assignment(self::OWNER, self::ASSIGNMENT), 409);
        DB::table('assignment_preview_ceiling_events_v1')
            ->where('assignment_id', self::ASSIGNMENT)->update(['contract_hash' => $first]);
        DB::table('assignment_records_v1')
            ->where('id', self::ASSIGNMENT)->update(['contract_hash' => str_repeat('d', 64)]);
        $this->rejected(fn () => $this->audit->assignment(self::OWNER, self::ASSIGNMENT), 409);
    }

    public function test_expiry_archive_tombstone_and_cross_account_are_not_display_permissions(): void
    {
        $this->filePolicy();
        $this->assignmentPolicy();
        $this->rejected(fn () => $this->audit->file(
            '55555555-5555-4555-8555-555555555555', self::SOURCE, self::SAFE
        ), 404);
        DB::table('media_files_v1')->where('id', self::SAFE)->update(['state' => 'deleting']);
        $this->rejected(fn () => $this->audit->file(self::OWNER, self::SOURCE, self::SAFE), 410);
        DB::table('media_files_v1')->where('id', self::SAFE)->update(['state' => 'active']);
        DB::table('media_tombstones_v1')->insert([
            'media_id' => self::SAFE, 'account_id' => self::OWNER,
            'operation_id' => (string) Str::uuid(), 'object_keys' => '[]',
            'next_sweep_at' => now()->addHour(), 'created_at' => now(),
        ]);
        $this->rejected(fn () => $this->audit->file(self::OWNER, self::SOURCE, self::SAFE), 410);
        $this->travelTo(Carbon::createFromTimestampUTC(1800000025));
        $this->rejected(fn () => $this->audit->assignment(self::OWNER, self::ASSIGNMENT), 410);
    }

    public function test_expired_assignment_retention_blocks_even_unexpired_preview_ceiling(): void
    {
        $this->assignmentPolicy();
        DB::table('assignment_records_v1')
            ->where('id', self::ASSIGNMENT)->update([
                'files_access_until' => self::NOW - 1000,
            ]);
        $this->rejected(fn () => $this->audit->assignment(self::OWNER, self::ASSIGNMENT), 410);
    }

    public function test_missing_private_ceiling_never_implies_public_consent(): void
    {
        $this->rejected(fn () => $this->audit->file(self::OWNER, self::SOURCE, self::SAFE), 404);
        $this->rejected(fn () => $this->audit->assignment(self::OWNER, self::ASSIGNMENT), 404);
    }
}
