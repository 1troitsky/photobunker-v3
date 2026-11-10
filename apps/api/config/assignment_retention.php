<?php
declare(strict_types=1);

return [
    // This enables ONLY scheduled logical tombstone reconciliation. The
    // authoritative API deadline gates always apply, even when disabled.
    // No setting here grants a right to physically delete contributor media.
    'enabled'=>filter_var(env('PB3_ENABLE_ASSIGNMENT_RETENTION',false),
        FILTER_VALIDATE_BOOL),
];
