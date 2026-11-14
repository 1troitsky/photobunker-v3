<?php
declare(strict_types=1);

namespace App\Backup;

use App\Storage\StorageAdapter;
use Aws\Exception\AwsException;
use Aws\S3\S3Client;
use Carbon\CarbonImmutable;
use Illuminate\Support\Facades\DB;
use RuntimeException;
use Throwable;

/**
 * INTERNAL, trusted-worker-only conditional S3 manifest publisher for #218.
 *
 * Only creates a candidate object's FIRST version with If-None-Match: *.
 * A provider that rejects this operation fails CLOSED; there is never a
 * fallback to StorageAdapter::putStream(), which silently overwrites.
 *
 * IMPORTANT: no Garage bucket object versioning/object lock, and other S3
 * clients with write permission can still overwrite or delete this key.
 * This is cooperative writer fencing, NOT absolute object immutability.
 * Never expose this method as an unauthenticated client endpoint.
 */
final class VaultManifestWriteOnceUploader
{
    private const MAX_BYTES = 16 * 1024 * 1024;

    public function __construct(private readonly StorageAdapter $adapter) {}

    public function publishStagedTrusted(
        string $accountId,
        string $operationId,
        string $leaseId,
        string $generationId,
        string $ciphertext,
    ): string {
        $key = RecoveryVaultGenerationLedger::objectKey($accountId, $generationId);
        foreach ([$operationId, $leaseId] as $id) {
            if (!preg_match('/^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/D', $id)) {
                throw new RuntimeException('vault.invalid_id');
            }
        }
        $length = strlen($ciphertext);
        if ($length < 32 || $length > self::MAX_BYTES) {
            throw new RuntimeException('vault.invalid_manifest');
        }
        $sha256 = hash('sha256', $ciphertext);

        // Fail without writing any object unless the exact account, operation,
        // lease, generation and expected content were already staged by a
        // trusted worker. Activation later rechecks lease while holding the
        // account lock, so a race against expiration cannot activate data.
        $ready = DB::table('identity_accounts')->where('id', $accountId)->first(['status']);
        $candidate = DB::table('backup_generations_v1')
            ->where('id', $generationId)->where('account_id', $accountId)->first();
        $lease = DB::table('backup_start_operations_v1')
            ->where('operation_id', $operationId)->where('account_id', $accountId)->first();
        if (!$ready || $ready->status !== 'ready'
            || !$candidate || $candidate->operation_id !== $operationId
            || $candidate->lease_id !== $leaseId || $candidate->state !== 'staged'
            || $candidate->object_key !== $key
            || $candidate->manifest_sha256 !== $sha256
            || (int) $candidate->manifest_bytes !== $length
            || !$lease || $lease->lease_id !== $leaseId
            || $lease->state !== 'started' || !$lease->lease_expires_at
            || CarbonImmutable::parse($lease->lease_expires_at)
                ->lessThanOrEqualTo(CarbonImmutable::now('UTC'))) {
            throw new RuntimeException('vault.publisher_not_authorized');
        }

        $disk = config('filesystems.disks.ciphertext');
        if (!is_array($disk)
            || ($disk['driver'] ?? null) !== 's3'
            || !is_string($disk['key'] ?? null) || $disk['key'] === ''
            || !is_string($disk['secret'] ?? null) || $disk['secret'] === ''
            || !is_string($disk['bucket'] ?? null) || $disk['bucket'] === ''
            || !is_string($disk['region'] ?? null) || $disk['region'] === '') {
            throw new RuntimeException('vault.s3_configuration_unavailable');
        }
        // Stage 4 FAIL-CLOSED capability gate. The real Garage 2.5 fixture
        // accepted a duplicate conditional PutObject instead of returning
        // PreconditionFailed. Its versioning/object-lock APIs are unavailable.
        // Never attempt an unproven create-only write on customer data.
        // A future compatible provider must be separately verified and the
        // operator must explicitly certify it; this is not a user toggle.
        if ($disk['region'] === 'garage'
            || config('backup_vault.s3_conditional_writes_certified', false) !== true) {
            throw new RuntimeException('vault.conditional_write_not_certified');
        }
        $options = [
            'version' => 'latest',
            'region' => $disk['region'],
            'signature_version' => 'v4',
            'use_path_style_endpoint' => (bool) ($disk['use_path_style_endpoint'] ?? true),
            'credentials' => [
                'key' => $disk['key'],
                'secret' => $disk['secret'],
            ],
            'http' => $disk['http'] ?? ['connect_timeout' => 3, 'timeout' => 25],
        ];
        if (is_string($disk['endpoint'] ?? null) && $disk['endpoint'] !== '') {
            $options['endpoint'] = $disk['endpoint'];
        }

        try {
            (new S3Client($options))->putObject([
                'Bucket' => $disk['bucket'],
                'Key' => $key,
                'Body' => $ciphertext,
                'ContentType' => 'application/octet-stream',
                'IfNoneMatch' => '*',
            ]);
        } catch (AwsException $e) {
            // A lost ACK may already have committed the object. NEVER retry
            // a potentially committed write with a destructive plain PUT.
            if (in_array($e->getStatusCode(), [409, 412], true)) {
                throw new RuntimeException('vault.write_once_conflict', 0, $e);
            }
            throw new RuntimeException('vault.conditional_write_unavailable', 0, $e);
        } catch (Throwable $e) {
            throw new RuntimeException('vault.conditional_write_unavailable', 0, $e);
        }

        // Confirm actual physical bytes from the configured StorageAdapter.
        // S3 ETag is not a cryptographic integrity or immutability proof.
        try {
            if (!$this->adapter->exists($key) || $this->adapter->size($key) !== $length) {
                throw new RuntimeException('vault.manifest_not_verified');
            }
            $stream = $this->adapter->readStream($key);
            if (!is_resource($stream)) {
                throw new RuntimeException('vault.manifest_not_verified');
            }
            try {
                $hash = hash_init('sha256');
                $read = hash_update_stream($hash, $stream);
                if ($read !== $length || !hash_equals($sha256, hash_final($hash))) {
                    throw new RuntimeException('vault.manifest_not_verified');
                }
            } finally {
                fclose($stream);
            }
        } catch (Throwable $e) {
            throw new RuntimeException('vault.manifest_not_verified', 0, $e);
        }
        return $key;
    }
}
