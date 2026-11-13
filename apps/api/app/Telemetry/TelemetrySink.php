<?php
declare(strict_types=1);

namespace App\Telemetry;

/**
 * Required storage contract for future production ingestion:
 *
 * - atomic UNIQUE eventToken with fingerprint; same replay => Duplicate,
 *   changed replay => Conflict; only Accepted increments counters.
 * - counter and distinct actor token insertion must commit in the SAME
 *   transaction as eventToken; never double-count on concurrent workers.
 * - UTC calendar periods only (day, ISO week, month), not rolling periods.
 * - events older than 7 days never reach this sink; retention of dedupe
 *   tokens must cover at least the seven-day acceptance/retry window.
 * - retain only aggregate counters and bounded dedupe/actor tokens; purge
 *   actor.day/week/month sets after their calendar reporting periods end.
 * - NO raw accountId, eventId, event timestamp, IP, GPS, media/file names,
 *   recovery credentials, E2EE content or sensitive payload.
 * - any analytics read/export endpoint MUST enforce admin least privilege.
 *
 * An in-memory test fake proves contracts, NOT cross-process atomicity.
 * There is deliberately no migration, middleware hook or dashboard here.
 */
interface TelemetrySink
{
    public function admit(TelemetryRecord $record): TelemetryDecision;
}
