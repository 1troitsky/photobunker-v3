<?php
declare(strict_types=1);

namespace App\Storage\Replication;

use Carbon\CarbonImmutable;
use Illuminate\Support\Facades\DB;
use RuntimeException;
use Throwable;

/**
 * Internal opt-in execution of a bounded number of due #234 ciphertext jobs.
 *
 * This is NOT a Laravel scheduled job, HTTP route, queue daemon, automatic
 * retry worker or entitlement. The caller must separately supply the
 * trusted server-owned coordinator with a verified provider registry.
 * This batcher cannot authorize credentials, live placement or deletion.
 *
 * Limits are local to ONE invocation. They do NOT implement a global
 * cross-process provider/account bandwidth or worker concurrency quota.
 * The underlying durable per-job account lock and lease are the only
 * cross-process admission mechanism, independently tested under PG18.
 */
final class BoundedReplicaDispatcher
{
    private const TABLE = 'ciphertext_replication_jobs_v1';
    private const MAX_BATCH_JOBS = 16;
    private const MAX_BATCH_BYTES = 64 * 1024 * 1024;
    private const MAX_PER_ACCOUNT = 2;
    private const MAX_ATTEMPTS = 12;
    private const MAX_OBJECT_BYTES = 8 * 1024 * 1024;
    private const MAX_SCAN_ROWS = 192;

    public function __construct(private readonly CiphertextReplicaCoordinator $coordinator) {}

    /**
     * Explicitly dispatch a small finite batch. All arguments must come
     * from trusted operational configuration, NOT a user request.
     *
     * Counts describe *observed states*, not bytes delivered, account
     * backups, or receipt of a confirmed provider failure-domain.
     *
     * @return array{
     *   scanLimit:int,candidatesScanned:int,invoked:int,bytesBudgeted:int,
     *   budgetSkipped:int,observedVerified:int,observedRetry:int,
     *   observedInFlight:int,observedCancelled:int,observedRefused:int,
     *   noAutomaticScheduling:bool,globalRateLimitEnforced:bool
     * }
     */
    public function dispatch(
        CarbonImmutable $trustedNow,
        int $maxJobs = 4,
        int $maxBytes = 8 * 1024 * 1024,
        int $maxPerAccount = 1,
        int $maxAttempts = 5,
    ): array {
        if ($maxJobs < 1 || $maxJobs > self::MAX_BATCH_JOBS
            || $maxBytes < 1 || $maxBytes > self::MAX_BATCH_BYTES
            || $maxPerAccount < 1 || $maxPerAccount > self::MAX_PER_ACCOUNT
            || $maxAttempts < 1 || $maxAttempts > self::MAX_ATTEMPTS) {
            throw new RuntimeException('replication.invalid_dispatch_limits');
        }

        // Do not let a stale caller clock prematurely select expired leases
        // or future due jobs. A fresh current UTC reading can only advance
        // the safe "now". The coordinator will independently recheck.
        $actual = CarbonImmutable::now('UTC');
        $now = $actual->greaterThan($trustedNow) ? $actual : $trustedNow;
        $scanLimit = self::MAX_SCAN_ROWS;

        $base = DB::table(self::TABLE . ' as r')
            ->join('identity_accounts as a','a.id','=','r.account_id')
            ->where('a.status','ready')
            ->where('r.next_attempt_at','<=',$now->utc())
            ->where('r.attempts','<',$maxAttempts)
            ->where('r.ciphertext_bytes','>=',1)
            ->where('r.ciphertext_bytes','<=',self::MAX_OBJECT_BYTES)
            ->where(function ($query) use ($now): void {
                $query->whereIn('r.state',['queued','retry'])
                    ->orWhere(function ($leased) use ($now): void {
                        $leased->where('r.state','leased')
                            ->whereNotNull('r.lease_until')
                            ->where('r.lease_until','<=',$now->utc());
                    });
            });

        // PG18 and modern SQLite both implement ROW_NUMBER(). Select
        // account_rank=1 from EACH ready account before rank=2, preventing
        // one account's oldest tasks from starving every other account.
        // Each row is still independently fenced again in process().
        $candidates = DB::query()->fromSub(
            $base->select(
                'r.id','r.account_id','r.ciphertext_bytes',
                'r.next_attempt_at','r.created_at',
                DB::raw(
                    'ROW_NUMBER() OVER (PARTITION BY r.account_id ' .
                    'ORDER BY r.next_attempt_at ASC, r.created_at ASC, r.id ASC)' .
                    ' AS account_rank'
                )
            ),'due')
            ->where('due.account_rank','<=',$maxPerAccount)
            ->orderBy('due.account_rank')
            ->orderBy('due.next_attempt_at')
            ->orderBy('due.created_at')
            ->orderBy('due.id')
            ->limit($scanLimit)
            ->get();

        $stats = [
            'scanLimit'=>$scanLimit,
            'candidatesScanned'=>$candidates->count(),
            'invoked'=>0,
            'bytesBudgeted'=>0,
            'budgetSkipped'=>0,
            'observedVerified'=>0,
            'observedRetry'=>0,
            'observedInFlight'=>0,
            'observedCancelled'=>0,
            'observedRefused'=>0,
            'noAutomaticScheduling'=>true,
            'globalRateLimitEnforced'=>false,
        ];

        foreach ($candidates as $candidate) {
            if ($stats['invoked'] >= $maxJobs) break;
            $bytes = (int)$candidate->ciphertext_bytes;
            // No unbounded arithmetic, and no network IO if the remaining
            // byte budget cannot accommodate the *whole* ciphertext.
            if ($bytes > $maxBytes - $stats['bytesBudgeted']) {
                $stats['budgetSkipped']++;
                continue;
            }
            $stats['bytesBudgeted'] += $bytes;
            $stats['invoked']++;
            try {
                // Real server-owned coordinator checks lease, owner,
                // tombstones, expiry, stream bytes, destination GET+SHA
                // and physical ACK. Never emulate a verified state here.
                $result = $this->coordinator->process(
                    (string)$candidate->id,CarbonImmutable::now('UTC')
                );
                switch ($result['state'] ?? null) {
                    case 'verified':
                        $stats['observedVerified']++;
                        break;
                    case 'retry':
                        $stats['observedRetry']++;
                        break;
                    case 'leased':
                    case 'queued':
                        $stats['observedInFlight']++;
                        break;
                    case 'cancelled':
                        $stats['observedCancelled']++;
                        break;
                    default:
                        $stats['observedRefused']++;
                }
            } catch (Throwable) {
                // Account may be revoked or the row may be deleted after
                // due selection. Do NOT leak provider errors, credentials,
                // object keys or identity metadata to the batch caller.
                // Do not claim completion. An infrastructure DB outage can
                // be seen as refusal here; operations must independently
                // monitor the database and the durable outbox.
                $stats['observedRefused']++;
            }
        }

        return $stats;
    }
}
