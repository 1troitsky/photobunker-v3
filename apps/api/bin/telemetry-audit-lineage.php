<?php
declare(strict_types=1);

/**
 * Manual, default-OFF source → HMAC receipt lineage diagnostic.
 * Not a scheduler, HTTP endpoint, privacy approval or production activation.
 *
 * Requires explicit operator approval and an external (never CLI) HMAC secret.
 * Example in an APPROVED isolated environment:
 *   php bin/telemetry-audit-lineage.php --execute --day=2026-11-13
 */
if (PHP_SAPI !== 'cli'
    || count($argv ?? []) !== 3
    || ($argv[1] ?? null) !== '--execute'
    || !is_string($argv[2] ?? null)
    || preg_match('/\A--day=[0-9]{4}-[0-9]{2}-[0-9]{2}\z/D', $argv[2]) !== 1) {
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
    $rawLimit = getenv('PB3_TELEMETRY_AUDIT_ROWS');
    if ($rawLimit === false) {
        $maxRows = 100;
    } elseif (is_string($rawLimit)
        && preg_match('/\A[1-9][0-9]{0,2}\z/D', $rawLimit) === 1
        && (int) $rawLimit <= 200) {
        $maxRows = (int) $rawLimit;
    } else {
        throw new \InvalidArgumentException('telemetry.lineage_invalid_window');
    }

    $result = (new \App\Telemetry\AssignmentReceiptLineageAudit($db, $secret))
        ->inspect((int) floor(microtime(true) * 1000), substr($argv[2], 6), $maxRows);

    // Exactly these fixed scalar fields. Never log the source day, raw IDs,
    // private event HMACs, key, SQL, exception message or source cursor.
    printf(
        "telemetry.lineage scanned=%d matched=%d missing=%d conflicting=%d scan_complete=%s coverage_proven=no\n",
        $result['scanned'], $result['matched'],
        $result['missing'], $result['conflicting'],
        $result['scanComplete'] ? 'yes' : 'no',
    );
    // A partial scan or observed missing/mismatched receipt is NOT success.
    exit($result['scanComplete'] && $result['missing'] === 0
        && $result['conflicting'] === 0 ? 0 : 75);
} catch (\InvalidArgumentException $error) {
    $reason = in_array($error->getMessage(), [
        'telemetry.operator_disabled',
        'telemetry.lineage_invalid_clock',
        'telemetry.lineage_invalid_window',
    ], true) ? $error->getMessage() : 'telemetry.lineage_failed';
    fwrite(STDERR, $reason . "\n");
    exit($reason === 'telemetry.operator_disabled' ? 78 : 64);
} catch (\Throwable) {
    fwrite(STDERR, "telemetry.lineage_failed\n");
    exit(1);
}
