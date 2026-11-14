<?php

declare(strict_types=1);

namespace App\Panic;

use Carbon\CarbonImmutable;
use DomainException;
use Illuminate\Support\Facades\DB;
use Throwable;

/**
 * #221: inert, internal, READ-ONLY view of the existing signed Panic preflight.
 *
 * It is NOT an API endpoint, signed server statement, authenticated server ACK,
 * admission to emergency execution, wipe, revoke, cloud GC or completion proof.
 * There is intentionally NO write path, status transition or S3/Matrix code.
 *
 * The future caller must independently establish the trusted account/device
 * from its authenticated session. Never use identifiers supplied solely in
 * the untrusted signed envelope as an authorization context.
 */
final class PreparedIntentStatusReader
{
    private const TABLE = 'panic_preflight_intents_v1';
    private const UUID = '/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/D';

    /**
     * @param array<string,mixed> $signed original immutable {contract,signature}
     * @return array{phase:'preflight_only',operationId:string,contractHash:string,recordedAt:string}
     *         Non-authorizing, UNSIGNED DB status only; never a deletion receipt.
     */
    public function read(
        array $signed,
        string $trustedAccountId,
        string $trustedDeviceId,
    ): array {
        self::require(preg_match(self::UUID, $trustedAccountId) === 1
            && preg_match(self::UUID, $trustedDeviceId) === 1);

        return DB::transaction(static function () use (
            $signed, $trustedAccountId, $trustedDeviceId,
        ): array {
            // Shared locks provide one consistent snapshot against concurrent
            // revoke/key-revision changes without modifying any state.
            $account = DB::table('identity_accounts')
                ->where('id', $trustedAccountId)->sharedLock()->first();
            self::require($account !== null
                && $account->status === 'ready'
                && is_numeric($account->revision)
                && (int) $account->revision >= 1);

            $device = DB::table('identity_devices')
                ->where('id', $trustedDeviceId)
                ->where('account_id', $trustedAccountId)
                ->sharedLock()->first();
            self::require($device !== null
                && $device->revoked_at === null
                && is_string($device->signing_spki)
                && $device->signing_spki !== '');

            // Revalidate CURRENT authoritative signer and account revision;
            // an earlier prepared row cannot launder a revoked or rotated
            // device into fresh proof. A signature alone is NOT server auth.
            try {
                $verified = SignedIntentPreflight::inspect(
                    $signed,
                    [
                        'accountId' => $trustedAccountId,
                        'deviceId' => $trustedDeviceId,
                        'keyRevision' => (int) $account->revision,
                    ],
                    $device->signing_spki,
                    (int) floor(microtime(true) * 1000),
                );
            } catch (Throwable) {
                throw new DomainException('panic.preflight_unavailable');
            }

            $row = DB::table(self::TABLE)
                ->where('operation_id', $verified['operationId'])
                ->sharedLock()->first();
            self::require($row !== null
                && $row->phase === 'preflight_only'
                && $row->account_id === $trustedAccountId
                && $row->device_id === $trustedDeviceId
                && is_numeric($row->key_revision)
                && (int) $row->key_revision === (int) $account->revision
                && is_string($row->contract_hash)
                && hash_equals($verified['contractHash'], $row->contract_hash)
                && is_string($row->contract_json)
                && hash_equals($signed['contract'], $row->contract_json)
                && is_string($row->signature)
                && hash_equals($signed['signature'], $row->signature));

            // This is DB record time, NOT a deletion confirmation timestamp.
            try {
                $recordedAt = CarbonImmutable::parse($row->prepared_at)
                    ->utc()->format('Y-m-d\TH:i:s.v\Z');
            } catch (Throwable) {
                throw new DomainException('panic.preflight_unavailable');
            }

            return [
                'phase' => 'preflight_only',
                'operationId' => $verified['operationId'],
                'contractHash' => $verified['contractHash'],
                'recordedAt' => $recordedAt,
            ];
        }, 3);
    }

    private static function require(bool $valid): void
    {
        if (!$valid) {
            throw new DomainException('panic.preflight_unavailable');
        }
    }
}
