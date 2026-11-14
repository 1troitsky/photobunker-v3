<?php

declare(strict_types=1);

namespace App\Panic;

use DomainException;
use Illuminate\Support\Facades\DB;

/**
 * #221: an inert, immutable server-side signed-intent PRE-FLIGHT record.
 *
 * NO API endpoint calls this class. Recording a signature is NOT emergency
 * PIN authentication, admission to destructive execution, a server-signed
 * receipt, device/session revocation, local wipe or cloud deletion.
 *
 * Before ANY future activation, the trusted controller must independently
 * authenticate the current server session (same-origin + CSRF) and an approved
 * Panic operation. An audited scheduler and separately signed ACK/GC ledger
 * do not exist. Do not build a worker on this table.
 */
final class PreparedIntentLedger
{
    private const TABLE = 'panic_preflight_intents_v1';
    private const UUID = '/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/D';

    /**
     * @param array<string,mixed> $signed original untrusted {contract,signature}
     * @return array{phase:'preflight_only',operationId:string,contractHash:string,replay:bool}
     * This result is a non-authorizing preflight record, NEVER an ACK/receipt.
     */
    public function prepare(array $signed, string $trustedAccountId, string $trustedDeviceId): array
    {
        self::uuid($trustedAccountId);
        self::uuid($trustedDeviceId);

        return DB::transaction(function () use ($signed, $trustedAccountId, $trustedDeviceId): array {
            // Account row lock serializes concurrent requests from multiple tabs
            // and devices within one account; the unique DB indexes are a second
            // line of defense across competing PostgreSQL processes.
            $account = DB::table('identity_accounts')
                ->where('id', $trustedAccountId)->lockForUpdate()->first();
            self::require($account !== null && $account->status === 'ready', 'panic.account_not_ready');
            self::require(is_numeric($account->revision) && (int) $account->revision >= 1,
                'panic.invalid_identity_revision');

            $device = DB::table('identity_devices')
                ->where('id', $trustedDeviceId)
                ->where('account_id', $trustedAccountId)
                ->lockForUpdate()->first();
            self::require($device !== null && $device->revoked_at === null
                && is_string($device->signing_spki) && $device->signing_spki !== '',
                'panic.device_unavailable');

            // Always recheck current device authority BEFORE replay admission.
            // This intentionally blocks old offline signatures after revocation
            // or key revision. Existing preflight rows are never destructive.
            $verified = SignedIntentPreflight::inspect(
                $signed,
                ['accountId' => $trustedAccountId,
                 'deviceId' => $trustedDeviceId,
                 'keyRevision' => (int) $account->revision],
                $device->signing_spki,
                (int) floor(microtime(true) * 1000),
            );

            $operationId = $verified['operationId'];
            $originalContract = $signed['contract'];
            $originalSignature = $signed['signature'];

            $priorOperation = DB::table(self::TABLE)
                ->where('operation_id', $operationId)->first();
            if ($priorOperation !== null) {
                self::same($priorOperation, $trustedAccountId, $trustedDeviceId,
                    $account->revision, $originalContract, $originalSignature, $verified['contractHash']);
                return self::decision($operationId, $verified['contractHash'], true);
            }

            // No other signed intent can replace the first one for this device
            // until a separately accepted lifecycle defines safe finalization.
            $priorDevice = DB::table(self::TABLE)
                ->where('account_id', $trustedAccountId)
                ->where('device_id', $trustedDeviceId)->first();
            self::require($priorDevice === null, 'panic.preflight_conflict');

            DB::table(self::TABLE)->insertOrIgnore([
                'operation_id' => $operationId,
                'account_id' => $trustedAccountId,
                'device_id' => $trustedDeviceId,
                'key_revision' => (int) $account->revision,
                'contract_hash' => $verified['contractHash'],
                'contract_json' => $originalContract,
                'signature' => $originalSignature,
                'phase' => 'preflight_only',
                'prepared_at' => now(),
            ]);

            // A cross-account operationId collision can race despite separate
            // account locks. The UNIQUE operationId and device-slot indexes
            // guarantee no overwrite; the subsequent read must match exact
            // immutable signed bytes or fail closed.
            $persisted = DB::table(self::TABLE)->where('operation_id', $operationId)->first();
            self::require($persisted !== null, 'panic.preflight_conflict');
            self::same($persisted, $trustedAccountId, $trustedDeviceId,
                $account->revision, $originalContract, $originalSignature, $verified['contractHash']);

            return self::decision($operationId, $verified['contractHash'], false);
        }, 3);
    }

    /**
     * The function name is intentionally not 'acknowledge' or 'admitDelete'.
     * There is no public execution or completion transition.
     */
    private static function decision(string $operationId, string $contractHash, bool $replay): array
    {
        return [
            'phase' => 'preflight_only',
            'operationId' => $operationId,
            'contractHash' => $contractHash,
            'replay' => $replay,
        ];
    }

    private static function same(
        object $record, string $accountId, string $deviceId, int $revision,
        string $contract, string $signature, string $contractHash,
    ): void {
        self::require($record->phase === 'preflight_only'
            && $record->account_id === $accountId
            && $record->device_id === $deviceId
            && (int) $record->key_revision === $revision
            && hash_equals($record->contract_hash, $contractHash)
            && hash_equals($record->contract_json, $contract)
            && hash_equals($record->signature, $signature), 'panic.preflight_conflict');
    }

    private static function uuid(string $id): void
    {
        self::require(preg_match(self::UUID, $id) === 1, 'panic.invalid_scope');
    }

    private static function require(bool $valid, string $reason): void
    {
        if (!$valid) {
            throw new DomainException($reason);
        }
    }
}
