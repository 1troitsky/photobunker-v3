<?php
declare(strict_types=1);

namespace App\PublicCard;

use App\Assignments\AssignmentRetention;
use App\Identity\Protocol;
use App\Media\MediaGrantEffectiveAccess;
use App\Photo\PhotoSync;
use Illuminate\Support\Facades\DB;
use Throwable;

/**
 * Read-only owner PRIVATE evidence that a contributor actually signed a
 * photo assignment receipt and granted this assignment owner E2EE read.
 *
 * NOT a publication, public grant, contributor-to-third-party consent, safe
 * JPEG proof, GPS/camera attestation or a way to read plaintext/DEKs.
 *
 * Only root photo assignments (policy_revision=1) are supported here:
 * later signed policy/state chains require a separate full audit.
 */
final class SignedContributorReceiptAudit
{
    private const RECEIPT_DOMAIN = "pb3.assignment-media-submit.v3\n";
    private const CAPTURE_DOMAIN = "pb3.assignment-media-capture.v1\n";
    private const ROOT_DOMAIN = "pb3.assignment.v1\n";
    private const INVITE_DOMAIN = "pb3.assignment-invite.v1\n";
    private const ACCEPT_DOMAIN = "pb3.assignment-accept.v1\n";

    /** @return array<string,bool|int|string> */
    public function inspectForOwner(string $ownerId, string $submissionId): array
    {
        Protocol::uuid($ownerId);
        Protocol::uuid($submissionId);
        $receipt = DB::table('assignment_media_submissions_v1')
            ->where('id', $submissionId)->first();
        abort_unless($receipt !== null, 404);

        $assignment = DB::table('assignment_records_v1')
            ->where('id', $receipt->assignment_id)
            ->where('owner_account_id', $ownerId)->first();
        abort_unless($assignment !== null, 404);
        abort_unless($assignment->state === 'active'
            && (int) $assignment->policy_revision === 1
            && $assignment->latest_policy_contract === null
            && AssignmentRetention::filesOpen($assignment), 410);
        $owner = $this->account($ownerId);
        $contributorId = $receipt->contributor_account_id;
        abort_unless(is_string($contributorId) && $contributorId !== $ownerId, 410);
        $contributor = $this->account($contributorId);
        $root = self::canonical($assignment->contract_json, [
            'version', 'assignmentId', 'operationId', 'ownerAccountId',
            'revision', 'policyRevision', 'state', 'startsAt', 'endsAt',
            'photoGoal', 'allowedMedia', 'privateEnvelope',
        ]);
        abort_unless($root['version'] === 1
            && $root['assignmentId'] === $assignment->id
            && $root['ownerAccountId'] === $ownerId
            && $root['state'] === 'active'
            && $root['policyRevision'] === 1
            && $root['allowedMedia'] === ['photo']
            && $root['startsAt'] === (int) $assignment->starts_at
            && $root['endsAt'] === ($assignment->ends_at === null
                ? null : (int) $assignment->ends_at)
            && hash_equals(hash('sha256', $assignment->contract_json),
                $assignment->contract_hash), 410);
        self::signed($owner->account_spki, self::ROOT_DOMAIN,
            $assignment->contract_json, $assignment->owner_signature);

        // A past receipt cannot manufacture live membership. Verify signed
        // invitation and contributor's signed acceptance, then check an
        // immutable removal record even if mutable invite state says accepted.
        $invites = DB::table('assignment_invites_v1')
            ->where('assignment_id', $assignment->id)
            ->where('owner_account_id', $ownerId)
            ->where('recipient_account_id', $contributorId)
            ->where('role', 'contributor')
            ->where('state', 'accepted')->get();
        abort_unless($invites->count() === 1, 410);
        $invite = $invites->first();
        abort_if(DB::table('assignment_member_removals_v1')
            ->where('invite_id', $invite->id)->exists(), 410);
        $i = self::canonical($invite->contract_json, [
            'version', 'inviteId', 'assignmentId', 'ownerAccountId',
            'recipientAccountId', 'recipientKeyDigest', 'role',
            'expiresAt', 'envelope',
        ]);
        abort_unless($i['version'] === 1
            && $i['inviteId'] === $invite->id
            && $i['assignmentId'] === $assignment->id
            && $i['ownerAccountId'] === $ownerId
            && $i['recipientAccountId'] === $contributorId
            && $i['role'] === 'contributor'
            && $i['expiresAt'] === (int) $invite->expires_at
            && $i['recipientKeyDigest'] === $invite->recipient_key_digest
            && hash_equals(hash('sha256', $invite->contract_json),
                $invite->contract_hash), 410);
        self::signed($owner->account_spki, self::INVITE_DOMAIN,
            $invite->contract_json, $invite->owner_signature);
        abort_unless(is_string($invite->accepted_contract)
            && is_string($invite->accepted_signature)
            && is_string($invite->accepted_operation_id)
            && $invite->accepted_at !== null, 410);
        $accept = self::canonical($invite->accepted_contract, [
            'version', 'action', 'inviteId', 'assignmentId',
            'recipientAccountId', 'operationId',
        ]);
        abort_unless($accept['version'] === 1
            && $accept['action'] === 'accept'
            && $accept['inviteId'] === $invite->id
            && $accept['assignmentId'] === $assignment->id
            && $accept['recipientAccountId'] === $contributorId
            && $accept['operationId'] === $invite->accepted_operation_id, 410);
        self::signed($contributor->account_spki, self::ACCEPT_DOMAIN,
            $invite->accepted_contract, $invite->accepted_signature);

        $media = DB::table('media_files_v1')
            ->where('id', $receipt->media_id)
            ->where('account_id', $contributorId)->first();
        abort_unless($media !== null
            && $media->media_type === 'photo'
            && $media->state === 'active'
            && (int) $media->expires_at > PhotoSync::nowMs()
            && hash_equals($media->contract_hash,
                $receipt->media_contract_hash), 410);
        abort_if(DB::table('media_tombstones_v1')
            ->where('media_id', $media->id)->exists(), 410);
        abort_if(DB::table('browser_archive_entries_v1')
            ->where('kind', 'media')->where('asset_id', $media->id)
            ->whereIn('state', ['archived', 'deleting'])->exists(), 410);

        // Only signed V3 or V4 photo submissions can enter this audit.
        // Legacy personal share v1 and AV v1/v2 have distinct semantics.
        $raw = $receipt->contract_json;
        $parsed = self::canonical($raw, null);
        $v = $parsed['version'] ?? null;
        abort_unless(in_array($v, [3, 4], true)
            && $receipt->media_type === 'photo'
            && (int) $receipt->policy_revision === 1
            && hash_equals($receipt->policy_hash, $assignment->contract_hash)
            && hash_equals(hash('sha256', $raw), $receipt->contract_hash), 410);
        $expected = [
            'version', 'submissionId', 'operationId', 'assignmentId',
            'contributorAccountId', 'mediaId', 'mediaGrantId',
            'mediaContractHash', 'policyRevision', 'policyHash', 'kind',
        ];
        if ($v === 4) array_push($expected, 'captureContract', 'captureSignature');
        self::sameKeys($parsed, $expected);
        abort_unless($parsed['submissionId'] === $submissionId
            && $parsed['operationId'] === $receipt->operation_id
            && $parsed['assignmentId'] === $assignment->id
            && $parsed['contributorAccountId'] === $contributorId
            && $parsed['mediaId'] === $media->id
            && $parsed['mediaGrantId'] === $receipt->media_grant_id
            && $parsed['mediaContractHash'] === $media->contract_hash
            && $parsed['policyRevision'] === 1
            && $parsed['policyHash'] === $assignment->contract_hash
            && $parsed['kind'] === 'photo', 410);
        self::signed($contributor->account_spki,
            "pb3.assignment-media-submit.v".$v."\n",
            $raw, $receipt->contributor_signature);

        if ($v === 4) {
            abort_unless(is_string($parsed['captureContract'])
                && is_string($parsed['captureSignature'])
                && $parsed['captureContract'] === $receipt->capture_contract_json
                && $parsed['captureSignature'] === $receipt->capture_signature, 410);
            $capture = self::canonical($parsed['captureContract'], [
                'version', 'assignmentId', 'ownerAccountId',
                'contributorAccountId', 'policyRevision', 'policyHash',
                'mediaId', 'mediaContractHash', 'mediaType',
                'startedAt', 'finishedAt',
            ]);
            abort_unless($capture['version'] === 1
                && $capture['assignmentId'] === $assignment->id
                && $capture['ownerAccountId'] === $ownerId
                && $capture['contributorAccountId'] === $contributorId
                && $capture['policyRevision'] === 1
                && $capture['policyHash'] === $assignment->contract_hash
                && $capture['mediaId'] === $media->id
                && $capture['mediaContractHash'] === $media->contract_hash
                && $capture['mediaType'] === 'photo'
                && is_int($capture['startedAt'])
                && is_int($capture['finishedAt'])
                && $capture['finishedAt'] > $capture['startedAt']
                && $capture['finishedAt'] - $capture['startedAt'] <= 180000, 410);
            self::signed($contributor->account_spki,
                self::CAPTURE_DOMAIN, $parsed['captureContract'],
                $parsed['captureSignature']);
            // Claim is self-declared by signing account, NOT hardware proof.
        } else {
            abort_unless($receipt->capture_contract_json === null
                && $receipt->capture_signature === null, 410);
        }

        // This is E2EE read permission for the authenticated ASSIGNMENT
        // OWNER only, not license to publish contributor-owned originals.
        $grant = DB::table('media_recipient_grants_v1')
            ->where('id', $receipt->media_grant_id)->first();
        abort_unless($grant !== null
            && $grant->owner_account_id === $contributorId
            && $grant->recipient_account_id === $ownerId
            && $grant->media_id === $media->id
            && $grant->assignment_id === $assignment->id
            && $grant->source_media_id === null
            && $grant->source_contract_hash === null
            && $grant->state === 'active'
            && (int) $grant->expires_at <= (int) $media->expires_at
            && hash_equals($grant->media_contract_hash,
                $media->contract_hash), 410);
        // Existing effective ACL additionally verifies actual owner-signed
        // grant v2, current recipient exchange-key directory, membership,
        // logical retention and expiry on each private E2EE read.
        $effective = (object) [
            ...(array) $grant,
            'media_state' => $media->state,
            'media_expires' => $media->expires_at,
            'actual_media_type' => $media->media_type,
            'actual_media_hash' => $media->contract_hash,
        ];
        MediaGrantEffectiveAccess::requireReadable($effective);
        $expiresAt = min((int) $grant->expires_at, (int) $media->expires_at);
        foreach ([
            $assignment->files_access_until ?? null,
            $assignment->assignment_access_until ?? null,
        ] as $cutoff) {
            if ($cutoff !== null) $expiresAt = min($expiresAt, (int) $cutoff);
        }
        abort_unless($expiresAt > PhotoSync::nowMs(), 410);

        return [
            'submissionId' => $receipt->id,
            'assignmentId' => $assignment->id,
            'contributorAccountId' => $contributorId,
            'mediaId' => $media->id,
            'grantId' => $grant->id,
            'expiresAt' => $expiresAt,
            'captureClaimPresent' => $v === 4,
            'cameraAttested' => false,
            'safeDerivativeVerified' => false,
            'ownerPrivateReadOnly' => true,
            'published' => false,
            'publicAuthorized' => false,
        ];
    }

    private function account(string $id): object
    {
        $account = DB::table('identity_accounts')
            ->where('id', $id)->where('status', 'ready')->first();
        abort_unless($account !== null
            && is_string($account->account_spki)
            && $account->account_spki !== '', 404);
        return $account;
    }

    /** @param list<string>|null $keys */
    private static function canonical(string $json, ?array $keys): array
    {
        abort_unless(strlen($json) > 2 && strlen($json) <= 30000, 410);
        try {
            $data = json_decode($json, true, 32, JSON_THROW_ON_ERROR);
            abort_unless(is_array($data) && !array_is_list($data)
                && json_encode($data, JSON_UNESCAPED_SLASHES | JSON_THROW_ON_ERROR) === $json, 410);
        } catch (Throwable) {
            abort(410);
        }
        if ($keys !== null) self::sameKeys($data, $keys);
        return $data;
    }

    /** @param list<string> $keys */
    private static function sameKeys(array $data, array $keys): void
    {
        $actual = array_keys($data);
        sort($actual, SORT_STRING);
        sort($keys, SORT_STRING);
        abort_unless($actual === $keys, 410);
    }

    private static function signed(string $spki, string $domain, string $json, string $signature): void
    {
        try {
            abort_unless(Protocol::verify($spki, $domain.$json, $signature), 410);
        } catch (Throwable) {
            abort(410);
        }
    }
}
