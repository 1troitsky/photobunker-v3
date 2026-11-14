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
use App\Telemetry\AssignmentCoverageAudit;
use App\Telemetry\AssignmentReceiptLineageAudit;
use App\Telemetry\TelemetryEvent;
use App\Telemetry\TelemetryRecord;
use App\Telemetry\InternalAggregateReader;
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
    $day = gmdate('Y-m-d', intdiv($nowMs, 1000));
    $week = gmdate('o-\WW', intdiv($nowMs, 1000));
    $reader = new InternalAggregateReader($db);
    $daily = $reader->read('assignment.created', 'day', $day, $day);
    $assert($daily['sourceCoverage'] === 'not_proven'
        && $daily['points'] === [['period' => $day, 'count' => 1]],
        'real PG18 daily aggregate read is not precise or sparse');
    $weekly = $reader->read('assignment.created', 'week', $week, $week);
    $assert($weekly['points'] === [['period' => $week, 'count' => 1]],
        'real PG18 ISO weekly aggregate read failed');
    $missing = $reader->read('backup.verified', 'day', $day, $day);
    $assert($missing['points'] === [], 'missing source must not fabricate zero');
    echo "Telemetry PG18 real aggregate read, ISO periods, honest coverage PASS\n";
    echo "Telemetry PG18 two-process REAL ledger-source reconciliation PASS\n";
} elseif ($stage === 'coverage') {
    // This stage runs AFTER opt-in CLI smoke, on disposable CI PG18 only.
    // New previous UTC day source is initially not admitted into counters.
    $now = CarbonImmutable::createFromTimestampMs($nowMs, 'UTC');
    $previous = $now->startOfDay()->subDay()->addHours(12);
    $day = $previous->format('Y-m-d');
    $db->table('assignment_creation_meter_v1')->insert([
        'assignment_id' => '66666666-6666-4666-8666-666666666666',
        'owner_account_id' => ACCOUNT,
        'operation_id' => '55555555-5555-4555-8555-555555555555',
        'created_at' => $previous->format('Y-m-d H:i:s.u+00:00'),
    ]);
    // A connection timezone different from UTC must NOT reclassify source
    // creation timestamps into a different calendar day.
    $db->statement("SET TIME ZONE 'Pacific/Honolulu'");
    $audit = new AssignmentCoverageAudit($db, new InternalAggregateReader($db));
    $before = $audit->compare($nowMs, $day, $day);
    $assert($before['coverageProven'] === false
        && $before['days'][0]['sourceCount'] === 1
        && $before['days'][0]['observedCount'] === null
        && $before['days'][0]['status'] === 'missing_ingestion',
        'real PG UTC source discrepancy not detected');
    $ingest = static function (string $id) use ($collector, $previous, $nowMs): void {
        $decision = $collector->ingest([
            'schemaVersion' => 1,
            'eventId' => $id,
            'eventType' => 'assignment.created',
            'occurredAtMs' => $previous->getTimestampMs(),
        ], ACCOUNT, $nowMs);
        if ($decision !== TelemetryDecision::Accepted) {
            throw new RuntimeException('PG source comparison event not accepted');
        }
    };
    $ingest('55555555-5555-4555-8555-555555555555');
    $equal = $audit->compare($nowMs, $day, $day);
    $assert($equal['coverageProven'] === false
        && $equal['days'][0]['status'] === 'counts_match_unverified',
        'equal PG count incorrectly promoted to coverage proof');
    $ingest('44444444-4444-4444-8444-444444444444');
    $excess = $audit->compare($nowMs, $day, $day);
    $assert($excess['days'][0]['status'] === 'excess_untrusted',
        'unauthorized-looking extra aggregate not flagged');
    echo "Telemetry real PG18 non-UTC session source-count discrepancy and unproven matching PASS\n";
} elseif ($stage === 'lineage') {
    // This is a FRESH PHP process after the trusted PG18 source, op replay
    // and discrepancy test. PG session UTC offset must not change source day.
    $now = CarbonImmutable::createFromTimestampMs($nowMs, 'UTC');
    $previous = $now->startOfDay()->subDay()->addHours(12);
    $day = $previous->format('Y-m-d');
    $db->statement("SET TIME ZONE 'Pacific/Honolulu'");
    $audit = new AssignmentReceiptLineageAudit($db, SECRET);
    $matched = $audit->inspect($nowMs, $day);
    $assert($matched === [
        'scanned' => 1, 'matched' => 1, 'missing' => 0, 'conflicting' => 0,
        'scanComplete' => true, 'coverageProven' => false,
        'consistency' => 'receipt_lineage_provisional',
    ], 'PG18 source-to-specific HMAC receipt did not match');
    $wrong = (new AssignmentReceiptLineageAudit($db, str_repeat('z', 40)))
        ->inspect($nowMs, $day);
    $assert($wrong['matched'] === 0 && $wrong['missing'] === 1
        && $wrong['coverageProven'] === false,
        'incorrect operator key misleadingly matches source receipt');

    // Existing v1 digest is re-derived from REAL meter operation/account/time.
    // Deliberate tamper on disposable DB must produce a conflict, never match.
    $expected = TelemetryRecord::fromTrusted(TelemetryEvent::fromArray([
        'schemaVersion' => 1,
        'eventId' => '55555555-5555-4555-8555-555555555555',
        'eventType' => 'assignment.created',
        'occurredAtMs' => $previous->getTimestampMs(),
    ]), ACCOUNT, SECRET);
    $db->table('telemetry_event_receipts')->where('event_token', $expected->eventToken)
        ->update(['fingerprint' => str_repeat('f', 64)]);
    $tampered = $audit->inspect($nowMs, $day);
    $assert($tampered['conflicting'] === 1 && $tampered['matched'] === 0,
        'tampered source receipt was not rejected');
    $db->table('telemetry_event_receipts')->where('event_token', $expected->eventToken)
        ->update(['fingerprint' => $expected->fingerprint()]);
    $assert($audit->inspect($nowMs, $day)['matched'] === 1,
        'restored disposable receipt was not accepted');
    echo "Telemetry PG18 lineage exact HMAC receipt / wrong key / corruption / Honolulu PASS\n";
} else {
    throw new RuntimeException('Expected init|worker|verify|source-init|source-worker|source-verify|coverage|lineage');
}
