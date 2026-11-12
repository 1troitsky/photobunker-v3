<?php

declare(strict_types=1);

// P0 configuration smoke; not proof of billing enforcement or payment settlement.
$catalog = require dirname(__DIR__) . '/apps/api/config/plans.php';
$plans = $catalog['plans'] ?? null;
$ids = ['free', 'go', 'pro', 'unlimited', 'unlimited_plus'];

if (!is_array($plans) || array_keys($plans) !== $ids) {
    fwrite(STDERR, "Invalid canonical plan IDs/order.\n");
    exit(1);
}
$policy=$catalog['storage_unit_policy']??null;
$version=$catalog['catalog_version']??null;
$effective=$catalog['effective_at']??null;
// Exact owner-approved revision (12 Nov), with historical registry readable.
// A policy/version mismatch or accidental return to unresolved current units
// is a SECURITY failure, never a license to disable this canonical guard.
$approved=$policy==='DECIMAL_GB_TB_V1'
    &&$version==='pb3-2026-11-12'
    &&$effective==='2026-11-12T00:00:00Z';
if (($catalog['currency'] ?? '') !== 'USD'||!$approved) {
    fwrite(STDERR, "Invalid canonical tariff unit policy/version.\n");
    exit(1);
}

// array_key_exists is deliberate: null means *unlimited*, not "absent".
$get = static function (array $item, string $key): mixed {
    return array_key_exists($key, $item) ? $item[$key] : '__MISSING__';
};

$expected = [
    'free' => [0, 3, 50, 1, 'GB', 14, 0, 0, 0],
    'go' => [1500, 30, 250, 30, 'GB', 30, 4, 2, null],
    'pro' => [3000, 100, 2000, 200, 'GB', 90, 7, 5, null],
    'unlimited' => [5000, null, null, 500, 'GB', null, null, null, 1],
    'unlimited_plus' => [10000, null, null, 1, 'TB', null, null, null, 3],
];

foreach ($expected as $id => [$price, $assignments, $files, $storage, $unit, $ttl, $manual, $weeklyAuto, $dailyAuto]) {
    $p = $plans[$id];
    $retention = $p['max_retention'] ?? [];
    $backup = $p['auto_backup_updates'] ?? [];
    $checks = [
        $get($p, 'monthly_price_cents') === $price,
        $get($p, 'assignment_creations_per_month') === $assignments,
        $get($p, 'max_media_files') === $files,
        $get($p['storage_quota'] ?? [], 'amount') === $storage,
        $get($p['storage_quota'] ?? [], 'unit') === $unit,
        ($retention['days'] ?? null) === $ttl,
        $get($p, 'manual_backup_updates_per_week') === $manual,
        $get($backup, 'per_week') === $weeklyAuto,
        $get($backup, 'per_day') === $dailyAuto,
        ($p['matrix_e2ee_messages'] ?? false) === true,
    ];
    if (in_array(false, $checks, true)) {
        fwrite(STDERR, "Plan mismatch: {$id}\n");
        exit(1);
    }
}
// Exercise the same immutable PlanDefinition as Laravel without requiring
// composer or a live DB: exact decimal encrypted byte ceilings, overflow,
// schema and feature flags must survive the independent P0 security floor.
require_once dirname(__DIR__).'/apps/api/app/Plans/PlanDefinition.php';
$exactBytes=[
    'free'=>1000000000,
    'go'=>30000000000,
    'pro'=>200000000000,
    'unlimited'=>500000000000,
    'unlimited_plus'=>1000000000000,
];
foreach($exactBytes as $id=>$expectedBytes){
    try{
        $definition=\App\Plans\PlanDefinition::fromConfig(
            $id,$catalog,$plans[$id]);
    }catch(\Throwable){
        fwrite(STDERR,"Invalid immutable plan definition: {$id}\n");
        exit(1);
    }
    $storage=$definition->value['limits']['storage'];
    if($storage['byteCeiling']!==$expectedBytes
        ||$storage['unitPolicy']!=='DECIMAL_GB_TB_V1'){
        fwrite(STDERR,"Incorrect decimal ciphertext byte ceiling: {$id}\n");
        exit(1);
    }
}
$prices = [
    'go' => [1 => 1500, 6 => 8100, 12 => 15300],
    'pro' => [1 => 3000, 6 => 15300, 12 => 28800],
    'unlimited' => [1 => 5000, 6 => 24000, 12 => 42000],
    'unlimited_plus' => [1 => 10000, 6 => 48000, 12 => 84000],
];
foreach ($prices as $id => $expectedPrices) {
    if ($plans[$id]['period_prices_cents'] !== $expectedPrices) {
        fwrite(STDERR, "Billing periods mismatch: {$id}\n");
        exit(1);
    }
}
if ($plans['unlimited_plus']['byo_s3'] !== true
    || $plans['unlimited_plus']['own_matrix_homeserver'] !== true
    || $plans['free']['encrypted_cloud_backup'] !== false) {
    fwrite(STDERR, "Feature flags conflict with the approved tariff matrix.\n");
    exit(1);
}
$limits = require dirname(__DIR__) . '/apps/api/config/operational_limits.php';
if (($limits['backup']['minimum_start_interval_seconds'] ?? null) !== 3600
    || ($limits['backup']['max_concurrent_per_account'] ?? null) !== 1) {
    fwrite(STDERR, "Backup resource defaults missing.\n");
    exit(1);
}
fwrite(STDOUT, "PB3 five-plan tariff configuration and operational defaults verified.\n");
