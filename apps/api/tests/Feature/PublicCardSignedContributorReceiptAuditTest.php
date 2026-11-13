<?php
declare(strict_types=1);

namespace Tests\Feature;

use App\Identity\Protocol;
use App\PublicCard\SignedContributorReceiptAudit;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Carbon;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;
use OpenSSLAsymmetricKey;
use Symfony\Component\HttpKernel\Exception\HttpException;
use Tests\TestCase;

final class PublicCardSignedContributorReceiptAuditTest extends TestCase
{
    use RefreshDatabase;

    private const NOW = 1_800_000_000_000;
    private const OWNER = '11111111-1111-4111-8111-111111111111';
    private const CONTRIBUTOR = '22222222-2222-4222-8222-222222222222';
    private const ASSIGNMENT = '33333333-3333-4333-8333-333333333333';
    private const MEDIA = '44444444-4444-4444-8444-444444444444';
    private const GRANT = '55555555-5555-4555-8555-555555555555';
    private const INVITE = '66666666-6666-4666-8666-666666666666';
    private const SUBMISSION = '77777777-7777-4777-8777-777777777777';

    /** @var array<string,OpenSSLAsymmetricKey> */
    private array $keys = [];
    private SignedContributorReceiptAudit $audit;
    private string $rootHash;
    private string $mediaHash;
    private string $directoryHash;

    protected function setUp(): void
    {
        parent::setUp();
        $this->travelTo(Carbon::createFromTimestampUTC(1800000000));
        $this->account('owner', self::OWNER);
        $this->account('contributor', self::CONTRIBUTOR);
        $this->audit = new SignedContributorReceiptAudit();
        $this->directoryHash = hash('sha256', 'owner-recipient-exchange-key-v1');
        DB::table('account_exchange_keys')->insert([
            'account_id' => self::OWNER, 'descriptor' => 'fixture',
            'descriptor_hash' => $this->directoryHash,
            'account_signature' => 'fixture', 'sealed_private' => '{}',
            'created_at' => now(), 'updated_at' => now(),
        ]);
        $this->assignment();
        $this->acceptedInvite();
        $this->media();
        $this->recipientGrant();
        $this->receipt();
    }

    private function account(string $role, string $id): void
    {
        $key = openssl_pkey_new([
            'private_key_type' => OPENSSL_KEYTYPE_EC,
            'curve_name' => 'prime256v1',
        ]);
        $this->keys[$role] = $key;
        $details = openssl_pkey_get_details($key);
        $spki = Protocol::encode(base64_decode(preg_replace(
            '/-----[^-]+-----|\s+/', '', $details['key']
        )));
        DB::table('identity_accounts')->insert([
            'id' => $id, 'operation_id' => (string) Str::uuid(),
            'prepare_hash' => str_repeat('c', 64),
            'account_spki' => $spki, 'status' => 'ready',
            'reserved_until' => now()->addDay(),
            'created_at' => now(), 'updated_at' => now(),
        ]);
        DB::table('identity_devices')->insert([
            'id' => (string) Str::uuid(), 'account_id' => $id,
            'signing_spki' => $spki, 'created_at' => now(), 'updated_at' => now(),
        ]);
    }

    private static function canonical(array $value): string
    {
        return json_encode($value, JSON_UNESCAPED_SLASHES | JSON_THROW_ON_ERROR);
    }

    private function sign(string $role, string $domain, string $raw): string
    {
        self::assertTrue(openssl_sign(
            $domain.$raw, $der, $this->keys[$role], OPENSSL_ALGO_SHA256
        ));
        $offset = 2;
        $encoded = '';
        for ($i = 0; $i < 2; $i++) {
            self::assertSame(2, ord($der[$offset++]));
            $length = ord($der[$offset++]);
            $number = ltrim(substr($der, $offset, $length), "\0");
            self::assertLessThanOrEqual(32, strlen($number));
            $encoded .= str_pad($number, 32, "\0", STR_PAD_LEFT);
            $offset += $length;
        }
        return Protocol::encode($encoded);
    }

    private function assignment(): void
    {
        $root = [
            'version' => 1, 'assignmentId' => self::ASSIGNMENT,
            'operationId' => (string) Str::uuid(),
            'ownerAccountId' => self::OWNER, 'revision' => 1,
            'policyRevision' => 1, 'state' => 'active',
            'startsAt' => self::NOW - 1000, 'endsAt' => null,
            'photoGoal' => 30, 'allowedMedia' => ['photo'],
            'privateEnvelope' => [],
        ];
        $json = self::canonical($root);
        $this->rootHash = hash('sha256', $json);
        DB::table('assignment_records_v1')->insert([
            'id' => self::ASSIGNMENT, 'owner_account_id' => self::OWNER,
            'operation_id' => $root['operationId'],
            'contract_hash' => $this->rootHash, 'contract_json' => $json,
            'owner_signature' => $this->sign('owner', "pb3.assignment.v1\n", $json),
            'private_envelope_json' => '{}', 'state' => 'active',
            'revision' => 1, 'policy_revision' => 1,
            'starts_at' => self::NOW - 1000, 'ends_at' => null,
            'created_at' => now(), 'updated_at' => now(),
        ]);
    }

    private function acceptedInvite(): void
    {
        $invitation = [
            'version' => 1, 'inviteId' => self::INVITE,
            'assignmentId' => self::ASSIGNMENT,
            'ownerAccountId' => self::OWNER,
            'recipientAccountId' => self::CONTRIBUTOR,
            'recipientKeyDigest' => hash('sha256', 'contributor-key'),
            'role' => 'contributor', 'expiresAt' => self::NOW + 80_000,
            'envelope' => [
                'ephemeralSpki' => 'fixture', 'salt' => 'fixture',
                'iv' => 'fixture', 'ciphertext' => 'fixture',
            ],
        ];
        $json = self::canonical($invitation);
        $accepted = [
            'version' => 1, 'action' => 'accept',
            'inviteId' => self::INVITE,
            'assignmentId' => self::ASSIGNMENT,
            'recipientAccountId' => self::CONTRIBUTOR,
            'operationId' => (string) Str::uuid(),
        ];
        $acceptJson = self::canonical($accepted);
        DB::table('assignment_invites_v1')->insert([
            'id' => self::INVITE,
            'assignment_id' => self::ASSIGNMENT,
            'owner_account_id' => self::OWNER,
            'recipient_account_id' => self::CONTRIBUTOR,
            'role' => 'contributor', 'state' => 'accepted',
            'recipient_key_digest' => $invitation['recipientKeyDigest'],
            'contract_hash' => hash('sha256', $json),
            'contract_json' => $json,
            'owner_signature' => $this->sign('owner', "pb3.assignment-invite.v1\n", $json),
            'expires_at' => $invitation['expiresAt'],
            'accepted_operation_id' => $accepted['operationId'],
            'accepted_contract' => $acceptJson,
            'accepted_signature' => $this->sign('contributor', "pb3.assignment-accept.v1\n", $acceptJson),
            'accepted_at' => now(),
            'created_at' => now(), 'updated_at' => now(),
        ]);
    }

    private function media(): void
    {
        $raw = self::canonical([
            'version' => 1, 'mediaId' => self::MEDIA,
            'mediaType' => 'photo', 'accountId' => self::CONTRIBUTOR,
        ]);
        $this->mediaHash = hash('sha256', $raw);
        $device = DB::table('identity_devices')
            ->where('account_id', self::CONTRIBUTOR)->value('id');
        DB::table('media_files_v1')->insert([
            'id' => self::MEDIA,
            'account_id' => self::CONTRIBUTOR, 'device_id' => $device,
            'operation_id' => (string) Str::uuid(),
            'media_type' => 'photo', 'state' => 'active',
            'expires_at' => self::NOW + 50_000,
            'plain_bytes' => 1024, 'cipher_bytes' => 1040,
            'contract_hash' => $this->mediaHash, 'contract_json' => $raw,
            'signature' => 'fixture-device-signature',
            'created_at' => now(), 'updated_at' => now(),
        ]);
    }

    private function recipientGrant(): void
    {
        $grant = [
            'version' => 2, 'grantId' => self::GRANT,
            'mediaId' => self::MEDIA,
            'ownerAccountId' => self::CONTRIBUTOR,
            'recipientAccountId' => self::OWNER,
            'assignmentId' => self::ASSIGNMENT,
            'recipientKeyDigest' => $this->directoryHash,
            'mediaContractHash' => $this->mediaHash,
            'scope' => 'read', 'expiresAt' => self::NOW + 30_000,
            'envelope' => ['ephemeralSpki' => 'fixture',
                'salt' => 'fixture', 'iv' => 'fixture',
                'ciphertext' => 'fixture'],
        ];
        $raw = self::canonical($grant);
        DB::table('media_recipient_grants_v1')->insert([
            'id' => self::GRANT,
            'media_id' => self::MEDIA, 'owner_account_id' => self::CONTRIBUTOR,
            'recipient_account_id' => self::OWNER,
            'recipient_key_digest' => $this->directoryHash,
            'media_contract_hash' => $this->mediaHash,
            'assignment_id' => self::ASSIGNMENT,
            'expires_at' => $grant['expiresAt'], 'state' => 'active',
            'contract_hash' => hash('sha256', $raw),
            'contract_json' => $raw,
            'account_signature' => $this->sign('contributor', "pb3.media-grant.v2\n", $raw),
            'created_at' => now(), 'updated_at' => now(),
        ]);
    }

    private function receipt(): void
    {
        $receipt = [
            'version' => 3, 'submissionId' => self::SUBMISSION,
            'operationId' => (string) Str::uuid(),
            'assignmentId' => self::ASSIGNMENT,
            'contributorAccountId' => self::CONTRIBUTOR,
            'mediaId' => self::MEDIA, 'mediaGrantId' => self::GRANT,
            'mediaContractHash' => $this->mediaHash,
            'policyRevision' => 1, 'policyHash' => $this->rootHash,
            'kind' => 'photo',
        ];
        $raw = self::canonical($receipt);
        DB::table('assignment_media_submissions_v1')->insert([
            'id' => self::SUBMISSION, 'assignment_id' => self::ASSIGNMENT,
            'contributor_account_id' => self::CONTRIBUTOR,
            'media_id' => self::MEDIA, 'media_grant_id' => self::GRANT,
            'media_type' => 'photo', 'operation_id' => $receipt['operationId'],
            'contract_hash' => hash('sha256', $raw),
            'contract_json' => $raw,
            'contributor_signature' => $this->sign('contributor',
                "pb3.assignment-media-submit.v3\n", $raw),
            'policy_revision' => 1, 'policy_hash' => $this->rootHash,
            'media_contract_hash' => $this->mediaHash, 'created_at' => now(),
        ]);
    }

    private function asOwner(): array
    {
        return $this->audit->inspectForOwner(self::OWNER, self::SUBMISSION);
    }

    private function rejected(callable $op, int $status): void
    {
        try {
            $op();
            self::fail('unsafe contributor receipt accepted');
        } catch (HttpException $e) {
            self::assertSame($status, $e->getStatusCode());
        }
    }

    public function test_real_signed_contributor_receipt_is_owner_private_and_not_public_consent(): void
    {
        $res = $this->asOwner();
        self::assertSame(self::SUBMISSION, $res['submissionId']);
        self::assertSame(self::CONTRIBUTOR, $res['contributorAccountId']);
        self::assertSame(self::GRANT, $res['grantId']);
        self::assertSame(self::NOW + 30_000, $res['expiresAt']);
        self::assertTrue($res['ownerPrivateReadOnly']);
        self::assertFalse($res['captureClaimPresent']);
        self::assertFalse($res['cameraAttested']);
        self::assertFalse($res['safeDerivativeVerified']);
        self::assertFalse($res['published']);
        self::assertFalse($res['publicAuthorized']);
        foreach (['publicUrl', 'token', 'image', 'dek', 'envelope', 'gps', 'ciphertext'] as $name) {
            self::assertArrayNotHasKey($name, $res);
        }
    }

    public function test_foreign_requester_cannot_discover_private_submission(): void
    {
        $this->rejected(fn () => $this->audit->inspectForOwner(
            '88888888-8888-4888-8888-888888888888', self::SUBMISSION
        ), 404);
    }

    public function test_tampered_receipt_signature_fails_closed(): void
    {
        DB::table('assignment_media_submissions_v1')
            ->where('id', self::SUBMISSION)
            ->update(['contributor_signature' => Protocol::encode(str_repeat('x', 64))]);
        $this->rejected(fn () => $this->asOwner(), 410);
    }

    public function test_receipt_hash_or_contributor_binding_cannot_be_modified(): void
    {
        DB::table('assignment_media_submissions_v1')->where('id', self::SUBMISSION)
            ->update(['policy_hash' => str_repeat('e', 64)]);
        $this->rejected(fn () => $this->asOwner(), 410);
    }

    public function test_grant_revocation_closes_private_receipt_even_if_original_upload_survives(): void
    {
        DB::table('media_recipient_grants_v1')->where('id', self::GRANT)
            ->update(['state' => 'revoked', 'revoked_at' => now()]);
        $this->rejected(fn () => $this->asOwner(), 410);
        self::assertDatabaseHas('media_files_v1', ['id' => self::MEDIA, 'state' => 'active']);
    }

    public function test_grant_signature_or_current_recipient_key_digest_drift_denies(): void
    {
        DB::table('media_recipient_grants_v1')->where('id', self::GRANT)
            ->update(['account_signature' => Protocol::encode(str_repeat('x', 64))]);
        $this->rejected(fn () => $this->asOwner(), 410);
    }

    public function test_recipient_key_rotation_invalidates_old_grant_without_media_deletion(): void
    {
        DB::table('account_exchange_keys')->where('account_id', self::OWNER)
            ->update(['descriptor_hash' => hash('sha256', 'rotated-key')]);
        $this->rejected(fn () => $this->asOwner(), 410);
    }

    public function test_suspended_contributor_membership_closes_receipt(): void
    {
        DB::table('assignment_member_removals_v1')->insert([
            'operation_id' => (string) Str::uuid(),
            'assignment_id' => self::ASSIGNMENT, 'invite_id' => self::INVITE,
            'owner_account_id' => self::OWNER,
            'recipient_account_id' => self::CONTRIBUTOR,
            'contract_hash' => str_repeat('a', 64),
            'contract_json' => 'signed-removal-fixture',
            'owner_signature' => 'fixture', 'created_at' => now(),
        ]);
        $this->rejected(fn () => $this->asOwner(), 410);
    }

    public function test_forged_owner_invitation_signature_is_rejected(): void
    {
        DB::table('assignment_invites_v1')->where('id', self::INVITE)
            ->update(['owner_signature' => Protocol::encode(str_repeat('z', 64))]);
        $this->rejected(fn () => $this->asOwner(), 410);
    }

    public function test_forged_contributor_acceptance_is_rejected(): void
    {
        DB::table('assignment_invites_v1')->where('id', self::INVITE)
            ->update(['accepted_signature' => Protocol::encode(str_repeat('m', 64))]);
        $this->rejected(fn () => $this->asOwner(), 410);
    }

    public function test_changed_root_policy_requires_unimplemented_independent_amendment_history(): void
    {
        DB::table('assignment_records_v1')->where('id', self::ASSIGNMENT)
            ->update(['policy_revision' => 2]);
        $this->rejected(fn () => $this->asOwner(), 410);
    }

    public function test_expired_assignment_retention_denies_without_deleting_upload(): void
    {
        DB::table('assignment_records_v1')->where('id', self::ASSIGNMENT)
            ->update(['files_access_until' => self::NOW - 1000]);
        $this->rejected(fn () => $this->asOwner(), 410);
    }

    public function test_media_tombstone_blocks_read_evidence(): void
    {
        DB::table('media_tombstones_v1')->insert([
            'media_id' => self::MEDIA, 'account_id' => self::CONTRIBUTOR,
            'operation_id' => (string) Str::uuid(),
            'object_keys' => '[]',
            'next_sweep_at' => now()->addHour(), 'created_at' => now(),
        ]);
        $this->rejected(fn () => $this->asOwner(), 410);
    }

    public function test_media_archive_blocks_past_submission(): void
    {
        DB::table('browser_archive_entries_v1')->insert([
            'id' => (string) Str::uuid(),
            'account_id' => self::CONTRIBUTOR, 'kind' => 'media',
            'asset_id' => self::MEDIA, 'revision' => 1, 'state' => 'archived',
            'asset_expires_at_ms' => self::NOW + 50_000,
            'media_type' => 'photo', 'plain_bytes' => 1024,
            'last_operation_id' => (string) Str::uuid(),
            'created_at' => now(), 'updated_at' => now(),
        ]);
        $this->rejected(fn () => $this->asOwner(), 410);
    }

    public function test_signed_v4_capture_claim_is_not_hardware_attestation(): void
    {
        $row = DB::table('assignment_media_submissions_v1')
            ->where('id', self::SUBMISSION)->first();
        $data = json_decode($row->contract_json, true, 32, JSON_THROW_ON_ERROR);
        $data['version'] = 4;
        $capture = [
            'version' => 1,
            'assignmentId' => self::ASSIGNMENT,
            'ownerAccountId' => self::OWNER,
            'contributorAccountId' => self::CONTRIBUTOR,
            'policyRevision' => 1, 'policyHash' => $this->rootHash,
            'mediaId' => self::MEDIA, 'mediaContractHash' => $this->mediaHash,
            'mediaType' => 'photo',
            'startedAt' => self::NOW - 40_000,
            'finishedAt' => self::NOW - 38_000,
        ];
        $captureJson = self::canonical($capture);
        $captureSig = $this->sign(
            'contributor', "pb3.assignment-media-capture.v1\n", $captureJson
        );
        $data['captureContract'] = $captureJson;
        $data['captureSignature'] = $captureSig;
        $raw = self::canonical($data);
        DB::table('assignment_media_submissions_v1')
            ->where('id', self::SUBMISSION)->update([
                'contract_json' => $raw, 'contract_hash' => hash('sha256', $raw),
                'contributor_signature' => $this->sign(
                    'contributor', "pb3.assignment-media-submit.v4\n", $raw
                ), 'capture_contract_json' => $captureJson,
                'capture_signature' => $captureSig,
            ]);
        $result = $this->asOwner();
        self::assertTrue($result['captureClaimPresent']);
        self::assertFalse($result['cameraAttested']);
        self::assertFalse($result['publicAuthorized']);
    }

    public function test_v1_personal_grant_cannot_be_upgraded_to_assignment_receipt(): void
    {
        $g = DB::table('media_recipient_grants_v1')->where('id', self::GRANT)->first();
        $grant = json_decode($g->contract_json, true, 32, JSON_THROW_ON_ERROR);
        $grant['version'] = 1;
        unset($grant['assignmentId']);
        $raw = self::canonical($grant);
        DB::table('media_recipient_grants_v1')->where('id', self::GRANT)->update([
            'assignment_id' => null,
            'contract_json' => $raw,
            'contract_hash' => hash('sha256', $raw),
            'account_signature' => $this->sign('contributor',
                "pb3.media-grant.v1\n", $raw),
        ]);
        $this->rejected(fn () => $this->asOwner(), 410);
        self::assertDatabaseHas('media_files_v1', ['id' => self::MEDIA, 'state' => 'active']);
    }

    public function test_unmodified_receipt_is_denied_after_contributor_retirement(): void
    {
        DB::table('identity_accounts')->where('id', self::CONTRIBUTOR)
            ->update(['status' => 'retired']);
        $this->rejected(fn () => $this->asOwner(), 404);
    }

    public function test_current_policy_hash_corruption_and_invitation_hash_corruption_denied(): void
    {
        DB::table('assignment_invites_v1')->where('id', self::INVITE)
            ->update(['contract_hash' => str_repeat('f', 64)]);
        $this->rejected(fn () => $this->asOwner(), 410);
    }

    public function test_expired_e2ee_grant_is_never_reopened_by_valid_receipt(): void
    {
        $this->travelTo(Carbon::createFromTimestampUTC(1800000031));
        $this->rejected(fn () => $this->asOwner(), 410);
    }

}
