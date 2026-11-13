<?php
declare(strict_types=1);

// Non-destructive repair of server-side ciphertext pointers. This never
// reconstructs missing client ciphertext or confirms a MediaFile receipt.
// Requires a running Laravel scheduler; can be disabled independently of
// the API, Identity, Camera and destructive TTL cleanup.
return [
    'breaker_enabled'=>filter_var(env('PB3_STORAGE_BREAKER_ENABLED',true),FILTER_VALIDATE_BOOL),
    'reconcile_enabled'=>filter_var(env('PB3_STORAGE_RECONCILE_ENABLED',true),FILTER_VALIDATE_BOOL),
    'failure_threshold'=>2,
    'cooldown_seconds'=>30,
    'probe_lease_seconds'=>15,
    'reconcile_batch'=>100,
    'retry_base_seconds'=>30,
    'retry_max_seconds'=>3600,
    'retry_lease_seconds'=>120,
];
