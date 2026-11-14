<?php
declare(strict_types=1);

namespace App\Administration;

use DomainException;
use Illuminate\Support\Facades\DB;
use Throwable;

/**
 * #227 real, serialized, durable AdminAuditEntry RECORDING ONLY.
 *
 * The caller MUST have already authenticated session + independent MFA/grant
 * proof and construct AdminPrincipal from trustworthy server-side evidence.
 * A caller-created AdminPrincipal is not itself authorization evidence.
 *
 * This class records a proposed action, but NEVER performs it, issues a grant,
 * blocks/revokes a device, writes a session, or exposes E2EE user data.
 * SHA256 chaining detects accidental database inconsistencies; it is NOT
 * tamper-evidence against a privileged DB attacker until an externally signed
 * anchor exists and independent verification is approved.
 */
final class AdminAuditLedger
{
    private const HEAD_TABLE = 'admin_audit_heads_v1';
    private const EVENT_TABLE = 'admin_audit_records_v1';
    private const ZERO_DIGEST = '0000000000000000000000000000000000000000000000000000000000000000';
    private const EVENT_KEYS = [
        'version', 'operationId', 'actorId', 'action', 'targetType',
        'targetReference', 'reasonCode', 'issuedAtMs', 'expiresAtMs',
        'previousDigest', 'digest',
    ];

    /**
     * Record a safe audit event; does NOT authorize/execute its action.
     * A byte-identical semantic replay is idempotent while CURRENT role/MFA
     * permissions remain valid. Reusing operationId for any different input
     * fails closed; rows are never overwritten.
     *
     * @return array{state:'recorded_only',operationId:string,digest:string,replay:bool}
     */
    public function record(
        AdminPrincipal $trustedActor,
        string $operationId,
        string $action,
        string $targetType,
        string $targetReference,
        string $reasonCode,
        ?int $expiresAtMs,
    ): array {
        return DB::transaction(static function () use (
            $trustedActor, $operationId, $action, $targetType,
            $targetReference, $reasonCode, $expiresAtMs,
        ): array {
            $nowMs = (int) now()->getTimestampMs();
            AdminPolicy::requireAllowed($trustedActor, $action, $nowMs);

            $head = DB::table(self::HEAD_TABLE)->where('id', 1)
                ->lockForUpdate()->first();
            self::require($head !== null
                && is_numeric($head->revision)
                && (int) $head->revision >= 0
                && is_string($head->last_digest)
                && preg_match('/^[0-9a-f]{64}$/D', $head->last_digest) === 1);

            // Detect a missing/deleted latest row and a silently rewritten
            // head without scanning the whole stream per write.
            $last = DB::table(self::EVENT_TABLE)->orderByDesc('sequence')->first();
            if ($last !== null) {
                self::assertValidRecord($last);
            }
            self::require(
                ((int) $head->revision === 0 && $last === null
                    && $head->last_digest === self::ZERO_DIGEST)
                || ((int) $head->revision > 0 && $last !== null
                    && is_string($last->digest)
                    && hash_equals($head->last_digest, $last->digest)),
            );

            $prior = DB::table(self::EVENT_TABLE)
                ->where('operation_id', $operationId)->first();
            if ($prior !== null) {
                // Replay can never use an expired/revoked *current* MFA grant;
                // policy was checked above against server time.
                self::assertValidRecord($prior);
                self::require($prior->actor_id === $trustedActor->accountId
                    && $prior->action === $action
                    && $prior->target_type === $targetType
                    && $prior->target_reference === $targetReference
                    && $prior->reason_code === $reasonCode
                    && ($prior->expires_at_ms === null ? null : (int) $prior->expires_at_ms)
                        === $expiresAtMs);
                return self::result($operationId, $prior->digest, true);
            }

            // Existing core AdminAuditEntry gives a strict, versioned,
            // privacy-minimized payload and rejects unknown role/action,
            // untrusted reason/IP target, or dangerous TTL widening.
            try {
                $event = AdminAuditEntry::draft(
                    $trustedActor, $operationId, $action, $targetType,
                    $targetReference, $reasonCode, $nowMs, $expiresAtMs,
                    $head->last_digest,
                );
            } catch (Throwable) {
                throw new DomainException('admin.audit_denied');
            }
            $data = $event->jsonSerialize();
            $json = json_encode($data, JSON_UNESCAPED_SLASHES | JSON_THROW_ON_ERROR);

            DB::table(self::EVENT_TABLE)->insert([
                'operation_id' => $operationId,
                'actor_id' => $trustedActor->accountId,
                'action' => $action,
                'target_type' => $targetType,
                'target_reference' => $targetReference,
                'reason_code' => $reasonCode,
                'issued_at_ms' => $nowMs,
                'expires_at_ms' => $expiresAtMs,
                'previous_digest' => $head->last_digest,
                'digest' => $event->digest,
                'event_json' => $json,
                'created_at' => now(),
            ]);
            $changed = DB::table(self::HEAD_TABLE)->where('id', 1)
                ->where('revision', $head->revision)
                ->where('last_digest', $head->last_digest)
                ->update([
                    'revision' => ((int) $head->revision) + 1,
                    'last_digest' => $event->digest,
                ]);
            self::require($changed === 1);

            return self::result($operationId, $event->digest, false);
        }, 3);
    }

    /**
     * Read-only consistency audit. This does not prove resistance to an attacker
     * who can rewrite BOTH events and the head; that needs external anchoring.
     * Streams rows so checking a large ledger is bounded in PHP memory.
     *
     * @return array{state:'database_consistent_only',count:int,lastDigest:string}
     */
    public function verifyChain(): array
    {
        return DB::transaction(static function (): array {
            $head = DB::table(self::HEAD_TABLE)->where('id', 1)
                ->sharedLock()->first();
            self::require($head !== null);
            $lastDigest = self::ZERO_DIGEST;
            $count = 0;
            foreach (DB::table(self::EVENT_TABLE)->orderBy('sequence')->cursor() as $row) {
                self::assertValidRecord($row);
                self::require(hash_equals($lastDigest, $row->previous_digest));
                $lastDigest = $row->digest;
                $count++;
            }
            self::require((int) $head->revision === $count
                && is_string($head->last_digest)
                && hash_equals($lastDigest, $head->last_digest));
            return [
                'state' => 'database_consistent_only',
                'count' => $count,
                'lastDigest' => $lastDigest,
            ];
        });
    }

    private static function assertValidRecord(object $row): void
    {
        self::require(is_string($row->event_json)
            && strlen($row->event_json) <= 2048
            && is_string($row->digest)
            && preg_match('/^[0-9a-f]{64}$/D', $row->digest) === 1
            && is_string($row->previous_digest)
            && preg_match('/^[0-9a-f]{64}$/D', $row->previous_digest) === 1);
        try {
            $data = json_decode($row->event_json, true, 16, JSON_THROW_ON_ERROR);
            self::require(is_array($data)
                && array_keys($data) === self::EVENT_KEYS
                && json_encode($data, JSON_UNESCAPED_SLASHES | JSON_THROW_ON_ERROR)
                    === $row->event_json);
            $original = $data;
            unset($original['digest']);
            $digest = hash('sha256',
                json_encode($original, JSON_UNESCAPED_SLASHES | JSON_THROW_ON_ERROR));
            self::require(hash_equals($digest, $row->digest)
                && $data['digest'] === $row->digest
                && $data['previousDigest'] === $row->previous_digest
                && $data['operationId'] === $row->operation_id
                && $data['actorId'] === $row->actor_id
                && $data['action'] === $row->action
                && $data['targetType'] === $row->target_type
                && $data['targetReference'] === $row->target_reference
                && $data['reasonCode'] === $row->reason_code
                && $data['issuedAtMs'] === (int) $row->issued_at_ms
                && $data['expiresAtMs']
                    === ($row->expires_at_ms === null ? null : (int) $row->expires_at_ms));
        } catch (Throwable) {
            throw new DomainException('admin.audit_inconsistent');
        }
    }

    /** @return array{state:'recorded_only',operationId:string,digest:string,replay:bool} */
    private static function result(string $operationId, string $digest, bool $replay): array
    {
        return [
            'state' => 'recorded_only',
            'operationId' => $operationId,
            'digest' => $digest,
            'replay' => $replay,
        ];
    }

    private static function require(bool $condition): void
    {
        if (!$condition) {
            throw new DomainException('admin.audit_inconsistent');
        }
    }
}
