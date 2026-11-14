<?php
declare(strict_types=1);

/**
 * Dedicated disposable PG18 CI test: two INDEPENDENT PHP processes race the
 * same trusted idempotency token. Never run with production credentials.
 */
require dirname(__DIR__, 2) . '/vendor/autoload.php';
$app = require dirname(__DIR__, 2) . '/bootstrap/app.php';
$app->make(\Illuminate\Contracts\Console\Kernel::class)->bootstrap();

use App\Telemetry\AssignmentCreationReplay;
use App\Telemetry\DatabaseTelemetrySink;
use Carbon\CarbonImmutable;
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
const SOURCE_ACCOUNT_OPERATION = '99999999-9999-4999-8999-999999999999';
const SOURCE_ASSIGNMENT = '88888888-8888-4888-8888-888888888888';
const SOURCE_OPERATION = '77777777-7777-4777-8777-777777777777';
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
} elseif ($stage === 'source-init') {
    // Append-only source row with an actual FK to the trusted identity ledger.
    // Never feed browser JSON or a synthetic user event into telemetry here.
    $db->table('identity_accounts')->insert([
        'id' => ACCOUNT, 'operation_id' => SOURCE_ACCOUNT_OPERATION,
        'prepare_hash' => str_repeat('a', 64), 'status' => 'ready',
        'reserved_until' => now()->addDay(),
        'created_at' => now(), 'updated_at' => now(),
    ]);
    $sourceTime = CarbonImmutable::createFromTimestampMs($nowMs, 'UTC')
        ->subMinute()->format('Y-m-d H:i:s.u');
    $db->table('assignment_creation_meter_v1')->insert([
        'assignment_id' => SOURCE_ASSIGNMENT,
        'owner_account_id' => ACCOUNT,
        'operation_id' => SOURCE_OPERATION,
        'created_at' => $sourceTime,
    ]);
    $assert($db->table('assignment_creation_meter_v1')->count() === 1, 'source row missing');
    echo "Telemetry PG18 server-owned assignment source created\n";
} elseif ($stage === 'source-worker') {
    $result = (new AssignmentCreationReplay($db, $collector))->replayPage($nowMs, 5);
    $assert($result['accepted'] + $result['duplicate'] === 1
        && !$result['hasMore'], 'source race admission or pagination failure');
    echo "Source worker: ".$result['accepted']." accepted, ".$result['duplicate']." duplicate\n";
} elseif ($stage === 'source-verify') {
    $result = (new AssignmentCreationReplay($db, $collector))->replayPage($nowMs, 5);
    $assert($result['accepted'] === 0 && $result['duplicate'] === 1, 'source replay not idempotent');
    $assert($db->table('telemetry_event_receipts')->count() === 2, 'source count mismatch');
    foreach (['day', 'week', 'month'] as $kind) {
        $total = $db->table('telemetry_counters')
            ->where('period_kind', $kind)
            ->where('metric', 'assignment.created')->value('total');
        $assert((int) $total === 1, "source event $kind doubled");
    }
    $assert($db->table('telemetry_active_tokens')->count() === 3,
        'assignment source should not mint activity actor tokens');
    echo "Telemetry PG18 two-process REAL ledger-source reconciliation PASS\n";
} else {
    throw new RuntimeException('Expected init|worker|verify|source-init|source-worker|source-verify');
}
