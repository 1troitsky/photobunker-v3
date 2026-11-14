<?php
declare(strict_types=1);

/**
 * Manually invoked, default-OFF server-only telemetry reconciliation.
 * Not registered in Laravel scheduler, routes or automatic commands.
 * Until owner-approved policy and consent are in place, DO NOT activate
 * outside a disposable, isolated QA database.
 *
 * Example after explicit policy approval (no secrets on command line):
 *   php apps/api/bin/telemetry-replay-assignments.php --execute
 */
if (PHP_SAPI !== 'cli' || ($argv ?? []) !== [($argv[0] ?? ''), '--execute']) {
    fwrite(STDERR, "telemetry.operator_disabled\n");
    exit(78);
}

try {
    require dirname(__DIR__) . '/vendor/autoload.php';
    $app = require dirname(__DIR__) . '/bootstrap/app.php';
    $app->make(\Illuminate\Contracts\Console\Kernel::class)->bootstrap();

    $db = \Illuminate\Support\Facades\DB::connection();
    $secret = \App\Telemetry\AssignmentReplayRunner::requireOperatorSecret(
        getenv('PB3_TELEMETRY_REPLAY_ENABLED'),
        getenv('PB3_TELEMETRY_POLICY_APPROVED'),
        getenv('PB3_TELEMETRY_HMAC_SECRET'),
        $db->getDriverName(),
        (bool) config('app.debug'),
    );

    $boundedPositive = static function (string $key, int $default, int $max): int {
        $raw = getenv($key);
        if ($raw === false) {
            return $default;
        }
        if (!is_string($raw) || !preg_match('/\A[1-9][0-9]{0,2}\z/D', $raw)
            || (int) $raw > $max) {
            throw new \InvalidArgumentException('telemetry.runner_invalid_bounds');
        }
        return (int) $raw;
    };

    $pageSize = $boundedPositive('PB3_TELEMETRY_PAGE_SIZE', 100, 200);
    $maxPages = $boundedPositive('PB3_TELEMETRY_MAX_PAGES', 100, 500);
    $collector = new \App\Telemetry\TelemetryCollector(
        new \App\Telemetry\DatabaseTelemetrySink($db), $secret,
    );
    $runner = new \App\Telemetry\AssignmentReplayRunner(
        new \App\Telemetry\AssignmentCreationReplay($db, $collector),
    );
    $result = $runner->run((int) floor(microtime(true) * 1000), $pageSize, $maxPages);

    // Deliberately only coarse counters. Never print raw account/event IDs,
    // source private cursor, SQL, HMACs, secret values or exception traces.
    printf(
        "telemetry.operator pages=%d accepted=%d duplicate=%d complete=%s\n",
        $result['pages'], $result['accepted'], $result['duplicate'],
        $result['complete'] ? 'yes' : 'no',
    );
    exit($result['complete'] ? 0 : 75);
} catch (\InvalidArgumentException $error) {
    // Do not echo an arbitrary exception: contains no raw identifiers only
    // because these two error codes are fixed allowlisted literals.
    $name = in_array($error->getMessage(), [
        'telemetry.operator_disabled', 'telemetry.runner_invalid_bounds',
    ], true) ? $error->getMessage() : 'telemetry.operator_failed';
    fwrite(STDERR, $name . "\n");
    exit($name === 'telemetry.operator_disabled' ? 78 : 64);
} catch (\Throwable) {
    fwrite(STDERR, "telemetry.operator_failed\n");
    exit(1);
}
