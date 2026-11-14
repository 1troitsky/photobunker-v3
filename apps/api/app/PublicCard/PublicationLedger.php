<?php
declare(strict_types=1);

namespace App\PublicCard;

use App\Identity\Protocol;
use App\Photo\PhotoSync;
use Illuminate\Support\Facades\DB;
use Throwable;

/**
 * Private signed publication INTENT journal. No public URL, read, or grant.
 * All current heads are STAGED or REVOKED, NEVER published.
 * A future publisher must independently verify live assignment/file policy
 * chains, flatten and inspect a safe JPEG, and create a separate read gate.
 */
final class PublicationLedger
{
    public const REVOKE_DOMAIN = "pb3.public-card-revocation.v1\n";
    private const ZERO_HASH = '0000000000000000000000000000000000000000000000000000000000000000';

    /**
     * @param array<string,mixed> $trusted Server-verified policy snapshot, never client data.
     * @return array{safeMediaId:string,revision:int,state:string,published:bool,unchanged:bool,eventHash:string}
     */
    public function stage(string $json, string $signature, array $trusted): array
    {
        $nowMs = PhotoSync::nowMs();
        $intent = SignedPublicationIntent::verify($json, $signature, $trusted, $nowMs);
        return DB::transaction(function () use ($json, $signature, $trusted, $intent, $nowMs): array {
            $account = $this->account($intent['accountId']);
            abort_unless(hash_equals($account->account_spki, $trusted['accountSpki']), 403);
            $existing = DB::table('public_card_intent_events_v1')
                ->where('operation_id', $intent['operationId'])->first();
            if ($existing !== null) {
                abort_unless($existing->kind === 'stage'
                    && hash_equals($existing->signed_json, $json)
                    && $existing->account_id === $intent['accountId']
                    && $existing->safe_media_id === $intent['safeMediaId'], 409);
                $head = DB::table('public_card_intent_heads_v1')
                    ->where('safe_media_id', $intent['safeMediaId'])->first();
                abort_unless($head !== null, 409);
                return $this->result($head, true);
            }
            $this->checkCurrentMedia($intent, $trusted, $nowMs);
            $head = DB::table('public_card_intent_heads_v1')
                ->where('safe_media_id', $intent['safeMediaId'])
                ->lockForUpdate()->first();
            $revision = $head === null ? 1 : (int) $head->revision + 1;
            abort_unless($revision === $intent['revision']
                && ($head === null || ($head->state === 'revoked'
                    && $head->account_id === $intent['accountId']
                    && $head->source_media_id === $intent['sourceMediaId'])), 409);
            $previous = $head === null ? self::ZERO_HASH : $head->current_event_hash;
            abort_if(DB::table('public_card_token_reservations_v1')
                ->where('token_hash', $intent['tokenHash'])->exists(), 409);
            $hash = self::eventHash('stage', $intent['accountId'], $intent['safeMediaId'],
                $revision, $previous, $json, $signature);
            DB::table('public_card_token_reservations_v1')->insert([
                'token_hash' => $intent['tokenHash'],
                'account_id' => $intent['accountId'],
                'safe_media_id' => $intent['safeMediaId'],
                'stage_operation_id' => $intent['operationId'],
                'created_at' => now(),
            ]);
            $this->appendEvent($intent['operationId'], $intent['accountId'],
                $intent['sourceMediaId'], $intent['safeMediaId'], $revision,
                'stage', $previous, $hash, $intent['tokenHash'], $json, $signature);
            $row = [
                'account_id' => $intent['accountId'],
                'source_media_id' => $intent['sourceMediaId'],
                'revision' => $revision,
                'state' => 'staged',
                'current_event_hash' => $hash,
                'token_hash' => $intent['tokenHash'],
                'expires_at_ms' => $intent['expiresAt'],
                'updated_at' => now(),
            ];
            if ($head !== null) {
                DB::table('public_card_intent_heads_v1')
                    ->where('safe_media_id', $intent['safeMediaId'])->update($row);
            } else {
                DB::table('public_card_intent_heads_v1')->insert([
                    'safe_media_id' => $intent['safeMediaId'],
                    ...$row, 'created_at' => now(),
                ]);
            }
            $current = DB::table('public_card_intent_heads_v1')
                ->where('safe_media_id', $intent['safeMediaId'])->first();
            return $this->result($current, false);
        }, 3);
    }

    /**
     * Signed durable revocation; allowed after media expiry.
     * @return array{safeMediaId:string,revision:int,state:string,published:bool,unchanged:bool,eventHash:string}
     */
    public function revoke(string $json, string $signature): array
    {
        abort_unless(strlen($json) >= 160 && strlen($json) <= 2048, 422);
        try {
            $c = json_decode($json, true, 16, JSON_THROW_ON_ERROR);
        } catch (Throwable) {
            abort(422);
        }
        abort_unless(is_array($c) && !array_is_list($c), 422);
        self::exact($c, ['version', 'operationId', 'accountId', 'safeMediaId',
            'tokenHash', 'expectedRevision', 'previousEventHash', 'action']);
        abort_unless(json_encode($c, JSON_UNESCAPED_SLASHES | JSON_THROW_ON_ERROR) === $json
            && $c['version'] === 1 && $c['action'] === 'revoke'
            && is_int($c['expectedRevision'])
            && $c['expectedRevision'] >= 2 && $c['expectedRevision'] <= 1_000_000, 422);
        foreach (['operationId', 'accountId', 'safeMediaId'] as $name) self::uuid($c[$name]);
        foreach (['tokenHash', 'previousEventHash'] as $name) self::digest($c[$name]);
        return DB::transaction(function () use ($json, $signature, $c): array {
            $account = $this->account($c['accountId']);
            abort_unless(Protocol::verify($account->account_spki,
                self::REVOKE_DOMAIN.$json, $signature), 401);
            $existing = DB::table('public_card_intent_events_v1')
                ->where('operation_id', $c['operationId'])->first();
            if ($existing !== null) {
                abort_unless($existing->kind === 'revoke'
                    && $existing->account_id === $c['accountId']
                    && $existing->safe_media_id === $c['safeMediaId']
                    && hash_equals($existing->signed_json, $json), 409);
                $head = DB::table('public_card_intent_heads_v1')
                    ->where('safe_media_id', $c['safeMediaId'])->first();
                abort_unless($head !== null, 409);
                return $this->result($head, true);
            }
            $head = DB::table('public_card_intent_heads_v1')
                ->where('safe_media_id', $c['safeMediaId'])->lockForUpdate()->first();
            abort_unless($head !== null && $head->account_id === $c['accountId'], 404);
            abort_unless($head->state === 'staged'
                && (int) $head->revision + 1 === $c['expectedRevision']
                && hash_equals($head->current_event_hash, $c['previousEventHash'])
                && hash_equals($head->token_hash, $c['tokenHash']), 409);
            $eventHash = self::eventHash('revoke', $c['accountId'], $c['safeMediaId'],
                $c['expectedRevision'], $head->current_event_hash, $json, $signature);
            $this->appendEvent($c['operationId'], $c['accountId'], $head->source_media_id,
                $c['safeMediaId'], $c['expectedRevision'], 'revoke',
                $head->current_event_hash, $eventHash, $c['tokenHash'], $json, $signature);
            DB::table('public_card_intent_heads_v1')
                ->where('safe_media_id', $c['safeMediaId'])->update([
                    'revision' => $c['expectedRevision'],
                    'state' => 'revoked', 'current_event_hash' => $eventHash,
                    'updated_at' => now(),
                ]);
            $current = DB::table('public_card_intent_heads_v1')
                ->where('safe_media_id', $c['safeMediaId'])->first();
            return $this->result($current, false);
        }, 3);
    }

    /** Private owner audit, never a public authorization or content response. */
    public function statusForOwner(string $accountId, string $safeMediaId): array
    {
        $head = DB::table('public_card_intent_heads_v1')
            ->where('safe_media_id', $safeMediaId)
            ->where('account_id', $accountId)->first();
        abort_unless($head !== null, 404);
        return $this->result($head, true);
    }

    private function account(string $id): object
    {
        $row = DB::table('identity_accounts')->where('id', $id)->lockForUpdate()->first();
        abort_unless($row !== null && $row->status === 'ready'
            && is_string($row->account_spki) && $row->account_spki !== '', 403);
        return $row;
    }

    /** @param array<string,mixed> $intent @param array<string,mixed> $trusted */
    private function checkCurrentMedia(array $intent, array $trusted, int $nowMs): void
    {
        $rows = DB::table('media_files_v1')
            ->whereIn('id', [$intent['sourceMediaId'], $intent['safeMediaId']])
            ->orderBy('id')->lockForUpdate()->get()->keyBy('id');
        foreach ([[$intent['sourceMediaId'], 'source'],
                  [$intent['safeMediaId'], 'safe']] as [$id, $name]) {
            $row = $rows->get($id);
            abort_unless($row !== null && $row->account_id === $intent['accountId']
                && $row->media_type === 'photo' && $row->state === 'active'
                && (int) $row->expires_at > $nowMs
                && hash_equals($row->contract_hash, $trusted[$name.'ContractHash'])
                && (int) $row->expires_at === $trusted[$name.'ExpiresAt'], 409);
            abort_if(DB::table('media_tombstones_v1')->where('media_id', $id)->exists(), 410);
            abort_if(DB::table('browser_archive_entries_v1')->where('kind', 'media')
                ->where('asset_id', $id)->whereIn('state', ['archived', 'deleting'])->exists(), 410);
        }
    }

    private function appendEvent(string $operation, string $account, string $source,
        string $safe, int $revision, string $kind, string $previous, string $hash,
        string $tokenHash, string $json, string $signature): void
    {
        DB::table('public_card_intent_events_v1')->insert([
            'operation_id' => $operation, 'account_id' => $account,
            'source_media_id' => $source, 'safe_media_id' => $safe,
            'revision' => $revision, 'kind' => $kind,
            'previous_event_hash' => $previous, 'event_hash' => $hash,
            'token_hash' => $tokenHash, 'signed_json' => $json,
            'owner_signature' => $signature, 'created_at' => now(),
        ]);
    }

    private static function eventHash(string $kind, string $account, string $safe,
        int $revision, string $previous, string $json, string $signature): string
    {
        return hash('sha256', "pb3.public-card-intent-event.v1\n"
            .$kind."\n".$account."\n".$safe."\n".$revision."\n".$previous
            ."\n".hash('sha256', $json)."\n".hash('sha256', $signature));
    }

    private function result(object $head, bool $unchanged): array
    {
        return ['safeMediaId' => $head->safe_media_id,
            'revision' => (int) $head->revision,
            'state' => $head->state, 'published' => false,
            'unchanged' => $unchanged, 'eventHash' => $head->current_event_hash];
    }

    /** @param list<string> $keys */
    private static function exact(array $value, array $keys): void
    {
        $actual = array_keys($value);
        sort($actual, SORT_STRING);
        sort($keys, SORT_STRING);
        abort_unless($actual === $keys, 422);
    }

    private static function uuid(mixed $value): void
    {
        abort_unless(is_string($value) && preg_match(
            '/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/D',
            $value) === 1, 422);
    }

    private static function digest(mixed $value): void
    {
        abort_unless(is_string($value)
            && preg_match('/^[0-9a-f]{64}$/D', $value) === 1, 422);
    }
}
