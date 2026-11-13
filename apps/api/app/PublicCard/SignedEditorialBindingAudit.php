<?php
declare(strict_types=1);

namespace App\PublicCard;

use App\Assignments\AssignmentRetention;
use App\Identity\Protocol;
use App\Photo\PhotoSync;
use Illuminate\Support\Facades\DB;
use Throwable;

/**
 * Strictly private, owner-only inspection of a SIGNED EDITORIAL association.
 *
 * This is NOT an assignment submission/accepted contributor grant and NEVER
 * authorizes anonymous access. The older file and assignment preview chains
 * are ceilings with publication=disabled, not public permissions.
 *
 * A future actual publication must independently verify client-flattened
 * image bytes, persistent authorization, real submission provenance when
 * relevant, and read-time signed grant/ACL/TTL/revocation.
 */
final class SignedEditorialBindingAudit
{
    private const DOMAIN = "pb3.safe-assignment-editorial-link.v1\n";

    private const CONTRACT_KEYS = [
        'version', 'linkId', 'operationId', 'ownerAccountId',
        'assignmentId', 'sourceMediaId', 'safeMediaId',
        'sourceContractHash', 'safeContractHash', 'assignmentRootHash',
        'expiresAt',
    ];

    private const FIELDS = [
        'description', 'capturedAt', 'updatedAt', 'tags',
        'authorTeam', 'gps', 'metadata',
    ];

    public function __construct(
        private readonly SignedPreviewCeilingAudit $ceilings = new SignedPreviewCeilingAudit(),
    ) {}

    /**
     * Owner-authenticated private read; caller MUST obtain accountId from
     * authenticated session, not bearer URL or browser-provided account ID.
     *
     * @return array{linkId:string,assignmentId:string,sourceMediaId:string,safeMediaId:string,expiresAt:int,candidateFields:array<string,bool>,effectivePublicFields:array<string,bool>,published:bool,linkKind:string}
     */
    public function inspect(string $accountId, string $safeMediaId): array
    {
        self::uuid($accountId);
        self::uuid($safeMediaId);

        $account = DB::table('identity_accounts')
            ->where('id', $accountId)->where('status', 'ready')->first();
        abort_unless($account !== null
            && is_string($account->account_spki) && $account->account_spki !== '', 404);

        $link = DB::table('safe_assignment_editorial_links_v1')
            ->where('safe_media_id', $safeMediaId)
            ->where('owner_account_id', $accountId)->first();
        abort_unless($link !== null, 404);
        abort_unless($link->state === 'active', 410);

        // A previously detached link must never be revived by editing only
        // its mutable state column back to "active".
        foreach ([
            'detach_operation_id', 'detach_contract_hash',
            'detach_contract_json', 'detach_signature',
        ] as $column) {
            abort_unless($link->{$column} === null, 409);
        }

        $json = $link->contract_json;
        abort_unless(is_string($json) && strlen($json) >= 90 && strlen($json) <= 6000, 409);
        try {
            $contract = json_decode($json, true, 16, JSON_THROW_ON_ERROR);
            abort_unless(is_array($contract) && !array_is_list($contract)
                && json_encode($contract, JSON_UNESCAPED_SLASHES | JSON_THROW_ON_ERROR) === $json, 409);
        } catch (Throwable) {
            abort(409);
        }
        $keys = array_keys($contract);
        $expected = self::CONTRACT_KEYS;
        sort($keys, SORT_STRING);
        sort($expected, SORT_STRING);
        abort_unless($keys === $expected
            && $contract['version'] === 1
            && is_int($contract['expiresAt'])
            && $contract['expiresAt'] > PhotoSync::nowMs(), 410);

        foreach ([
            'linkId', 'operationId', 'ownerAccountId', 'assignmentId',
            'sourceMediaId', 'safeMediaId',
        ] as $key) {
            self::uuid($contract[$key]);
        }
        foreach ([
            'sourceContractHash', 'safeContractHash', 'assignmentRootHash',
        ] as $hash) {
            self::digest($contract[$hash]);
        }
        abort_unless($contract['sourceMediaId'] !== $contract['safeMediaId']
            && $contract['ownerAccountId'] === $accountId
            && $contract['safeMediaId'] === $safeMediaId
            && $contract['linkId'] === $link->link_id
            && $contract['assignmentId'] === $link->assignment_id
            && $contract['sourceMediaId'] === $link->source_media_id
            && hash_equals($contract['sourceContractHash'], $link->source_contract_hash)
            && hash_equals($contract['safeContractHash'], $link->safe_contract_hash)
            && hash_equals($contract['assignmentRootHash'], $link->assignment_root_hash)
            && hash_equals(hash('sha256', $json), $link->contract_hash), 409);

        try {
            abort_unless(Protocol::verify(
                $account->account_spki,
                self::DOMAIN.$json,
                $link->account_signature
            ), 409);
        } catch (Throwable) {
            abort(409);
        }

        // The link is allowed only between media and assignment owned by
        // SAME account. A contributor's real signed submission is DIFFERENT
        // evidence and must never be impersonated by this editorial link.
        $assignment = DB::table('assignment_records_v1')
            ->where('id', $contract['assignmentId'])
            ->where('owner_account_id', $accountId)->first();
        abort_unless($assignment !== null, 404);
        abort_unless($assignment->state === 'active'
            && hash_equals($assignment->contract_hash, $contract['assignmentRootHash']), 410);
        AssignmentRetention::current($assignment);
        abort_unless(AssignmentRetention::filesOpen($assignment), 410);

        $files = DB::table('media_files_v1')->where('account_id', $accountId)
            ->whereIn('id', [$contract['sourceMediaId'], $safeMediaId])
            ->orderBy('id')->get()->keyBy('id');
        $source = $files->get($contract['sourceMediaId']);
        $safe = $files->get($safeMediaId);
        abort_unless($source !== null && $safe !== null, 404);
        foreach ([
            [$source, 'sourceContractHash'],
            [$safe, 'safeContractHash'],
        ] as [$row, $digest]) {
            abort_unless($row->media_type === 'photo'
                && $row->state === 'active'
                && (int) $row->expires_at > PhotoSync::nowMs()
                && hash_equals($row->contract_hash, $contract[$digest]), 410);
            abort_if(DB::table('media_tombstones_v1')
                ->where('media_id', $row->id)->exists(), 410);
            abort_if(DB::table('browser_archive_entries_v1')
                ->where('kind', 'media')->where('asset_id', $row->id)
                ->whereIn('state', ['archived', 'deleting'])->exists(), 410);
        }

        // Fully independent, signed canonical historical ceiling replays.
        // A ceiling field marked true is only the MAXIMUM prospective field,
        // NEVER publication permission.
        $file = $this->ceilings->file(
            $accountId, $contract['sourceMediaId'], $safeMediaId
        );
        $assignmentCeiling = $this->ceilings->assignment(
            $accountId, $contract['assignmentId']
        );

        $limits = [
            (int) $source->expires_at, (int) $safe->expires_at,
            $file['expiresAt'], $assignmentCeiling['expiresAt'],
        ];
        foreach ([
            $assignment->files_access_until ?? null,
            $assignment->assignment_access_until ?? null,
        ] as $deadline) {
            if ($deadline !== null) $limits[] = (int) $deadline;
        }
        abort_unless($contract['expiresAt'] <= min($limits), 410);

        $candidates = [];
        foreach (self::FIELDS as $field) {
            $candidates[$field] =
                $file['fields'][$field] === true
                && $assignmentCeiling['fields'][$field] === true;
        }

        return [
            'linkId' => $link->link_id,
            'assignmentId' => $contract['assignmentId'],
            'sourceMediaId' => $contract['sourceMediaId'],
            'safeMediaId' => $safeMediaId,
            'expiresAt' => $contract['expiresAt'],
            'candidateFields' => $candidates,
            'effectivePublicFields' => array_fill_keys(self::FIELDS, false),
            'published' => false,
            'linkKind' => 'owner-editorial-only',
        ];
    }

    private static function uuid(mixed $uuid): void
    {
        abort_unless(is_string($uuid) && preg_match(
            '/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/D',
            $uuid
        ) === 1, 409);
    }

    private static function digest(mixed $value): void
    {
        abort_unless(is_string($value)
            && preg_match('/^[0-9a-f]{64}$/D', $value) === 1, 409);
    }
}
