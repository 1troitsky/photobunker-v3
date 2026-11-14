<?php
declare(strict_types=1);

/**
 * #228: four REAL two-independent-OS-PHP / two-independent-PG18-backend races
 * for internal audited tariff grants. Each worker uses its OWN Laravel boot,
 * PDO connection and PID. The parent must OBSERVE PostgreSQL wait_event=Lock.
 *
 * Guarded disposable GitHub Actions PostgreSQL only. Never run on production.
 * No admin HTTP route, customer account or live payment is touched.
 */
use App\Administration\AdminAuditLedger;
use App\Administration\AdminPrincipal;
use App\Administration\Grants\AdminTrialGrantExecutor;
use App\Billing\EntitlementLedger;
use Carbon\CarbonImmutable;
use Illuminate\Contracts\Console\Kernel;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;
use Symfony\Component\HttpKernel\Exception\HttpExceptionInterface;

function must(bool $ok, string $description): void
{
    if (!$ok) {
        // Laravel's global CLI exception handler may log an ERROR yet exit 0.
        // An integration assertion failure MUST fail the GitHub Actions job.
        fwrite(STDERR, 'P3 #228 PG18 REAL race FAIL: '.$description."\n");
        exit(70);
    }
}

function requireDisposable(): void
{
    $required = [
        'GITHUB_ACTIONS' => 'true',
        'PB3_ADMIN_228_PG_RACE' => '1',
        'APP_ENV' => 'testing',
        'DB_CONNECTION' => 'pgsql',
        'DB_HOST' => '127.0.0.1',
        'DB_DATABASE' => 'pb3_admin_trial_228_ci',
        'DB_USERNAME' => 'pb3_admin_228_ci',
    ];
    foreach ($required as $key => $expected) {
        must(getenv($key) === $expected, 'REFUSED non-disposable environment '.$key);
    }
    must(extension_loaded('pdo_pgsql'), 'real PDO PostgreSQL driver required');
}

requireDisposable();
require dirname(__DIR__, 2).'/vendor/autoload.php';
$app = require dirname(__DIR__, 2).'/bootstrap/app.php';
$app->make(Kernel::class)->bootstrap();
must(config('app.env') === 'testing'
    && config('database.default') === 'pgsql'
    && config('database.connections.pgsql.host') === '127.0.0.1'
    && config('database.connections.pgsql.database') === 'pb3_admin_trial_228_ci'
    && DB::getSchemaBuilder()->hasTable('identity_accounts')
    && DB::getSchemaBuilder()->hasTable('admin_audit_heads_v1')
    && DB::getSchemaBuilder()->hasTable('admin_audit_records_v1')
    && DB::getSchemaBuilder()->hasTable('billing_entitlement_heads_v1')
    && DB::getSchemaBuilder()->hasTable('billing_entitlement_snapshots_v1')
    && DB::getSchemaBuilder()->hasTable('admin_trial_grant_operations_v1'),
    'refuse unmigrated or non-disposable PostgreSQL schema');

function awaitFile(string $filename, int $maxMs = 25000): void
{
    $start = microtime(true);
    while (!is_file($filename)) {
        must((microtime(true) - $start) * 1000 < $maxMs,
            'timed out waiting for '.basename($filename));
        usleep(20000);
    }
}

function principal(array $event): AdminPrincipal
{
    return new AdminPrincipal(
        $event['actorId'], 'owner',
        $event['actorExpiresAtMs'], $event['mfaAtMs'],
    );
}

function issue(array $event): array
{
    return app(AdminTrialGrantExecutor::class)->issueTrusted(
        principal($event),
        $event['operationId'], $event['targetId'], $event['planId'],
        $event['expectedRevision'], $event['reasonCode'],
        CarbonImmutable::parse($event['startsAt'], 'UTC'),
        CarbonImmutable::parse($event['endsAt'], 'UTC'),
    );
}

function worker(array $arguments): never
{
    must(count($arguments) === 6, 'worker args count');
    [$command, $role, $fixture, $ownerReady, $contenderReady, $output] = $arguments;
    must($command === 'worker' && in_array($role, ['owner','contender'], true),
        'worker role invalid');
    $event = json_decode((string) file_get_contents($fixture), true, 16, JSON_THROW_ON_ERROR);
    must(is_array($event) && isset($event['actorId'], $event['operationId'],
        $event['targetId']), 'synthetic fixture invalid');

    $backend = (int) DB::selectOne('SELECT pg_backend_pid() AS pid')->pid;
    $started = microtime(true);
    try {
        if ($role === 'owner') {
            DB::transaction(function () use (
                $event, $ownerReady, $contenderReady, $backend, &$result,
            ): void {
                // Hold the same global audit serialization row until the
                // contender has attempted its own independent DB write.
                $head = DB::table('admin_audit_heads_v1')->where('id', 1)
                    ->lockForUpdate()->first();
                must($head !== null, 'global audit head exists');
                $result = issue($event);
                file_put_contents($ownerReady, (string) $backend);
                awaitFile($contenderReady);
                usleep(1800000); // deterministic overlap, not a simulated lock
            }, 1);
        } else {
            file_put_contents($contenderReady, (string) $backend);
            $result = issue($event);
        }
        $result['outcome'] = 'applied';
    } catch (DomainException $error) {
        $result = ['outcome'=>'denied','reason'=>$error->getMessage()];
    } catch (HttpExceptionInterface $error) {
        $result = ['outcome'=>'http_denied','status'=>$error->getStatusCode()];
    } catch (Throwable $error) {
        $result = [
            'outcome'=>'unexpected_error',
            'type'=>get_class($error),
            'reason'=>$error->getMessage(),
        ];
    }
    $result['pgBackend'] = $backend;
    $result['osPid'] = getmypid();
    $result['elapsedMs'] = (int) round((microtime(true) - $started) * 1000);
    file_put_contents($output, json_encode($result, JSON_THROW_ON_ERROR));
    exit($result['outcome'] === 'unexpected_error' ? 2 : 0);
}

function spawn(
    string $role, string $fixture, string $ownerReady, string $contenderReady,
    string $output, string $log,
): mixed {
    $args = [PHP_BINARY, __FILE__, 'worker', $role, $fixture,
        $ownerReady, $contenderReady, $output];
    $process = proc_open($args, [
        0 => ['pipe','r'],
        1 => ['file',$log.'.stdout','w'],
        2 => ['file',$log.'.stderr','w'],
    ], $pipes, dirname(__DIR__, 2), null, ['bypass_shell'=>true]);
    must(is_resource($process), 'launch independent OS PHP process');
    fclose($pipes[0]);
    return $process;
}

function observedPgLock(int $backend, int $timeoutMs = 1400): bool
{
    $start = microtime(true);
    while ((microtime(true) - $start) * 1000 < $timeoutMs) {
        $row = DB::selectOne(
            'SELECT wait_event_type FROM pg_stat_activity WHERE pid = ?', [$backend],
        );
        if ($row !== null && $row->wait_event_type === 'Lock') {
            return true;
        }
        usleep(25000);
    }
    return false;
}

/**
 * @return array{owner:array,contender:array}
 */
function race(string $name, array $ownerEvent, array $contenderEvent): array
{
    $dir = sys_get_temp_dir().'/pb3-admin-228-'.bin2hex(random_bytes(8));
    must(mkdir($dir, 0700), 'private synthetic test fixture directory');
    $ownerFixture = $dir.'/owner-input.json';
    $contenderFixture = $dir.'/contender-input.json';
    $ownerReady = $dir.'/owner.ready';
    $contenderReady = $dir.'/contender.ready';
    $ownerOutput = $dir.'/owner-result.json';
    $contenderOutput = $dir.'/contender-result.json';
    file_put_contents($ownerFixture, json_encode($ownerEvent, JSON_THROW_ON_ERROR));
    file_put_contents($contenderFixture, json_encode($contenderEvent, JSON_THROW_ON_ERROR));
    $owner = null;
    $contender = null;
    try {
        $owner = spawn('owner', $ownerFixture, $ownerReady, $contenderReady,
            $ownerOutput, $dir.'/owner');
        awaitFile($ownerReady);
        $contender = spawn('contender', $contenderFixture,
            $ownerReady, $contenderReady, $contenderOutput, $dir.'/contender');
        awaitFile($contenderReady);
        $blocked = observedPgLock((int) file_get_contents($contenderReady));
        awaitFile($ownerOutput);
        awaitFile($contenderOutput);
        $ownerExit = proc_close($owner);
        $owner = null;
        $contenderExit = proc_close($contender);
        $contender = null;
        $a = json_decode((string) file_get_contents($ownerOutput), true, 16, JSON_THROW_ON_ERROR);
        $b = json_decode((string) file_get_contents($contenderOutput), true, 16, JSON_THROW_ON_ERROR);
        must($ownerExit === 0 && $contenderExit === 0,
            $name.' unexpected worker exit '.json_encode([$a,$b]));
        must($blocked, $name.' must observe REAL PostgreSQL wait_event_type=Lock');
        must($a['pgBackend'] !== $b['pgBackend'] && $a['osPid'] !== $b['osPid'],
            $name.' must use distinct independent PG backends and OS processes');
        must($a['outcome'] === 'applied' && $a['state'] === 'internal_trial_grant_recorded'
            && $a['revision'] === 2 && $a['replay'] === false,
            $name.' original grant must commit once');
        must($b['elapsedMs'] >= 300,
            $name.' contender must wait on actual serialized database transaction');
        return ['owner'=>$a, 'contender'=>$b];
    } finally {
        foreach ([$owner,$contender] as $process) {
            if (is_resource($process)) {
                proc_terminate($process);
                proc_close($process);
            }
        }
        foreach (glob($dir.'/*') ?: [] as $filename) {
            @unlink($filename);
        }
        @rmdir($dir);
    }
}

function account(): string
{
    $id = (string) Str::uuid();
    DB::table('identity_accounts')->insert([
        'id'=>$id, 'operation_id'=>(string) Str::uuid(),
        'prepare_hash'=>str_repeat('a', 64), 'status'=>'ready',
        'reserved_until'=>now()->addDay(),
        'created_at'=>now(), 'updated_at'=>now(),
    ]);
    return $id;
}

function assertCommitted(
    string $label, string $target, int $expectedGlobalAuditCount,
): void {
    $snapshots = DB::table('billing_entitlement_snapshots_v1')
        ->where('account_id', $target)->orderBy('revision')->get();
    must($snapshots->count() === 2
        && (int) $snapshots[0]->revision === 1
        && $snapshots[0]->plan_id === 'free'
        && (int) $snapshots[1]->revision === 2
        && $snapshots[1]->source === 'admin_mfa_approved',
        $label.' must persist only immutable Free->paid revisions');
    $receipts = DB::table('admin_trial_grant_operations_v1')
        ->where('account_id',$target)->get();
    must($receipts->count() === 1
        && (int) $receipts[0]->entitlement_revision === 2
        && hash_equals((string)$snapshots[1]->verified_event_hash,
            (string)$receipts[0]->verified_event_hash),
        $label.' exactly one matching durable grant receipt');
    $head = DB::table('billing_entitlement_heads_v1')
        ->where('account_id', $target)->first();
    must($head !== null && (int) $head->revision === 2
        && (int) $head->snapshot_id === (int) $snapshots[1]->id,
        $label.' billing head must point to committed trial');
    $audit = app(AdminAuditLedger::class)->verifyChain();
    must($audit['state'] === 'database_consistent_only'
        && $audit['count'] === $expectedGlobalAuditCount
        && DB::table('admin_audit_records_v1')->count() === $expectedGlobalAuditCount,
        $label.' rolled-back proposals must not escape audited chain');
}

if (($argv[1] ?? null) === 'worker') {
    worker(array_slice($argv, 1));
}
must(count($argv) === 1, 'unrecognized command line arguments');

$now = CarbonImmutable::now('UTC');
$actor = account();
$shared = [
    'actorId'=>$actor,
    'actorExpiresAtMs'=>$now->getTimestampMs() + 3600000,
    'mfaAtMs'=>$now->getTimestampMs() - 1000,
    'expectedRevision'=>1,
    'reasonCode'=>'trial_access',
    'startsAt'=>$now->subSeconds(45)->startOfSecond()->format('Y-m-d\TH:i:s\Z'),
    'endsAt'=>$now->addDays(2)->startOfSecond()->format('Y-m-d\TH:i:s\Z'),
];

// 1: exact retry from another device/process while original transaction is
// still pending; one audit+one receipt+one paid entitlement only.
$target1 = account();
app(EntitlementLedger::class)->current($target1);
$first = $shared + [
    'operationId'=>(string) Str::uuid(), 'targetId'=>$target1, 'planId'=>'go',
];
$replayed = race('same-operation-real-lost-ACK', $first, $first);
must($replayed['contender']['outcome'] === 'applied'
    && $replayed['contender']['replay'] === true
    && $replayed['contender']['eventHash'] === $replayed['owner']['eventHash']
    && $replayed['contender']['auditDigest'] === $replayed['owner']['auditDigest'],
    'idempotent Lost ACK retry must never apply a second paid grant');
assertCommitted('same-operation-real-lost-ACK', $target1, 1);
fwrite(STDOUT, "P3 #228 PG18 REAL LOST ACK PASS: 2 PHP/PG processes, observed Lock, one grant\n");

// 2: malicious same request id with different plan; immutable audit plus
// receipt collision must be rejected, never silently upgraded.
$target2 = account();
app(EntitlementLedger::class)->current($target2);
$original = $shared + [
    'operationId'=>(string) Str::uuid(), 'targetId'=>$target2, 'planId'=>'go',
];
$changed = $original;
$changed['planId'] = 'unlimited_plus';
$collision = race('same-operation-changed-plan', $original, $changed);
must($collision['contender']['outcome'] === 'denied'
    && $collision['contender']['reason'] === 'admin.trial_conflicting_replay',
    'same operation cannot silently mint different plan');
assertCommitted('same-operation-changed-plan', $target2, 2);
must(DB::table('billing_entitlement_snapshots_v1')
    ->where('account_id', $target2)->where('revision',2)->value('plan_id') === 'go',
    'changed plan cannot overwrite committed lower plan');
fwrite(STDOUT, "P3 #228 PG18 REAL CONFLICT PASS: changed plan rejected, no extra audit/receipt\n");

// 3: two DIFFERENT concurrently authorized operations BOTH claim the same
// billing expected revision. The loser must have NO durable audit event.
$target3 = account();
app(EntitlementLedger::class)->current($target3);
$owner = $shared + [
    'operationId'=>(string) Str::uuid(), 'targetId'=>$target3, 'planId'=>'go',
];
$contender = $owner;
$contender['operationId'] = (string) Str::uuid();
$contender['planId'] = 'pro';
$stale = race('distinct-ops-stale-revision', $owner, $contender);
must($stale['contender']['outcome'] === 'http_denied'
    && $stale['contender']['status'] === 409,
    'stale billing revision must reject without persisting partial admin audit');
assertCommitted('distinct-ops-stale-revision', $target3, 3);
must(DB::table('admin_audit_records_v1')->where('operation_id',
    $contender['operationId'])->count() === 0,
    'aborted concurrent operation must leave NO orphan audit event');
fwrite(STDOUT, "P3 #228 PG18 REAL STALE CAS PASS: loser denied 409, audited rollback\n");

// 4: unrelated target operations can both succeed after real serialized
// head-lock contention without cross-account grant confusion.
$target4 = account();
$target5 = account();
app(EntitlementLedger::class)->current($target4);
app(EntitlementLedger::class)->current($target5);
$one = $shared + [
    'operationId'=>(string) Str::uuid(), 'targetId'=>$target4, 'planId'=>'pro',
];
$two = $shared + [
    'operationId'=>(string) Str::uuid(), 'targetId'=>$target5, 'planId'=>'go',
];
$both = race('distinct-targets-serialized-grants', $one, $two);
must($both['contender']['outcome'] === 'applied'
    && $both['contender']['replay'] === false
    && $both['contender']['revision'] === 2
    && $both['contender']['eventHash'] !== $both['owner']['eventHash'],
    'independent targets must each commit their OWN audited grant');
assertCommitted('distinct-target-A', $target4, 5);
assertCommitted('distinct-target-B', $target5, 5);
fwrite(STDOUT, "P3 #228 PG18 REAL MULTI-TARGET PASS: two separate granted accounts\n");
fwrite(STDOUT, "P3 #228 PG18 REAL COMPLETE: 4/4 races PASS, two actual PHP/PDO PG18 processes each, observed Lock; five committed audit events, five grant receipts, no orphan; no Admin HTTP endpoint or production identity proof\n");
