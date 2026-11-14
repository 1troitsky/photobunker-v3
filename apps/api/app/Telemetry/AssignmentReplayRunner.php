<?php
declare(strict_types=1);

namespace App\Telemetry;

use InvalidArgumentException;

/**
 * Bounded operator-only reconciliation. Not scheduled or exposed over HTTP.
 * No durable source cursor: each new run scans from the start of the UTC
 * acceptance window and relies on the durable telemetry event receipts.
 * This deliberately favors crash recovery over throughput.
 */
final readonly class AssignmentReplayRunner
{
    public function __construct(private AssignmentCreationReplay $source) {}

    /**
     * Environment gates are prerequisites for a *manual* operator run,
     * not a substitute for real legal/user consent or owner-approved policy.
     *
     * Returns the externally supplied secret without logging it.
     */
    public static function requireOperatorSecret(
        mixed $enabled, mixed $policyApproved, mixed $secret,
        string $driver, bool $debug,
    ): string {
        if ($enabled !== '1'
            || $policyApproved !== '1'
            || $driver !== 'pgsql'
            || $debug
            || !is_string($secret)
            || strlen($secret) < 32
            || strlen($secret) > 4096) {
            throw new InvalidArgumentException('telemetry.operator_disabled');
        }
        return $secret;
    }

    /**
     * @return array{pages:int,accepted:int,duplicate:int,complete:bool}
     */
    public function run(int $serverNowMs, int $pageSize = 100, int $maxPages = 100): array
    {
        if ($serverNowMs < 1 || $serverNowMs > 9007199254740991
            || $pageSize < 1 || $pageSize > 200
            || $maxPages < 1 || $maxPages > 500) {
            throw new InvalidArgumentException('telemetry.runner_invalid_bounds');
        }

        $next = null;
        $accepted = 0;
        $duplicate = 0;
        for ($pages = 1; $pages <= $maxPages; $pages++) {
            $page = $this->source->replayPage($serverNowMs, $pageSize, $next);
            $accepted += $page['accepted'];
            $duplicate += $page['duplicate'];
            if ($page['hasMore'] === false) {
                return [
                    'pages' => $pages,
                    'accepted' => $accepted,
                    'duplicate' => $duplicate,
                    'complete' => true,
                ];
            }
            if (!is_array($page['next'])
                || $page['next'] === $next) {
                throw new \RuntimeException('telemetry.runner_invalid_progress');
            }
            // Sensitive source cursor remains in memory only, never returned.
            $next = $page['next'];
        }

        // Explicit incomplete result prevents an operator from mistaking a
        // capped scan for a complete reconciliation. Start again from NULL
        // with larger bounded limits; durable receipts prevent double count.
        return [
            'pages' => $maxPages,
            'accepted' => $accepted,
            'duplicate' => $duplicate,
            'complete' => false,
        ];
    }
}
