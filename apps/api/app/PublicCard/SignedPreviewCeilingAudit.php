<?php
declare(strict_types=1);

namespace App\PublicCard;

use App\Assignments\AssignmentRetention;
use App\Identity\Protocol;
use App\Photo\PhotoSync;
use Illuminate\Support\Facades\DB;
use Throwable;

/**
 * Read-only, server-derived audit of existing owner-signed PRIVATE preview ceilings.
 *
 * Both existing wire protocols mandate publication=disabled and all actions=false.
 * A valid ceiling is NOT a grant, an effective public policy or an anonymous API.
 * Do not substitute these results for actual future signed publication authority.
 */
final class SignedPreviewCeilingAudit
{
    private const FILE_DOMAIN = "pb3.media-file-preview-policy.v1\n";
    private const ASSIGNMENT_DOMAIN = "pb3.assignment-preview-ceiling.v1\n";
    private const ROOT_DOMAIN = "pb3.assignment.v1\n";
    private const ZERO = '0000000000000000000000000000000000000000000000000000000000000000';
    private const FIELDS = [
        'description', 'capturedAt', 'updatedAt', 'tags',
        'authorTeam', 'gps', 'metadata',
    ];
    private const ACTIONS = ['view', 'copy', 'download', 'share'];

    /**
     * @return array{scope:string,revision:int,expiresAt:int,fields:array<string,bool>,actions:array<string,bool>,publication:string,published:bool}
     */
    public function file(string $accountId, string $sourceId, string $safeId): array
    {
        abort_unless($sourceId !== $safeId, 422);
        $spki = $this->accountSpki($accountId);
        $now = PhotoSync::nowMs();
        $rows = DB::table('media_files_v1')
            ->where('account_id', $accountId)
            ->whereIn('id', [$sourceId, $safeId])
            ->orderBy('id')->get()->keyBy('id');
        $source = $rows->get($sourceId);
        $safe = $rows->get($safeId);
        abort_unless($source !== null && $safe !== null, 404);
        foreach ([$source, $safe] as $media) {
            abort_unless($media->media_type === 'photo'
                && $media->state === 'active' && (int) $media->expires_at > $now, 410);
            abort_if(DB::table('media_tombstones_v1')
                ->where('media_id', $media->id)->exists(), 410);
            abort_if(DB::table('browser_archive_entries_v1')
                ->where('kind', 'media')->where('asset_id', $media->id)
                ->whereIn('state', ['archived', 'deleting'])->exists(), 410);
        }
        $head = DB::table('media_file_preview_policies_v1')
            ->where('safe_media_id', $safeId)->where('account_id', $accountId)->first();
        abort_unless($head !== null, 404);
        abort_unless($head->source_media_id === $sourceId
            && hash_equals($source->contract_hash, $head->source_contract_hash)
            && hash_equals($safe->contract_hash, $head->safe_contract_hash), 409);

        $events = DB::table('media_file_preview_policy_events_v1')
            ->where('safe_media_id', $safeId)->orderBy('to_revision')
            ->limit(101)->get();
        abort_unless($events->count() >= 1 && $events->count() <= 100, 409);
        $revision = 0;
        $previous = self::ZERO;
        $last = null;
        foreach ($events as $event) {
            $contract = self::contract($event->contract_json, [
                'version', 'operationId', 'accountId',
                'sourceMediaId', 'safeMediaId', 'sourceContractHash',
                'safeContractHash', 'fromRevision', 'toRevision',
                'previousPolicyHash', 'publication', 'fields', 'actions', 'expiresAt',
            ]);
            self::previewOnly($contract);
            abort_unless($contract['accountId'] === $accountId
                && $contract['sourceMediaId'] === $sourceId
                && $contract['safeMediaId'] === $safeId
                && hash_equals($source->contract_hash, $contract['sourceContractHash'])
                && hash_equals($safe->contract_hash, $contract['safeContractHash'])
                && $contract['operationId'] === $event->operation_id
                && $event->account_id === $accountId
                && $event->source_media_id === $sourceId
                && (int) $event->from_revision === $revision
                && (int) $event->to_revision === $revision + 1
                && $contract['fromRevision'] === $revision
                && $contract['toRevision'] === $revision + 1
                && hash_equals($previous, $event->previous_policy_hash)
                && hash_equals($previous, $contract['previousPolicyHash'])
                && hash_equals(hash('sha256', $event->contract_json), $event->contract_hash), 409);
            self::signed($spki, self::FILE_DOMAIN, $event->contract_json, $event->account_signature);
            $revision++;
            $previous = $event->contract_hash;
            $last = $contract;
            $lastEvent = $event;
        }

        abort_unless($last !== null
            && $head->revision == $revision
            && hash_equals($previous, $head->contract_hash)
            && hash_equals($lastEvent->contract_json, $head->contract_json)
            && hash_equals($lastEvent->account_signature, $head->account_signature)
            && (int) $head->expires_at_ms === $last['expiresAt']
            && (int) $head->expires_at_ms <= (int) $source->expires_at
            && (int) $head->expires_at_ms <= (int) $safe->expires_at, 409);
        abort_if((int) $head->expires_at_ms <= $now, 410);

        return self::display('file', $revision, $last);
    }

    /**
     * @return array{scope:string,revision:int,expiresAt:int,fields:array<string,bool>,actions:array<string,bool>,publication:string,published:bool}
     */
    public function assignment(string $accountId, string $assignmentId): array
    {
        $spki = $this->accountSpki($accountId);
        $now = PhotoSync::nowMs();
        $assignment = DB::table('assignment_records_v1')
            ->where('id', $assignmentId)
            ->where('owner_account_id', $accountId)->first();
        abort_unless($assignment !== null, 404);
        abort_unless($assignment->state === 'active'
            && hash_equals(hash('sha256', $assignment->contract_json), $assignment->contract_hash), 409);
        self::signed($spki, self::ROOT_DOMAIN,
            $assignment->contract_json, $assignment->owner_signature);
        $root = self::contract($assignment->contract_json, null);
        abort_unless(($root['version'] ?? null) === 1
            && ($root['assignmentId'] ?? null) === $assignmentId
            && ($root['ownerAccountId'] ?? null) === $accountId, 409);
        AssignmentRetention::current($assignment);
        abort_unless(AssignmentRetention::filesOpen($assignment, $now), 410);

        $head = DB::table('assignment_preview_ceilings_v1')
            ->where('assignment_id', $assignmentId)
            ->where('owner_account_id', $accountId)->first();
        abort_unless($head !== null, 404);
        abort_unless(hash_equals($assignment->contract_hash, $head->root_policy_hash), 409);
        $events = DB::table('assignment_preview_ceiling_events_v1')
            ->where('assignment_id', $assignmentId)->orderBy('to_revision')
            ->limit(101)->get();
        abort_unless($events->count() >= 1 && $events->count() <= 100, 409);
        $revision = 0;
        $previous = self::ZERO;
        $last = null;
        foreach ($events as $event) {
            $contract = self::contract($event->contract_json, [
                'version', 'operationId', 'assignmentId', 'ownerAccountId',
                'rootPolicyHash', 'fromRevision', 'toRevision',
                'previousPolicyHash', 'publication', 'fields', 'actions', 'expiresAt',
            ]);
            self::previewOnly($contract);
            abort_unless($contract['assignmentId'] === $assignmentId
                && $contract['ownerAccountId'] === $accountId
                && hash_equals($assignment->contract_hash, $contract['rootPolicyHash'])
                && $contract['operationId'] === $event->operation_id
                && $event->assignment_id === $assignmentId
                && $event->owner_account_id === $accountId
                && (int) $event->from_revision === $revision
                && (int) $event->to_revision === $revision + 1
                && $contract['fromRevision'] === $revision
                && $contract['toRevision'] === $revision + 1
                && hash_equals($previous, $event->previous_policy_hash)
                && hash_equals($previous, $contract['previousPolicyHash'])
                && hash_equals(hash('sha256', $event->contract_json), $event->contract_hash), 409);
            self::signed($spki, self::ASSIGNMENT_DOMAIN,
                $event->contract_json, $event->owner_signature);
            $revision++;
            $previous = $event->contract_hash;
            $last = $contract;
            $lastEvent = $event;
        }
        $cutoffs = array_filter([
            $assignment->files_access_until ?? null,
            $assignment->assignment_access_until ?? null,
        ], static fn ($v) => $v !== null);
        abort_unless($last !== null
            && $head->revision == $revision
            && hash_equals($previous, $head->contract_hash)
            && hash_equals($lastEvent->contract_json, $head->contract_json)
            && hash_equals($lastEvent->owner_signature, $head->owner_signature)
            && (int) $head->expires_at_ms === $last['expiresAt']
            && ($cutoffs === [] || (int) $head->expires_at_ms <= min(array_map('intval', $cutoffs))), 409);
        abort_if((int) $head->expires_at_ms <= $now, 410);
        return self::display('assignment', $revision, $last);
    }

    private function accountSpki(string $accountId): string
    {
        $account = DB::table('identity_accounts')
            ->where('id', $accountId)->where('status', 'ready')->first();
        abort_unless($account !== null
            && is_string($account->account_spki)
            && $account->account_spki !== '', 404);
        return $account->account_spki;
    }

    /** @param list<string>|null $exact */
    private static function contract(string $raw, ?array $exact): array
    {
        abort_unless(strlen($raw) >= 2 && strlen($raw) <= 5000, 409);
        try {
            $data = json_decode($raw, true, 16, JSON_THROW_ON_ERROR);
            abort_unless(is_array($data) && !array_is_list($data)
                && json_encode($data, JSON_UNESCAPED_SLASHES | JSON_THROW_ON_ERROR) === $raw, 409);
        } catch (Throwable) {
            abort(409);
        }
        if ($exact !== null) {
            $keys = array_keys($data);
            sort($keys, SORT_STRING);
            sort($exact, SORT_STRING);
            abort_unless($keys === $exact, 409);
        }
        return $data;
    }

    /** @param array<string,mixed> $contract */
    private static function previewOnly(array $contract): void
    {
        abort_unless($contract['version'] === 1
            && is_int($contract['fromRevision'])
            && is_int($contract['toRevision'])
            && $contract['fromRevision'] >= 0
            && $contract['fromRevision'] < 100
            && $contract['toRevision'] === $contract['fromRevision'] + 1
            && $contract['publication'] === 'disabled'
            && is_int($contract['expiresAt']) && $contract['expiresAt'] > 0, 409);
        foreach ([
            'fields' => self::FIELDS,
            'actions' => self::ACTIONS,
        ] as $name => $required) {
            $values = $contract[$name];
            abort_unless(is_array($values) && !array_is_list($values), 409);
            $actual = array_keys($values);
            sort($actual, SORT_STRING);
            sort($required, SORT_STRING);
            abort_unless($actual === $required, 409);
            foreach ($values as $value) abort_unless(is_bool($value), 409);
        }
        foreach ($contract['actions'] as $allowed) abort_unless($allowed === false, 409);
    }

    private static function signed(string $spki, string $domain, string $raw, string $signature): void
    {
        try {
            abort_unless(Protocol::verify($spki, $domain.$raw, $signature), 409);
        } catch (Throwable) {
            abort(409);
        }
    }

    /** @param array<string,mixed> $last */
    private static function display(string $scope, int $revision, array $last): array
    {
        return [
            'scope' => $scope,
            'revision' => $revision,
            'expiresAt' => $last['expiresAt'],
            'fields' => $last['fields'],
            'actions' => $last['actions'],
            'publication' => 'disabled',
            'published' => false,
        ];
    }
}
