<?php
declare(strict_types=1);

/**
 * Dedicated disposable PG18 CI test: two INDEPENDENT PHP processes race the
 * same trusted idempotency token. Never run with production credentials.
 */
require dirname(__DIR__, 2) . '/vendor/autoload.php';
$app = require dirname(__DIR__, 2) . '/bootstrap/app.php';
$app->make(\Illuminate\Contracts\Console\Kernel::class)->bootstrap();

use App\Telemetry\DatabaseTelemetrySink;
use App\Telemetry\TelemetryCollector;
use App\Telemetry\TelemetryDecision;
use Illuminate\Support\Facades\DB;

$db = DB::connection();
if ($db->getDriverName() !== 'pgsql' || getenv('PB3_ISOLATED_TELEMETRY_CI') !== '1') {
    throw new RuntimeException('Disposable PostgreSQL telemetry test ONLY');
}
$nowMs = filter_var(getenv('PB3_TEST_NOW_MS'), FILTER_VALIDATE_INT);
if (!is_int($nowMs) || $nowMs < 1) {
    throw new RuntimeException('No shared test clock');
}
const ACCOUNT = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const EVENT_ID = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const SECRET = 'PB3 TEST ONLY TELEMETRY HMAC SECRET, NO REAL KEY';
$collector = new TelemetryCollector(new DatabaseTelemetrySink($db), SECRET);
$event = static function (string $type = 'session.active') use ($nowMs): array {
    return [
        'schemaVersion' => 1,
        'eventId' => EVENT_ID,
        'eventType' => $type,
        'occurredAtMs' => $nowMs,
    ];
};
$assert = static function (bool $value, string $message): void {
    if (!$value) {
        throw new RuntimeException($message);
    }
};
$stage = $argv[1] ?? '';
if ($stage === 'init') {
    $assert($db->table('telemetry_event_receipts')->count() === 0, 'expected fresh DB');
    echo "Telemetry PG18 disposable DB ready\n";
} elseif ($stage === 'worker') {
    $result = $collector->ingest($event(), ACCOUNT, $nowMs);
    $assert(in_array($result, [TelemetryDecision::Accepted, TelemetryDecision::Duplicate], true), 'invalid race decision');
    echo "Race worker: {$result->value}\n";
} elseif ($stage === 'verify') {
    $assert($db->table('telemetry_event_receipts')->count() === 1, 'receipt duplication');
    $assert($collector->ingest($event(), ACCOUNT, $nowMs) === TelemetryDecision::Duplicate, 'replay');
    $assert($collector->ingest($event('media.photo.committed'), ACCOUNT, $nowMs) === TelemetryDecision::Conflict, 'same-ID mutation');
    foreach (['day', 'week', 'month'] as $kind) {
        $query = $db->table('telemetry_counters')->where('period_kind', $kind);
        $assert((int) (clone $query)->where('metric', 'session.active')->value('total') === 1, "event count $kind");
        $assert((int) (clone $query)->where('metric', 'session.active.distinct')->value('total') === 1, "distinct count $kind");
    }
    $assert($db->table('telemetry_active_tokens')->count() === 3, 'distinct token count');
    echo "Telemetry PG18 true two-process duplicate/atomic counts PASS\n";
} else {
    throw new RuntimeException('Expected init|worker|verify');
}
