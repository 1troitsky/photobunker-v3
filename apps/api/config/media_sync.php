<?php
declare(strict_types=1);

// Dedicated P1 MediaFile/v1 ciphertext lifecycle; destructive maintenance is
// explicitly DISABLED until QA, operator policy and safe worker acceptance.
return [
    'cleanup_enabled'=>filter_var(env('PB3_ENABLE_MEDIA_CLEANUP',false),
        FILTER_VALIDATE_BOOL),
    'cleanup_batch'=>100,
    'cleanup_lease_minutes'=>15,
    'stalled_grace_hours'=>24,
    'tombstone_sweep_seconds'=>3600,
];
