<?php

declare(strict_types=1);

// Technical resource protection is INDEPENDENT of product plans (including Unlimited+).
// Provisional defaults. Counters, atomic leases, Retry-After and per-operation policies
// must be enforced server-side before production. Do not mistake this file for enforcement.
return [
    'schema_version' => 1,
    'backup' => [
        'minimum_start_interval_seconds' => 3600,
        'max_concurrent_per_account' => 1,
        'failed_backup_consumes_product_quota' => false,
    ],
    // Per authenticated account, not per NAT/IP. Product monthly quotas are
    // separate from this technical abuse/load safeguard.
    'assignments' => [
        'requests_per_minute_per_account' => 40,
        'unauthenticated_requests_per_minute_per_ip' => 40,
    ],
    'upload' => [
        'max_concurrent_per_account' => null, // OPEN: load tests determine bound
        'max_chunk_bytes' => null,            // OPEN: tune for mobile/large files
    ],
    'identity' => [
        'rate_policy' => 'REQUIRED_BEFORE_PUBLIC_LAUNCH',
    ],
    'matrix' => [
        'rate_policy' => 'REQUIRED_BEFORE_PUBLIC_LAUNCH',
    ],
    'replication' => [
        'rate_policy' => 'REQUIRED_BEFORE_PUBLIC_LAUNCH',
    ],
    'payments' => [
        'rate_policy' => 'REQUIRED_BEFORE_PUBLIC_LAUNCH',
    ],
    'admin' => [
        'require_mfa' => true,
        'require_audit_log' => true,
    ],
];
