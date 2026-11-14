<?php

declare(strict_types=1);

namespace App\PublicCard;

use App\Identity\Protocol;
use App\Photo\PhotoSync;
use Illuminate\Support\Facades\DB;
use Throwable;

/**
 * READ-ONLY, OWNER-PRIVATE integrity/expiry gate for an intent journal.
 *
 * No PUBLIC access can follow from historical signed STAGE or REVOKE events.
 * Currently both signed preview ceilings have publication=disabled and all
 * actions false. There is no active grant, public-safe byte store, signed
 * contributor publishing authority or external token protocol.
 *
 * A future public issuer must implement independent live policy intersection,
 * contributor consent and a new ACTIVE grant, and check them at every read.
 * Never accept a bare owner-supplied accountId as session authentication.
 */
final class CurrentReadDenialGate
{
    private const ZERO = '0000000000000000000000000000000000000000000000000000000000000000';

    private const STAGE_KEYS = [
        'version', 'operationId', 'accountId', 'sourceMediaId', 'safeMediaId',
        'sourceContractHash', 'safeContractHash', 'safeDerivativeSha256',
        'tokenHash', 'revision', 'scope', 'expiresAt', 'fields', 'actions',
    ];

    private const REVOKE_KEYS = [
        'version', 'operationId', 'accountId', 'safeMediaId', 'tokenHash',
        'expectedRevision', 'previousEventHash', 'action',
    ];

    /**
     * No public reader or HTTP route invokes this (or exists at present).
     * Never return even a boolean "allowed" based on a hashed bearer.
     * All hashes, including STAGED and REVOKED, are intentionally denied.
     */
    public function requireAnonymousRead(string $opaqueTokenHash): never
    {
        // No bearer scheme has been approved; do not interpret or query input.
        // Uniform 404 avoids resource and revocation existence disclosure.
        abort(404);
    }

    /**
     * PRIVATE diagnostic for a *previously authenticated owner* only.
     * Re-verify actual SQL head, reservation(s), every stored P-256 signed
     * canonical event and live media/TTL. This is NOT a public read decision.
     *
     * @return array{safeMediaId:string,revision:int,state:string,eventHash:string,
     *               published:false,publicAuthorized:false,anonymousReadable:false}
     */
    public function inspectForOwner(string $accountId, string $safeMediaId): array
    {
        Protocol::uuid($accountId);
        Protocol::uuid($safeMediaId);

        return DB::transaction(function () use ($accountId, $safeMediaId): array {
            $account = DB::table('identity_accounts')
                ->where('id', $accountId)->where('status', 'ready')
                ->lockForUpdate()->first();
            abort_unless($account !== null && is_string($account->account_spki)
                && $account->account_spki !== '', 404);

            $head = DB::table('public_card_intent_heads_v1')
                ->where('safe_media_id', $safeMediaId)
                ->where('account_id', $accountId)->lockForUpdate()->first();
            abort_unless($head !== null && in_array($head->state, ['staged', 'revoked'], true)
                && is_string($head->source_media_id)
                && $head->source_media_id !== $safeMediaId, 404);

            // Intentionally bounded to 100 events. A larger history requires
            // separate verified checkpoint design; fail CLOSED, not skip events.
            $events = DB::table('public_card_intent_events_v1')
                ->where('safe_media_id', $safeMediaId)
                ->orderBy('revision')->limit(101)->get();
            abort_unless($events->count() >= 1 && $events->count() <= 100
                && $events->count() === (int) $head->revision, 409);

            $previous = self::ZERO;
            $state = '';
            $lastToken = null;
            $lastExpiration = null;
            $latestStage = null;
            foreach ($events as $i => $event) {
                $revision = $i + 1;
                abort_unless($event->account_id === $accountId
                    && $event->source_media_id === $head->source_media_id
                    && $event->safe_media_id === $safeMediaId
                    && (int) $event->revision === $revision
                    && hash_equals($previous, $event->previous_event_hash)
                    && in_array($event->kind, ['stage', 'revoke'], true)
                    && is_string($event->owner_signature), 409);

                $signed = self::canonical($event->signed_json);
                $keys = $event->kind === 'stage' ? self::STAGE_KEYS : self::REVOKE_KEYS;
                self::exact($signed, $keys);
                abort_unless($signed['version'] === 1
                    && $signed['operationId'] === $event->operation_id
                    && $signed['accountId'] === $accountId
                    && $signed['safeMediaId'] === $safeMediaId
                    && $signed['tokenHash'] === $event->token_hash, 409);

                if ($event->kind === 'stage') {
                    abort_unless($state !== 'staged'
                        && $signed['scope'] === 'safe-photo-view-v1'
                        && $signed['sourceMediaId'] === $head->source_media_id
                        && $signed['sourceMediaId'] !== $safeMediaId
                        && $signed['revision'] === $revision
                        && is_int($signed['expiresAt'])
                        && self::hash($signed['sourceContractHash'])
                        && self::hash($signed['safeContractHash'])
                        && self::hash($signed['safeDerivativeSha256'])
                        && self::hash($signed['tokenHash'])
                        && $signed['tokenHash'] !== $lastToken
                        && self::privateStageScope($signed), 409);
                    $reservation = DB::table('public_card_token_reservations_v1')
                        ->where('token_hash', $signed['tokenHash'])->first();
                    abort_unless($reservation !== null
                        && $reservation->account_id === $accountId
                        && $reservation->safe_media_id === $safeMediaId
                        && $reservation->stage_operation_id === $event->operation_id, 409);
                    $lastToken = $signed['tokenHash'];
                    $lastExpiration = $signed['expiresAt'];
                    $latestStage = $signed;
                    $state = 'staged';
                    $domain = SignedPublicationIntent::DOMAIN;
                } else {
                    abort_unless($state === 'staged'
                        && $signed['action'] === 'revoke'
                        && $signed['expectedRevision'] === $revision
                        && $signed['previousEventHash'] === $previous
                        && $signed['tokenHash'] === $lastToken, 409);
                    $state = 'revoked';
                    $domain = PublicationLedger::REVOKE_DOMAIN;
                }

                try {
                    abort_unless(Protocol::verify(
                        $account->account_spki,
                        $domain.$event->signed_json,
                        $event->owner_signature
                    ), 409);
                } catch (Throwable) {
                    abort(409);
                }

                $expectedHash = hash('sha256',
                    "pb3.public-card-intent-event.v1\n"
                    .$event->kind."\n".$accountId."\n".$safeMediaId."\n"
                    .$revision."\n".$previous."\n"
                    .hash('sha256', $event->signed_json)."\n"
                    .hash('sha256', $event->owner_signature)
                );
                abort_unless(hash_equals($expectedHash, $event->event_hash), 409);
                $previous = $expectedHash;
            }

            abort_unless($lastToken !== null && $lastExpiration !== null
                && $latestStage !== null && $state === $head->state
                && hash_equals($previous, $head->current_event_hash)
                && hash_equals($lastToken, $head->token_hash)
                && (int) $head->expires_at_ms === $lastExpiration, 409);

            if ($state === 'staged') {
                $now = PhotoSync::nowMs();
                abort_if($lastExpiration <= $now, 410);
                $rows = DB::table('media_files_v1')
                    ->whereIn('id', [$head->source_media_id, $safeMediaId])
                    ->orderBy('id')->lockForUpdate()->get()->keyBy('id');
                foreach ([
                    [$head->source_media_id, 'sourceContractHash'],
                    [$safeMediaId, 'safeContractHash'],
                ] as [$mediaId, $digestKey]) {
                    $media = $rows->get($mediaId);
                    abort_unless($media !== null
                        && $media->account_id === $accountId
                        && $media->media_type === 'photo'
                        && $media->state === 'active'
                        && (int) $media->expires_at > $now
                        && hash_equals($latestStage[$digestKey], $media->contract_hash), 410);
                    abort_if(DB::table('media_tombstones_v1')
                        ->where('media_id', $mediaId)->exists(), 410);
                    abort_if(DB::table('browser_archive_entries_v1')
                        ->where('kind', 'media')->where('asset_id', $mediaId)
                        ->whereIn('state', ['archived', 'deleting'])->exists(), 410);
                }
            }

            // No path to true: even a perfectly valid STAGED record cannot
            // upgrade a signed publication=disabled ceiling into public rights.
            return [
                'safeMediaId' => $safeMediaId,
                'revision' => (int) $head->revision,
                'state' => $state,
                'eventHash' => $previous,
                'published' => false,
                'publicAuthorized' => false,
                'anonymousReadable' => false,
            ];
        }, 3);
    }

    /** @return array<string,mixed> */
    private static function canonical(string $raw): array
    {
        abort_unless(strlen($raw) >= 120 && strlen($raw) <= 4096, 409);
        try {
            $json = json_decode($raw, true, 16, JSON_THROW_ON_ERROR);
            abort_unless(is_array($json) && !array_is_list($json)
                && json_encode($json, JSON_UNESCAPED_SLASHES | JSON_THROW_ON_ERROR) === $raw, 409);
        } catch (Throwable) {
            abort(409);
        }
        return $json;
    }

    /** @param array<string,mixed> $data @param list<string> $keys */
    private static function exact(array $data, array $keys): void
    {
        $actual = array_keys($data);
        sort($actual, SORT_STRING);
        sort($keys, SORT_STRING);
        abort_unless($actual === $keys, 409);
    }

    private static function hash(mixed $value): bool
    {
        return is_string($value)
            && preg_match('/^[0-9a-f]{64}$/D', $value) === 1;
    }

    /** @param array<string,mixed> $data */
    private static function privateStageScope(array $data): bool
    {
        if (!is_array($data['actions']) || array_is_list($data['actions'])
            || !is_array($data['fields']) || array_is_list($data['fields'])) {
            return false;
        }
        $actions = $data['actions'];
        $fields = $data['fields'];
        if (array_keys($actions) !== ['view', 'copy', 'download', 'share']
            || $actions !== [
                'view' => true, 'copy' => false,
                'download' => false, 'share' => false,
            ]) {
            return false;
        }
        foreach ([
            'description', 'capturedAt', 'updatedAt', 'tags',
            'authorTeam', 'gps', 'metadata',
        ] as $name) {
            if (!array_key_exists($name, $fields) || !is_bool($fields[$name])) return false;
            if (!in_array($name, ['description', 'capturedAt'], true)
                && $fields[$name] !== false) return false;
        }
        return count($fields) === 7;
    }
}
