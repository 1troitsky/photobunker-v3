<?php
declare(strict_types=1);

namespace App\Storage\Placement;

use App\Storage\StorageAdapter;
use Carbon\CarbonImmutable;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;
use RuntimeException;
use Throwable;

/**
 * P4 #233 — physical ciphertext evidence for a *candidate* placement switch.
 *
 * Never changes a live pointer, copies/deletes ciphertext or authorizes an
 * account operation. Only a trusted server-side caller may pass account ID
 * and an independently configured transport registry. This is NOT an HTTP
 * endpoint and does NOT register BYO credentials or certify failure domains.
 *
 * This observation is not an authenticated receipt or durable CAS: before
 * a future switch, the caller must re-check under its own versioned lock,
 * verify a trusted signed receipt, ensure a safe concurrent-writer barrier,
 * and confirm the destination provider really is a different failure domain.
 */
final class PlacementReadiness
{
    /**
     * @param array<string,array{adapter:StorageAdapter,failureDomain:string,credentialRevision:int}> $registeredTransports
     *   Trusted application-side registry only; NEVER accept this from JSON,
     *   a request, database-only self-claims or user-supplied endpoints.
     */
    public function __construct(private readonly array $registeredTransports) {}

    /** @return array<string,mixed> */
    public function photo(
        string $trustedAccountId,
        string $assetId,
        string $sourceLocationId,
        string $targetLocationId,
        CarbonImmutable $serverNow,
    ): array {
        self::uuid($trustedAccountId);
        self::uuid($assetId);
        self::uuid($sourceLocationId);
        self::uuid($targetLocationId);

        $record = DB::table('photo_objects as o')
            ->join('photo_records as p', 'p.id', '=', 'o.photo_id')
            ->join('identity_accounts as a', 'a.id', '=', 'p.account_id')
            ->where('o.id', $assetId)
            ->where('p.account_id', $trustedAccountId)
            ->where('a.status', 'ready')
            ->first([
                'p.id as parent_id','p.state as parent_state',
                'p.expires_at','o.id as asset_id','o.state as asset_state',
                'o.sha256','o.bytes','o.updated_at as asset_updated_at',
            ]);

        if ($record === null) {
            throw new RuntimeException('placement.not_found');
        }

        $this->activeAsset($record, $serverNow);
        if (DB::table('photo_tombstones')->where('photo_id', $record->parent_id)->exists()) {
            throw new RuntimeException('placement.deleted');
        }

        return $this->preflight(
            'photo', $trustedAccountId, $assetId, $record,
            'storage_locations', 'asset_id',
            $sourceLocationId, $targetLocationId,
            $serverNow,
        );
    }

    /** @return array<string,mixed> */
    public function mediaChunk(
        string $trustedAccountId,
        string $chunkId,
        string $sourceLocationId,
        string $targetLocationId,
        CarbonImmutable $serverNow,
    ): array {
        self::uuid($trustedAccountId);
        self::uuid($chunkId);
        self::uuid($sourceLocationId);
        self::uuid($targetLocationId);

        $record = DB::table('media_chunks_v1 as c')
            ->join('media_files_v1 as m', 'm.id', '=', 'c.media_id')
            ->join('identity_accounts as a', 'a.id', '=', 'm.account_id')
            ->where('c.id', $chunkId)
            ->where('m.account_id', $trustedAccountId)
            ->where('a.status', 'ready')
            ->first([
                'm.id as parent_id','m.state as parent_state',
                'm.expires_at','c.id as asset_id','c.state as asset_state',
                'c.sha256','c.bytes','c.updated_at as asset_updated_at',
            ]);

        if ($record === null) {
            throw new RuntimeException('placement.not_found');
        }

        $this->activeAsset($record, $serverNow);
        if (DB::table('media_tombstones_v1')->where('media_id', $record->parent_id)->exists()) {
            throw new RuntimeException('placement.deleted');
        }

        return $this->preflight(
            'media_chunk', $trustedAccountId, $chunkId, $record,
            'media_chunk_locations_v1', 'chunk_id',
            $sourceLocationId, $targetLocationId,
            $serverNow,
        );
    }

    private function activeAsset(object $record, CarbonImmutable $serverNow): void
    {
        if ($record->parent_state !== 'active'
            || !in_array($record->asset_state, ['active', 'verified'], true)) {
            throw new RuntimeException('placement.in_flight_or_inactive');
        }
        if (!is_numeric($record->expires_at)
            || (int)$record->expires_at <= $serverNow->utc()->getTimestampMs()) {
            throw new RuntimeException('placement.expired');
        }
        if (!is_numeric($record->bytes) || (int)$record->bytes <= 0
            || (int)$record->bytes === PHP_INT_MAX
            || !self::digest((string)$record->sha256)) {
            throw new RuntimeException('placement.invalid_asset');
        }
    }

    /**
     * @return array<string,mixed>
     */
    private function preflight(
        string $kind,
        string $account,
        string $logicalId,
        object $record,
        string $table,
        string $fk,
        string $sourceId,
        string $targetId,
        CarbonImmutable $at,
    ): array {
        if ($sourceId === $targetId) {
            throw new RuntimeException('placement.same_location');
        }
        // Physical location IDs are DB-derived. Never allow unknown location
        // IDs or an object key from a request to select a different account.
        $locations = DB::table($table)->where($fk, $logicalId)
            ->whereIn('id', [$sourceId, $targetId])->get()->keyBy('id');
        if ($locations->count() !== 2) {
            throw new RuntimeException('placement.location_not_found');
        }
        $source = $locations->get($sourceId);
        $target = $locations->get($targetId);
        $expectedHash = (string)$record->sha256;
        $expectedBytes = (int)$record->bytes;
        foreach ([$source, $target] as $location) {
            if (!in_array($location->state, ['active', 'verified'], true)) {
                throw new RuntimeException('placement.location_not_verified');
            }
            if ((int)$location->bytes !== $expectedBytes
                || !is_string($location->sha256)
                || !hash_equals($expectedHash, $location->sha256)
                || !is_string($location->object_key)
                || $location->object_key === '') {
                throw new RuntimeException('placement.metadata_mismatch');
            }
        }
        if ($source->provider === $target->provider) {
            throw new RuntimeException('placement.same_provider');
        }

        $sourceTransport = $this->transport((string)$source->provider);
        $targetTransport = $this->transport((string)$target->provider);
        if ($sourceTransport['failureDomain'] === $targetTransport['failureDomain']) {
            throw new RuntimeException('placement.same_failure_domain');
        }

        $this->verifyPhysical($sourceTransport['adapter'],
            (string)$source->object_key, $expectedBytes, $expectedHash);
        $this->verifyPhysical($targetTransport['adapter'],
            (string)$target->object_key, $expectedBytes, $expectedHash);

        // A copy can change while a remote read is in progress. This is only
        // a read-only observation, never a durable switching permit.
        $again = DB::table($table)->where($fk, $logicalId)
            ->whereIn('id', [$sourceId, $targetId])->get()->keyBy('id');
        foreach ([$sourceId, $targetId] as $id) {
            $original = $locations->get($id);
            $new = $again->get($id);
            if (!$new
                || (string)$new->updated_at !== (string)$original->updated_at
                || $new->state !== $original->state
                || $new->sha256 !== $original->sha256
                || (int)$new->bytes !== (int)$original->bytes
                || $new->object_key !== $original->object_key
                || $new->provider !== $original->provider) {
                throw new RuntimeException('placement.changed_during_preflight');
            }
        }

        $this->assertLogicalUnchanged($kind, $account, $logicalId, $record, $at);

        return [
            'schemaVersion' => 1,
            'kind' => $kind,
            'accountId' => $account,
            'logicalId' => $logicalId,
            'sourceLocationId' => $sourceId,
            'targetLocationId' => $targetId,
            'sourceProvider' => (string)$source->provider,
            'targetProvider' => (string)$target->provider,
            // Internal non-authenticating metadata witnesses. The candidate
            // ledger must compare these AGAIN after its account row lock.
            // A SHA-256 fingerprint is not an HMAC or signed provider receipt.
            'sourceLocationFingerprint' => self::locationFingerprint($source),
            'targetLocationFingerprint' => self::locationFingerprint($target),
            'assetUpdatedAt' => (string)$record->asset_updated_at,
            'sourceCredentialRevision' => $sourceTransport['credentialRevision'],
            'targetCredentialRevision' => $targetTransport['credentialRevision'],
            'ciphertextBytes' => $expectedBytes,
            'ciphertextSha256' => $expectedHash,
            'observedAt' => $at->utc()->format('Y-m-d\TH:i:s\Z'),
            'status' => 'physical_preflight_only',
            'switchAuthorized' => false,
        ];
    }


    /**
     * A user may delete, revoke, retire or expire ciphertext WHILE two
     * remote readbacks are happening. Such a racing preflight must reject,
     * even though it never authorizes a switch.
     */
    private function assertLogicalUnchanged(
        string $kind,
        string $account,
        string $logicalId,
        object $before,
        CarbonImmutable $at,
    ): void {
        if ($kind === 'photo') {
            $after = DB::table('photo_objects as o')
                ->join('photo_records as p', 'p.id', '=', 'o.photo_id')
                ->join('identity_accounts as a', 'a.id', '=', 'p.account_id')
                ->where('o.id', $logicalId)->where('p.account_id', $account)
                ->where('a.status', 'ready')
                ->first([
                    'p.id as parent_id','p.state as parent_state',
                    'p.expires_at','o.state as asset_state',
                    'o.sha256','o.bytes','o.updated_at as asset_updated_at',
                ]);
            $deleted = DB::table('photo_tombstones')
                ->where('photo_id', $before->parent_id)->exists();
        } elseif ($kind === 'media_chunk') {
            $after = DB::table('media_chunks_v1 as c')
                ->join('media_files_v1 as m', 'm.id', '=', 'c.media_id')
                ->join('identity_accounts as a', 'a.id', '=', 'm.account_id')
                ->where('c.id', $logicalId)->where('m.account_id', $account)
                ->where('a.status', 'ready')
                ->first([
                    'm.id as parent_id','m.state as parent_state',
                    'm.expires_at','c.state as asset_state',
                    'c.sha256','c.bytes','c.updated_at as asset_updated_at',
                ]);
            $deleted = DB::table('media_tombstones_v1')
                ->where('media_id', $before->parent_id)->exists();
        } else {
            throw new RuntimeException('placement.invalid_kind');
        }
        if ($deleted || $after === null
            || $after->parent_id !== $before->parent_id
            || $after->parent_state !== $before->parent_state
            || $after->asset_state !== $before->asset_state
            || (int)$after->expires_at !== (int)$before->expires_at
            || $after->sha256 !== $before->sha256
            || (int)$after->bytes !== (int)$before->bytes
            || (string)$after->asset_updated_at !== (string)$before->asset_updated_at) {
            throw new RuntimeException('placement.changed_during_preflight');
        }
        try {
            $this->activeAsset($after, $at);
        } catch (RuntimeException) {
            throw new RuntimeException('placement.changed_during_preflight');
        }
    }

    /** @return array{adapter:StorageAdapter,failureDomain:string,credentialRevision:int} */
    private function transport(string $provider): array
    {
        $binding = $this->registeredTransports[$provider] ?? null;
        if (!is_array($binding)
            || !(($binding['adapter'] ?? null) instanceof StorageAdapter)
            || !is_string($binding['failureDomain'] ?? null)
            || !preg_match('/^[A-Za-z0-9_.:-]{8,128}$/D', $binding['failureDomain'])
            || !is_int($binding['credentialRevision'] ?? null)
            || $binding['credentialRevision'] < 1) {
            throw new RuntimeException('placement.provider_not_configured');
        }
        return $binding;
    }

    private function verifyPhysical(
        StorageAdapter $adapter,
        string $objectKey,
        int $bytes,
        string $expectedSha256,
    ): void {
        $stream = null;
        try {
            if (!$adapter->exists($objectKey)
                || $adapter->size($objectKey) !== $bytes) {
                throw new RuntimeException('placement.physical_missing_or_mismatch');
            }
            $stream = $adapter->readStream($objectKey);
            if (!is_resource($stream)) {
                throw new RuntimeException('placement.physical_read_unavailable');
            }
            $hash = hash_init('sha256');
            $total = 0;
            while (!feof($stream)) {
                $chunk = fread($stream, 65536);
                if ($chunk === false || ($chunk === '' && !feof($stream))) {
                    throw new RuntimeException('placement.physical_read_unavailable');
                }
                $total += strlen($chunk);
                if ($total > $bytes) {
                    throw new RuntimeException('placement.physical_size_mismatch');
                }
                hash_update($hash, $chunk);
            }
            if ($total !== $bytes || !hash_equals($expectedSha256, hash_final($hash))) {
                throw new RuntimeException('placement.physical_digest_mismatch');
            }
        } catch (Throwable $e) {
            // Never expose endpoint, S3 access-key, bucket or exception details
            // to the product-facing failure boundary.
            throw new RuntimeException('placement.ciphertext_not_verified', previous: $e);
        } finally {
            if (is_resource($stream)) {
                fclose($stream);
            }
        }
    }

    /**
     * Canonical location metadata witness. Does not sign or authorize.
     *
     * Only useful for detecting a database location/object-key swap between
     * a physical ciphertext readback and an account-locked candidate write.
     * In particular, do not treat the SHA as a provider receipt, MAC,
     * independent trust anchor or durable switching permit.
     */
    public static function locationFingerprint(object $location): string
    {
        return hash('sha256',json_encode([
            'id'=>(string)$location->id,
            'provider'=>(string)$location->provider,
            'objectKey'=>(string)$location->object_key,
            'sha256'=>(string)$location->sha256,
            'bytes'=>(int)$location->bytes,
            'state'=>(string)$location->state,
            'updatedAt'=>(string)$location->updated_at,
        ],JSON_UNESCAPED_SLASHES|JSON_THROW_ON_ERROR));
    }

    private static function uuid(string $value): void
    {
        if (!Str::isUuid($value)) {
            throw new RuntimeException('placement.invalid_identity');
        }
    }

    private static function digest(string $value): bool
    {
        return preg_match('/^[0-9a-f]{64}$/D', $value) === 1;
    }
}
