<?php
declare(strict_types=1);

// First vertical flow is Free/personal photos only. Before billing, server applies
// the conservative Free cap; monetized quotas and all Media types arrive later.
// GB-vs-GiB policy is OPEN: 1,000,000,000 is the conservative temporary cap.
return [
  'bootstrap_free_retention_days' => (int)config('plans.plans.free.max_retention.days',14),
  'bootstrap_free_byte_cap' => 1000000000,
  'bootstrap_free_file_cap' => (int)config('plans.plans.free.max_media_files',50),
  'max_asset_bytes' => 134217728,
  'max_metadata_bytes' => 1048576,
  'orphan_grace_hours' => 24,
  'cleanup_batch' => 100,
  'cleanup_lease_minutes' => 15,
];
