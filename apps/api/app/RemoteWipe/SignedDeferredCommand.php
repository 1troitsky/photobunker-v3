<?php
declare(strict_types=1);

namespace App\RemoteWipe;

use App\Identity\Protocol as IdentityProtocol;
use Illuminate\Database\UniqueConstraintViolationException;
use Illuminate\Support\Facades\DB;

/**
 * Durable, signed LOCAL-only wipe command for a device already revoked by
 * Identity. No HTTP route is mounted: integration must join the #80 signed
 * device-revoke transaction to eliminate a revoke->command gap.
 *
 * This service never deletes ciphertext, keys, backups, Matrix state or
 * the device record. A target signature is a self-reported receipt, NOT
 * cryptographic proof of device storage deletion.
 */
final class SignedDeferredCommand
{
    private const COMMAND_DOMAIN = "pb3.remote-wipe-command.v1\n";
    private const RECEIPT_DOMAIN = "pb3.remote-wipe-receipt.v1\n";
    private const SCOPE = 'device-local-only';

    private static function positiveRevision(mixed $value): int
    {
        abort_unless(is_int($value) && $value >= 1 && $value <= 999999999, 422);
        return $value;
    }

    private static function json(array $values): string
    {
        return json_encode($values, JSON_UNESCAPED_SLASHES | JSON_THROW_ON_ERROR);
    }

    public static function commandMessage(array $payload): string
    {
        IdentityProtocol::exact($payload, [
            'version', 'operationId', 'accountId', 'actorDeviceId',
            'targetDeviceId', 'accountRevision', 'scope',
        ]);
        abort_unless($payload['version'] === 1 && $payload['scope'] === self::SCOPE, 422);
        foreach (['operationId', 'accountId', 'actorDeviceId', 'targetDeviceId'] as $key) {
            abort_unless(is_string($payload[$key]), 422);
            IdentityProtocol::uuid($payload[$key]);
        }
        self::positiveRevision($payload['accountRevision']);
        abort_unless($payload['actorDeviceId'] !== $payload['targetDeviceId'], 422);

        // Fixed wire order: never sign raw untrusted JSON or client property order.
        return self::COMMAND_DOMAIN.self::json([
            'version' => 1,
            'operationId' => $payload['operationId'],
            'accountId' => $payload['accountId'],
            'actorDeviceId' => $payload['actorDeviceId'],
            'targetDeviceId' => $payload['targetDeviceId'],
            'accountRevision' => $payload['accountRevision'],
            'scope' => self::SCOPE,
        ]);
    }

    public static function receiptMessage(array $payload): string
    {
        IdentityProtocol::exact($payload, [
            'version', 'operationId', 'accountId', 'targetDeviceId',
            'commandSha256', 'result',
        ]);
        abort_unless($payload['version'] === 1
            && $payload['result'] === 'local_wipe_reported', 422);
        foreach (['operationId', 'accountId', 'targetDeviceId'] as $key) {
            abort_unless(is_string($payload[$key]), 422);
            IdentityProtocol::uuid($payload[$key]);
        }
        abort_unless(is_string($payload['commandSha256'])
            && preg_match('/^[a-f0-9]{64}$/D', $payload['commandSha256']) === 1, 422);

        return self::RECEIPT_DOMAIN.self::json([
            'version' => 1,
            'operationId' => $payload['operationId'],
            'accountId' => $payload['accountId'],
            'targetDeviceId' => $payload['targetDeviceId'],
            'commandSha256' => $payload['commandSha256'],
            'result' => 'local_wipe_reported',
        ]);
    }

    private static function status(object $row, bool $unchanged): array
    {
        return [
            'operationId' => $row->operation_id,
            'targetDeviceId' => $row->target_device_id,
            'pb3Revoked' => true,
            'localWipeStatus' => $row->target_reported_at === null
                ? 'wipe_pending' : 'target_reported_local_wipe',
            'localWipeProven' => false,
            'matrixRemoteRevoked' => false,
            'cloudDeleted' => false,
            'backupDeleted' => false,
            'unchanged' => $unchanged,
        ];
    }

    /**
     * Caller identity MUST come from an already authenticated server session,
     * never from client-provided fields. This service also rechecks the
     * account, actor and target under DB locks, plus BOTH P-256 signatures.
     * A prior signed revoke (#80) is a strict prerequisite; this does not
     * fabricate or replay that revoke.
     */
    public function register(
        string $authenticatedAccountId,
        string $authenticatedActorDeviceId,
        array $payload,
        string $accountSignature,
        string $actorSignature,
    ): array {
        $message = self::commandMessage($payload);
        IdentityProtocol::uuid($authenticatedAccountId);
        IdentityProtocol::uuid($authenticatedActorDeviceId);
        abort_unless(hash_equals($authenticatedAccountId, $payload['accountId'])
            && hash_equals($authenticatedActorDeviceId, $payload['actorDeviceId']), 401);
        $hash = hash('sha256', $message);

        try {
            return DB::transaction(function () use (
                $payload, $message, $hash, $accountSignature, $actorSignature
            ): array {
            // Global lock order is account -> actor -> target -> command.
            // This serializes different operation IDs racing for one target.
            $account = DB::table('identity_accounts')
                ->where('id', $payload['accountId'])->lockForUpdate()->first();
            abort_unless($account && $account->status === 'ready'
                && (int) $account->revision === $payload['accountRevision']
                && is_string($account->account_spki), 401);

            $actor = DB::table('identity_devices')
                ->where('id', $payload['actorDeviceId'])
                ->where('account_id', $account->id)->lockForUpdate()->first();
            abort_unless($actor && $actor->revoked_at === null, 401);

            $target = DB::table('identity_devices')
                ->where('id', $payload['targetDeviceId'])
                ->where('account_id', $account->id)->lockForUpdate()->first();
            abort_unless($target && $target->revoked_at !== null, 409);

            abort_unless(IdentityProtocol::verify($account->account_spki, $message, $accountSignature)
                && IdentityProtocol::verify($actor->signing_spki, $message, $actorSignature), 401);

            $prior = DB::table('remote_wipe_commands')
                ->where('operation_id', $payload['operationId'])->lockForUpdate()->first();
            if ($prior !== null) {
                abort_unless($prior->account_id === $account->id
                    && $prior->actor_device_id === $actor->id
                    && $prior->target_device_id === $target->id
                    && hash_equals($prior->command_sha256, $hash), 409);
                return self::status($prior, true);
            }

            // Even a different, correctly signed operation ID MUST NOT
            // create a second target command or overwrite a receipt.
            abort_if(DB::table('remote_wipe_commands')
                ->where('target_device_id', $target->id)->exists(), 409);

            $timestamp = now();
            DB::table('remote_wipe_commands')->insert([
                'operation_id' => $payload['operationId'],
                'account_id' => $account->id,
                'actor_device_id' => $actor->id,
                'target_device_id' => $target->id,
                'account_revision' => $payload['accountRevision'],
                'command_sha256' => $hash,
                'command_payload' => substr($message, strlen(self::COMMAND_DOMAIN)),
                'account_signature' => $accountSignature,
                'actor_signature' => $actorSignature,
                'target_revoked_at' => $target->revoked_at,
                'created_at' => $timestamp,
                'updated_at' => $timestamp,
            ]);
            $created = DB::table('remote_wipe_commands')
                ->where('operation_id', $payload['operationId'])->first();
            abort_unless($created !== null, 500);
            return self::status($created, false);
            });
        } catch (UniqueConstraintViolationException $exception) {
            // A second, genuinely concurrent actor/account may have passed
            // preflight while another transaction's UNIQUE insert was still
            // invisible. PostgreSQL then reports 23505 after waiting for the
            // winning transaction to commit. Do not expose an SQL/HTTP 500
            // or adopt another account's operationId: this is an intentional
            // fail-closed, never-successful command collision.
            //
            // Only command-table operation/target UNIQUE constraints map to
            // conflict. All unrelated DB failures still surface as errors.
            $sqlstate = (string) ($exception->errorInfo[0] ?? '');
            $details = $exception->getMessage();
            if (in_array($sqlstate, ['23505', '23000'], true)
                && (str_contains($details, 'remote_wipe_commands_pkey')
                    || str_contains($details, 'remote_wipe_commands_target_device_id_unique')
                    || str_contains($details, 'remote_wipe_commands.operation_id')
                    || str_contains($details, 'remote_wipe_commands.target_device_id'))) {
                abort(409);
            }
            throw $exception;
        }
    }

    /**
     * Special receipt boundary for a REVOKED target's original signing key.
     * It cannot restore PB3 authentication and MUST NOT be exposed as an
     * ordinary session/device login route. The signed self-report does not
     * attest that storage or Matrix credentials were actually destroyed.
     */
    public function receiveTargetReport(array $receipt, string $targetSignature): array
    {
        $message = self::receiptMessage($receipt);
        $hash = hash('sha256', $message);
        return DB::transaction(function () use ($receipt, $message, $hash, $targetSignature): array {
            $account = DB::table('identity_accounts')
                ->where('id', $receipt['accountId'])->lockForUpdate()->first();
            abort_unless($account && $account->status === 'ready', 404);

            $row = DB::table('remote_wipe_commands')
                ->where('operation_id', $receipt['operationId'])->lockForUpdate()->first();
            abort_unless($row && $row->account_id === $account->id
                && $row->target_device_id === $receipt['targetDeviceId']
                && hash_equals($row->command_sha256, $receipt['commandSha256']), 404);

            $target = DB::table('identity_devices')
                ->where('id', $row->target_device_id)
                ->where('account_id', $account->id)->first();
            abort_unless($target && $target->revoked_at !== null, 401);
            abort_unless(IdentityProtocol::verify($target->signing_spki, $message, $targetSignature), 401);

            if ($row->target_reported_at !== null) {
                abort_unless(is_string($row->target_receipt_sha256)
                    && hash_equals($row->target_receipt_sha256, $hash), 409);
                return self::status($row, true);
            }

            DB::table('remote_wipe_commands')
                ->where('operation_id', $row->operation_id)
                ->whereNull('target_reported_at')
                ->update([
                    'target_reported_at' => now(),
                    'target_receipt_sha256' => $hash,
                    'target_receipt_payload' => substr($message, strlen(self::RECEIPT_DOMAIN)),
                    'target_receipt_signature' => $targetSignature,
                    'updated_at' => now(),
                ]);
            $reported = DB::table('remote_wipe_commands')
                ->where('operation_id', $row->operation_id)->first();
            abort_unless($reported !== null, 500);
            return self::status($reported, false);
        });
    }
}
