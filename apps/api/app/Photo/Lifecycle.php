<?php
declare(strict_types=1);

namespace App\Photo;

use App\Storage\StorageManager;
use Illuminate\Support\Facades\DB;

/**
 * P1 personal-photo lifecycle. Marking/tombstones are durable DB operations;
 * S3 deletion is confirmed separately and is retried without losing pointers.
 *
 * The scheduler is intentionally disabled until owner safety acceptance.
 */
final class Lifecycle
{
    public function __construct(private readonly StorageManager $storage) {}

    public function mark(string $photoId, string $reason = 'expired'): void
    {
        DB::transaction(function () use ($photoId, $reason): void {
            $row = DB::table('photo_records')->where('id', $photoId)->lockForUpdate()->first();
            if (!$row || $row->state === 'deleting') {
                // Already marked: never postpone an existing cleanup lease.
                return;
            }

            $keys = DB::table('storage_locations as l')
                ->join('photo_objects as o', 'o.id', '=', 'l.asset_id')
                ->where('o.photo_id', $photoId)
                ->orderBy('l.object_key')
                ->pluck('l.object_key')->all();

            DB::table('photo_tombstones')->insertOrIgnore([
                'photo_id' => $photoId,
                'account_id' => $row->account_id,
                'operation_id' => $row->operation_id,
                'reason' => $reason,
                'object_keys' => json_encode($keys, JSON_THROW_ON_ERROR),
                // Legacy column name. Used as NEXT sweep time, not an expiry
                // after which late writes become safe or tombstones disappear.
                'cleanup_until' => now()->addHour(),
                'created_at' => now(),
            ]);

            DB::table('photo_records')->where('id', $photoId)->update([
                'state' => 'deleting',
                'cleanup_next_at' => now()->addMinutes(
                    (int) config('photo_sync.cleanup_lease_minutes', 15)
                ),
                'updated_at' => now(),
            ]);
        }, 3);
    }

    public function cleanup(string $photoId): void
    {
        $photo = DB::table('photo_records')->where('id', $photoId)->first();
        if (!$photo) {
            return; // Idempotent after confirmed deletion.
        }

        abort_unless(
            $photo->state === 'deleting' || (int) $photo->expires_at <= PhotoSync::nowMs(),
            409,
        );

        if ($photo->state !== 'deleting') {
            $this->mark($photoId);
        }

        $assetIds = DB::table('photo_objects')->where('photo_id', $photoId)
            ->orderBy('id')->pluck('id')->all();

        // Never remove DB placement pointers until EVERY physical delete has
        // completed and the provider confirms absence. Partial failure retries.
        foreach ($assetIds as $assetId) {
            $this->storage->deleteAsset($assetId);
        }

        DB::transaction(function () use ($photoId, $assetIds): void {
            $row = DB::table('photo_records')->where('id', $photoId)->lockForUpdate()->first();
            if (!$row) {
                return;
            }
            abort_unless($row->state === 'deleting', 409);
            DB::table('storage_locations')->whereIn('asset_id', $assetIds)->delete();
            DB::table('photo_objects')->where('photo_id', $photoId)->delete();
            DB::table('photo_records')->where('id', $photoId)->delete();
            // Tombstone and key list intentionally survive the parent row.
        }, 3);
    }

    /**
     * Reconcile stale, UNEXPIRED reservations; NEVER delete their ciphertext.
     * An interrupted PUT may have reached S3 without its database ACK.
     *
     * Returns counts useful for bounded operator diagnostics, not user metrics.
     */
    public function reconcileStalledUploads(int $batch): array
    {
        $threshold = now()->subHours(max(1, (int) config('photo_sync.orphan_grace_hours', 24)));
        $objects = DB::table('photo_objects as o')
            ->join('photo_records as p', 'p.id', '=', 'o.photo_id')
            ->where('p.state', 'pending')
            ->where('p.expires_at', '>', PhotoSync::nowMs())
            ->whereIn('o.state', ['pending', 'uploading'])
            ->where('o.updated_at', '<', $threshold)
            ->orderBy('o.updated_at')->orderBy('o.id')
            ->limit(max(1, $batch))
            ->get(['o.id', 'o.photo_id', 'o.bytes', 'o.sha256']);

        $result = ['verified' => 0, 'reset' => 0, 'deferred' => 0, 'errors' => 0];
        foreach ($objects as $object) {
            try {
                // A missing or wrong-digest object is never promoted.
                $valid = $this->storage->verifyAsset(
                    $object->id, (int) $object->bytes, $object->sha256
                );

                $change = DB::transaction(function () use ($object, $valid, $threshold): ?string {
                    // Parent first, same lock order as PUT/finalize/TTL deletion.
                    $parent = DB::table('photo_records')->where('id', $object->photo_id)
                        ->lockForUpdate()->first();
                    if (!$parent || $parent->state !== 'pending'
                        || (int) $parent->expires_at <= PhotoSync::nowMs()) {
                        return null;
                    }

                    $current = DB::table('photo_objects')->where('id', $object->id)
                        ->lockForUpdate()->first();
                    if (!$current || $current->photo_id !== $parent->id
                        || !in_array($current->state, ['pending', 'uploading'], true)
                        || \Carbon\Carbon::parse($current->updated_at)->greaterThanOrEqualTo($threshold)) {
                        return null;
                    }

                    if ($valid) {
                        DB::table('photo_objects')->where('id', $object->id)->update([
                            'state' => 'verified', 'updated_at' => now(),
                        ]);
                        DB::table('storage_locations')->where('asset_id', $object->id)
                            ->update(['state' => 'verified', 'updated_at' => now()]);
                        return 'verified';
                    }

                    if ($current->state === 'uploading') {
                        // Release a stale lease; the original ciphertext can
                        // be safely PUT again through the signed reservation.
                        DB::table('photo_objects')->where('id', $object->id)->update([
                            'state' => 'pending', 'updated_at' => now(),
                        ]);
                        DB::table('storage_locations')->where('asset_id', $object->id)
                            ->update(['state' => 'reserved', 'updated_at' => now()]);
                        return 'reset';
                    }

                    // Avoid starvation: repeatedly absent uploads must not
                    // monopolize the oldest-first bounded reconciliation batch.
                    DB::table('photo_objects')->where('id', $object->id)
                        ->update(['updated_at' => now()]);
                    return 'deferred';
                }, 3);
                if ($change !== null) {
                    $result[$change]++;
                }
            } catch (\Throwable) {
                // A transient storage outage is NOT evidence of missing bytes.
                // Leave the durable reservation unchanged for the next run.
                $result['errors']++;
            }
        }
        return $result;
    }

    /**
     * Revisit every tombstone periodically. Never discard object keys merely
     * because one sweep succeeded: an old in-flight S3 PUT can arrive later.
     */
    public function sweepTombstones(int $batch): int
    {
        $rows = DB::table('photo_tombstones')
            ->whereNotNull('object_keys')
            ->where('cleanup_until', '<=', now())
            ->orderBy('cleanup_until')->orderBy('photo_id')
            ->limit(max(1, $batch))->get();
        $cleaned = 0;
        foreach ($rows as $row) {
            try {
                $keys = json_decode($row->object_keys, true, 16, JSON_THROW_ON_ERROR);
                if (!is_array($keys) || !array_is_list($keys)) {
                    throw new \RuntimeException('photo.invalid_tombstone_keys');
                }
                foreach ($keys as $key) {
                    if (!is_string($key)) {
                        throw new \RuntimeException('photo.invalid_tombstone_key');
                    }
                    $this->storage->sweepLateWrite($key);
                }

                DB::table('photo_tombstones')->where('photo_id', $row->photo_id)->update([
                    // Keep the immutable key list for subsequent late writes.
                    'cleanup_until' => now()->addSeconds(max(
                        60, (int) config('photo_sync.tombstone_sweep_seconds', 3600)
                    )),
                ]);
                $cleaned++;
            } catch (\Throwable) {
                // Failed or partial cleanup: leave all keys and due time.
                // Future bounded sweeps retry; do not report success.
            }
        }
        return $cleaned;
    }
}
