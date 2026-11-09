<?php
declare(strict_types=1);

// P1 is Free/personal only; paid quota and other media types arrive in later
// phases. No byte unit assumption is made for the unsettled tariff definition.
return [
    'bootstrap_free_retention_days' => (int) config('plans.plans.free.max_retention.days', 14),
    'bootstrap_free_byte_cap' => 1000000000, // conservative, temporary decimal cap
    'bootstrap_free_file_cap' => (int) config('plans.plans.free.max_media_files', 50),
    'max_asset_bytes' => 134217728,
    'max_metadata_bytes' => 1048576,
    'orphan_grace_hours' => 24, // STALLED upload check; no unexpired deletion
    'cleanup_batch' => 100,
    'cleanup_lease_minutes' => 15,
    // Periodically resweep tombstone keys to remove delayed writes. Permanent
    // tombstone retention/compaction requires a separate production ADR.
    'tombstone_sweep_seconds' => 3600,
    'cleanup_enabled' => filter_var(env('PB3_ENABLE_PHOTO_CLEANUP', false), FILTER_VALIDATE_BOOL),
];
