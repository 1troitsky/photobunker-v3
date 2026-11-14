<?php

declare(strict_types=1);

/**
 * Disposable PostgreSQL 18 restart sentinel for P4 #241.
 * This is not an application endpoint, migration or production data utility.
 */
if (PHP_SAPI !== 'cli') {
    exit(2);
}

$checks = [
    'CI' => 'true',
    'GITHUB_ACTIONS' => 'true',
    'GITHUB_REPOSITORY' => '1troitsky/photobunker-v3',
    'APP_ENV' => 'testing',
    'DB_CONNECTION' => 'pgsql',
    'DB_HOST' => '127.0.0.1',
    'DB_DATABASE' => 'pb3_ci_pg_outage',
    'DB_USERNAME' => 'pb3_ci',
];
foreach ($checks as $key => $expected) {
    if (getenv($key) !== $expected) {
        fwrite(STDERR, "P4-241 refused: disposable CI environment required ({$key})\n");
        exit(2);
    }
}
$step = $argv[1] ?? '';
if (!in_array($step, ['prepare', 'verify', 'cleanup'], true)) {
    fwrite(STDERR, "P4-241 usage: prepare | verify | cleanup\n");
    exit(2);
}

$dsn = 'pgsql:host=127.0.0.1;port=5432;dbname=pb3_ci_pg_outage;connect_timeout=4';
$pass = getenv('DB_PASSWORD');
if (!is_string($pass) || $pass === '') {
    fwrite(STDERR, "P4-241 refused: disposable DB credential missing\n");
    exit(2);
}
$pdo = new PDO($dsn, 'pb3_ci', $pass, [
    PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION,
    PDO::ATTR_TIMEOUT => 4,
]);
$table = 'p4_ci_outage_sentinel_241';
$id = 'synthetic-outage-241';
$digest = hash('sha256', 'pb3.p4.real.postgres.outage.synthetic.v1');

if ($step === 'prepare') {
    $pdo->exec("CREATE TABLE IF NOT EXISTS {$table} (id text PRIMARY KEY, digest char(64) NOT NULL)");
    $stmt = $pdo->prepare("INSERT INTO {$table}(id, digest) VALUES (?, ?) ON CONFLICT (id) DO NOTHING");
    $stmt->execute([$id, $digest]);
    fwrite(STDOUT, "P4-241 disposable PostgreSQL 18 synthetic sentinel created\n");
    exit(0);
}
if ($step === 'verify') {
    $stmt = $pdo->prepare("SELECT digest FROM {$table} WHERE id = ?");
    $stmt->execute([$id]);
    $values = $stmt->fetchAll(PDO::FETCH_COLUMN, 0);
    if (count($values) !== 1 || !is_string($values[0]) || !hash_equals($digest, trim($values[0]))) {
        fwrite(STDERR, "P4-241 FAIL: synthetic state missing or altered after real DB outage\n");
        exit(1);
    }
    fwrite(STDOUT, "P4-241 PASS: durable synthetic row unchanged after physical PostgreSQL restart\n");
    exit(0);
}

// Cleanup touches only a uniquely named table in the guarded, disposable CI DB.
$pdo->exec("DROP TABLE IF EXISTS {$table}");
fwrite(STDOUT, "P4-241 disposable synthetic sentinel cleaned\n");
