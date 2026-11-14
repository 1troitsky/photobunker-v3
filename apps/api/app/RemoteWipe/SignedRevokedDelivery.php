<?php
declare(strict_types=1);

namespace App\RemoteWipe;

use App\Identity\Protocol as IdentityProtocol;
use Illuminate\Database\UniqueConstraintViolationException;
use Illuminate\Support\Facades\DB;

/**
 * A deliberately UNMOUNTED, narrowly scoped read-only delivery boundary.
 *
 * A revoked device MUST NOT regain a PB3 session to retrieve a pending wipe.
 * It can instead sign a short-lived, one-time request using only its ORIGINAL
 * P-256 device key. The server returns ONLY the command originally signed
 * by the account root + a distinct active owner device.
 *
 * This class never deletes keys/media, grants a session, restores bearer
 * authentication, returns account data, contacts S3/Matrix, or claims that
 * a delivered command was executed. HTTP transport and the client executor
 * require separate coordinated acceptance; there is no route for this class.
 */
final class SignedRevokedDelivery
{
    private const DOMAIN = "pb3.remote-wipe-poll.v1\n";
    private const COMMAND_DOMAIN = "pb3.remote-wipe-command.v1\n";
    private const MAX_SKEW_SECONDS = 90;
    private const MIN_POLL_INTERVAL_SECONDS = 15;

    /**
     * Strict canonical signed wire request. All object fields are mandatory,
     * and the nonce is 32 unpredictable bytes; never trust a client SPKI.
     */
    public static function requestMessage(array $payload): string
    {
        IdentityProtocol::exact($payload, [
            'version', 'requestId', 'accountId',
            'targetDeviceId', 'nonce', 'issuedAt',
        ]);
        abort_unless($payload['version'] === 1 && is_int($payload['issuedAt'])
            && $payload['issuedAt'] > 0, 422);
        foreach (['requestId', 'accountId', 'targetDeviceId'] as $key) {
            abort_unless(is_string($payload[$key]), 422);
            IdentityProtocol::uuid($payload[$key]);
        }
        abort_unless(is_string($payload['nonce']), 422);
        IdentityProtocol::b64($payload['nonce'], 32);
        return self::DOMAIN.json_encode([
            'version' => 1,
            'requestId' => $payload['requestId'],
            'accountId' => $payload['accountId'],
            'targetDeviceId' => $payload['targetDeviceId'],
            'nonce' => $payload['nonce'],
            'issuedAt' => $payload['issuedAt'],
        ], JSON_UNESCAPED_SLASHES | JSON_THROW_ON_ERROR);
    }

    /**
     * @return array{
     *  operationId:string,targetDeviceId:string,commandPayload:string,
     *  commandSha256:string,accountSignature:string,actorSignature:string,
     *  localWipeStatus:string,localWipeProven:bool,cloudDeleted:bool,
     *  backupDeleted:bool,matrixRemoteRevoked:bool,sessionGranted:bool
     * }
     */
    public function poll(array $payload, string $targetSignature): array
    {
        $message = self::requestMessage($payload);
        abort_unless(abs(time() - $payload['issuedAt']) <= self::MAX_SKEW_SECONDS, 401);
        $proofHash = hash('sha256', $message);

        try {
            return DB::transaction(function () use (
                $payload, $message, $targetSignature, $proofHash
            ): array {
                // Same lock order as signed command registration and #80:
                // account -> target -> pending command -> delivery proof.
                $account = DB::table('identity_accounts')
                    ->where('id', $payload['accountId'])
                    ->lockForUpdate()->first();
                abort_unless($account && $account->status === 'ready', 404);

                $target = DB::table('identity_devices')
                    ->where('id', $payload['targetDeviceId'])
                    ->where('account_id', $account->id)
                    ->lockForUpdate()->first();
                abort_unless($target && $target->revoked_at !== null, 404);

                // The device's old key grants ONE operation only; it is not
                // a session, fresh credential, owner role or general account access.
                abort_unless(
                    IdentityProtocol::verify($target->signing_spki, $message, $targetSignature),
                    401
                );

                $row = DB::table('remote_wipe_commands')
                    ->where('account_id', $account->id)
                    ->where('target_device_id', $target->id)
                    ->lockForUpdate()->first();
                abort_unless($row && $row->target_reported_at === null, 404);

                // Fail closed on stale/modified signed bytes; the device must
                // ALSO verify both P-256 signatures against its trusted keys.
                $expectedMessage = self::COMMAND_DOMAIN.$row->command_payload;
                abort_unless(hash_equals($row->command_sha256, hash('sha256', $expectedMessage)), 409);
                try {
                    $decoded = json_decode($row->command_payload, true, 16, JSON_THROW_ON_ERROR);
                } catch (\JsonException) {
                    abort(409);
                }
                abort_unless(is_array($decoded) && !array_is_list($decoded), 409);
                try {
                    $normalized = SignedDeferredCommand::commandMessage($decoded);
                } catch (\Symfony\Component\HttpKernel\Exception\HttpExceptionInterface) {
                    abort(409);
                }
                abort_unless(hash_equals($expectedMessage, $normalized)
                    && $decoded['operationId'] === $row->operation_id
                    && $decoded['accountId'] === $account->id
                    && $decoded['targetDeviceId'] === $target->id
                    && $decoded['actorDeviceId'] === $row->actor_device_id
                    && $decoded['accountRevision'] === (int) $row->account_revision,
                    409
                );

                // Even a valid previously-revoked key cannot replay a poll
                // request or fill a durable unbounded proof table.
                abort_if(DB::table('remote_wipe_delivery_proofs')
                    ->where('request_id', $payload['requestId'])->exists(), 409);
                abort_if(DB::table('remote_wipe_delivery_proofs')
                    ->where('target_device_id', $target->id)
                    ->where('created_at', '>', now()->subSeconds(self::MIN_POLL_INTERVAL_SECONDS))
                    ->exists(), 429);

                DB::table('remote_wipe_delivery_proofs')->insert([
                    'request_id' => $payload['requestId'],
                    'account_id' => $account->id,
                    'target_device_id' => $target->id,
                    'operation_id' => $row->operation_id,
                    'proof_sha256' => $proofHash,
                    'created_at' => now(),
                ]);

                return [
                    'operationId' => $row->operation_id,
                    'targetDeviceId' => $target->id,
                    'commandPayload' => $row->command_payload,
                    'commandSha256' => $row->command_sha256,
                    'accountSignature' => $row->account_signature,
                    'actorSignature' => $row->actor_signature,
                    'localWipeStatus' => 'wipe_pending',
                    'localWipeProven' => false,
                    'cloudDeleted' => false,
                    'backupDeleted' => false,
                    'matrixRemoteRevoked' => false,
                    'sessionGranted' => false,
                ];
            });
        } catch (UniqueConstraintViolationException $exception) {
            // A request UUID collision must not become an SQL 500 or let the
            // second signer adopt another revoked device's response.
            $sqlstate = (string) ($exception->errorInfo[0] ?? '');
            if (in_array($sqlstate, ['23505', '23000'], true)
                && str_contains($exception->getMessage(), 'remote_wipe_delivery_proofs')) {
                abort(409);
            }
            throw $exception;
        }
    }
}
