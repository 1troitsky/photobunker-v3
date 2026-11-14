<?php
declare(strict_types=1);

/**
 * #225: genuine independent PHP OS-process contention against PostgreSQL 18.
 *
 * Both workers invoke the REAL DurableQuoteAdmission service. The parent
 * observes pg_stat_activity.wait_event_type = 'Lock' for the challenger
 * BEFORE releasing the owner account row. No fake SQL-only admission test.
 *
 * This harness is an intentionally destructive SYNTHETIC database fixture:
 * it refuses everything except the named, disposable GitHub CI database.
 * It creates no verified settlement, provider credential or paid entitlement.
 */

use App\Billing\Checkout\DurableQuoteAdmission;
use Carbon\CarbonImmutable;
use Illuminate\Contracts\Console\Kernel;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;
use Illuminate\Support\Str;

function checkoutRaceRequireIsolated(): void
{
    $expected = [
        'GITHUB_ACTIONS' => 'true',
        'PB3_CHECKOUT_RACE_CI' => '1',
        'APP_ENV' => 'testing',
        'DB_CONNECTION' => 'pgsql',
        'DB_HOST' => '127.0.0.1',
        'DB_PORT' => '5432',
        'DB_DATABASE' => 'pb3_checkout_225',
        'DB_USERNAME' => 'pb3_checkout',
    ];
    foreach ($expected as $field => $value) {
        if (getenv($field) !== $value) {
            throw new RuntimeException('checkout.race_refused_environment: '.$field);
        }
    }
}

checkoutRaceRequireIsolated();
require dirname(__DIR__, 2).'/vendor/autoload.php';
$app = require dirname(__DIR__, 2).'/bootstrap/app.php';
$app->make(Kernel::class)->bootstrap();

function checkoutRaceMust(bool $condition, string $message): void
{
    if (!$condition) {
        throw new RuntimeException('checkout.pg_race_failed: '.$message);
    }
}

checkoutRaceMust(config('database.default') === 'pgsql'
    && config('app.env') === 'testing'
    && config('database.connections.pgsql.host') === '127.0.0.1'
    && config('database.connections.pgsql.database') === 'pb3_checkout_225'
    && Schema::hasTable('checkout_quotes_v1')
    && Schema::hasTable('identity_accounts'),
    'not our migrated isolated PostgreSQL');

$version = DB::selectOne(
    "SELECT current_setting('server_version_num')::integer AS pg_version"
);
checkoutRaceMust((int)$version->pg_version >= 180000
    && (int)$version->pg_version < 190000, 'PostgreSQL must be version 18');

function checkoutRaceWait(string $file, int $timeoutMs = 12000): void
{
    $started = microtime(true);
    while (!is_file($file)) {
        if ((microtime(true) - $started) * 1000 > $timeoutMs) {
            throw new RuntimeException('checkout.race_timeout: '.basename($file));
        }
        usleep(25000);
    }
}

function checkoutRaceAccount(): string
{
    $id = (string) Str::uuid();
    $now = CarbonImmutable::now('UTC');
    DB::table('identity_accounts')->insert([
        'id' => $id,
        'operation_id' => (string)Str::uuid(),
        'prepare_hash' => str_repeat('a', 64),
        'status' => 'ready',
        'reserved_until' => $now->addDays(1),
        'created_at' => $now,
        'updated_at' => $now,
    ]);
    return $id;
}

function checkoutRaceRunWorker(array $args): never
{
    // worker, owner|challenger, accountId, key, planId, months,
    // ownerLockedPath, challengerReadyPath, releasePath, resultPath
    checkoutRaceMust(count($args) === 10, 'invalid worker argument count');
    [, $role, $account, $key, $plan, $months,
        $ownerLocked, $challengerReady, $release, $result] = $args;
    checkoutRaceMust(in_array($role, ['owner', 'challenger'], true)
        && Str::isUuid($account)
        && in_array($plan, ['go', 'pro'], true)
        && in_array($months, ['1', '6', '12'], true)
        && preg_match('/^[a-z0-9-]{16,96}$/D', $key) === 1,
        'invalid worker fixture');

    $backend = DB::selectOne('SELECT pg_backend_pid() AS pid');
    $resultData = [
        'role' => $role,
        'phpPid' => getmypid(),
        'pgPid' => (int)$backend->pid,
        'outcome' => null,
    ];

    try {
        if ($role === 'owner') {
            $quote = null;
            DB::transaction(function () use (
                $account, $key, $plan, $months,
                $ownerLocked, $release, &$quote
            ): void {
                $locked = DB::table('identity_accounts')
                    ->where('id', $account)
                    ->where('status', 'ready')
                    ->lockForUpdate()
                    ->first();
                checkoutRaceMust($locked !== null, 'owner account disappeared');
                // This lock is already held by the owner's real PostgreSQL
                // transaction when the independent challenger starts.
                file_put_contents($ownerLocked, 'locked');
                checkoutRaceWait($release, 16000);
                // Actual production service, nested transaction/savepoint,
                // same DB connection and account row lock.
                $quote = app(DurableQuoteAdmission::class)->reserve(
                    $account, $key, $plan, (int)$months,
                    CarbonImmutable::now('UTC')->startOfSecond(),
                );
            }, 1);
        } else {
            file_put_contents($challengerReady, json_encode([
                'phpPid' => getmypid(),
                'pgPid' => (int)$backend->pid,
            ], JSON_THROW_ON_ERROR));
            $quote = app(DurableQuoteAdmission::class)->reserve(
                $account, $key, $plan, (int)$months,
                CarbonImmutable::now('UTC')->startOfSecond(),
            );
        }
        $resultData['outcome'] = 'accepted';
        $resultData['quote'] = $quote;
    } catch (RuntimeException $error) {
        // Fail hard for ANY unexpected runtime exception. In particular,
        // deadlocks, SQL errors, missing quote rows or failed locks must not
        // be accidentally interpreted as successful policy rejection.
        if ($error->getMessage() !== 'checkout.idempotency_conflict') {
            throw $error;
        }
        $resultData['outcome'] = 'idempotency_conflict';
    }

    file_put_contents($result, json_encode($resultData, JSON_THROW_ON_ERROR));
    exit(0);
}

function checkoutRaceSpawn(
    string $role,
    string $account,
    string $key,
    string $plan,
    int $months,
    string $ownerLocked,
    string $challengerReady,
    string $release,
    string $result,
    string $dir
): mixed {
    $command = [
        PHP_BINARY, __FILE__, 'worker', $role, $account, $key,
        $plan, (string)$months, $ownerLocked, $challengerReady, $release, $result,
    ];
    $spec = [
        0 => ['pipe', 'r'],
        1 => ['file', $dir.'/'.$role.'.stdout', 'w'],
        2 => ['file', $dir.'/'.$role.'.stderr', 'w'],
    ];
    $process = proc_open(
        $command, $spec, $pipes, dirname(__DIR__, 2), null,
        ['bypass_shell' => true],
    );
    checkoutRaceMust(is_resource($process), 'cannot launch independent PHP worker');
    fclose($pipes[0]);
    return $process;
}

function checkoutRaceObserveBlockedBackend(int $pid, int $timeoutMs = 10000): array
{
    $start = microtime(true);
    do {
        $row = DB::selectOne(
            'SELECT pid, state, wait_event_type, wait_event '
            .'FROM pg_stat_activity WHERE pid = ?',
            [$pid],
        );
        if ($row !== null
            && $row->wait_event_type === 'Lock'
            && $row->state === 'active') {
            return [
                'pgPid' => (int)$row->pid,
                'state' => (string)$row->state,
                'wait_event_type' => (string)$row->wait_event_type,
                'wait_event' => (string)$row->wait_event,
            ];
        }
        usleep(30000);
    } while ((microtime(true) - $start) * 1000 <= $timeoutMs);
    throw new RuntimeException('checkout.pg_race_failed: no real PostgreSQL Lock wait observed');
}

function checkoutRaceRun(
    string $scenario,
    string $ownerAccount,
    string $challengerAccount,
    string $ownerPlan,
    string $challengerPlan,
    string $key,
    bool $expectBlocked
): array {
    $dir = sys_get_temp_dir().'/pb3-checkout-225-'.bin2hex(random_bytes(8));
    checkoutRaceMust(mkdir($dir, 0700), 'cannot make private fixture dir');
    $ownerLocked = $dir.'/owner.locked';
    $challengerReady = $dir.'/challenger.ready';
    $release = $dir.'/release';
    $ownerResult = $dir.'/owner.json';
    $challengerResult = $dir.'/challenger.json';
    $owner = null;
    $challenger = null;

    try {
        $owner = checkoutRaceSpawn('owner', $ownerAccount, $key, $ownerPlan,
            6, $ownerLocked, $challengerReady, $release, $ownerResult, $dir);
        checkoutRaceWait($ownerLocked);

        $challenger = checkoutRaceSpawn('challenger', $challengerAccount, $key,
            $challengerPlan, 6, $ownerLocked, $challengerReady, $release,
            $challengerResult, $dir);
        checkoutRaceWait($challengerReady);

        $ready = json_decode((string)file_get_contents($challengerReady),
            true, 8, JSON_THROW_ON_ERROR);
        checkoutRaceMust(is_int($ready['pgPid'] ?? null)
            && is_int($ready['phpPid'] ?? null),
            'missing real challenger PID');

        if ($expectBlocked) {
            $evidence = checkoutRaceObserveBlockedBackend($ready['pgPid']);
            checkoutRaceMust($evidence['wait_event_type'] === 'Lock',
                'challenger did not wait on actual row lock');
        } else {
            // Two separate account rows must NOT block each other.
            // Challenger MUST COMMIT while owner still holds its own row lock.
            checkoutRaceWait($challengerResult, 10000);
            checkoutRaceMust(!is_file($ownerResult),
                'owner was released before other account finished');
            $evidence = ['differentAccountCompletedWhileOwnerLocked' => true];
        }

        file_put_contents($release, 'proceed');
        checkoutRaceWait($ownerResult);
        checkoutRaceWait($challengerResult);

        $ownerExit = proc_close($owner);
        $owner = null;
        $challengerExit = proc_close($challenger);
        $challenger = null;
        checkoutRaceMust($ownerExit === 0 && $challengerExit === 0,
            $scenario.' worker exited unsuccessfully');

        $first = json_decode((string)file_get_contents($ownerResult),
            true, 64, JSON_THROW_ON_ERROR);
        $second = json_decode((string)file_get_contents($challengerResult),
            true, 64, JSON_THROW_ON_ERROR);

        checkoutRaceMust(($first['role'] ?? null) === 'owner'
            && ($second['role'] ?? null) === 'challenger'
            && ($first['phpPid'] ?? null) !== ($second['phpPid'] ?? null)
            && ($first['pgPid'] ?? null) !== ($second['pgPid'] ?? null)
            && $first['phpPid'] !== getmypid(),
            $scenario.' did not use distinct independent processes/DB backends');

        return [
            'scenario' => $scenario,
            'owner' => $first,
            'challenger' => $second,
            'lockEvidence' => $evidence,
        ];
    } finally {
        foreach ([$owner, $challenger] as $process) {
            if (is_resource($process)) {
                proc_terminate($process);
                proc_close($process);
            }
        }
        foreach (glob($dir.'/*') ?: [] as $file) {
            @unlink($file);
        }
        @rmdir($dir);
    }
}

if (($argv[1] ?? '') === 'worker') {
    checkoutRaceRunWorker(array_slice($argv, 1));
}
checkoutRaceMust(count($argv) === 1, 'unexpected parent CLI arguments');

// Scenario A: same account/key/period from two independent real PHP workers.
$accountA = checkoutRaceAccount();
$keyA = 'race-identical-'.bin2hex(random_bytes(10));
$identical = checkoutRaceRun('identical', $accountA, $accountA,
    'go', 'go', $keyA, true);
checkoutRaceMust(($identical['owner']['outcome'] ?? null) === 'accepted'
    && ($identical['challenger']['outcome'] ?? null) === 'accepted'
    && ($identical['owner']['quote'] ?? null) === $identical['challenger']['quote']
    && DB::table('checkout_quotes_v1')->where('account_id', $accountA)->count() === 1,
    'same request did not reuse byte-identical original invoice');
echo "P3 CHECKOUT PG18 1/3 PASS: same-account exact replay; TWO PHP OS processes; "
    ."observed Lock wait; ONE immutable invoice\n";

// Scenario B: same account and key, conflicting tariff, no second invoice.
$accountB = checkoutRaceAccount();
$keyB = 'race-conflict-'.bin2hex(random_bytes(10));
$conflict = checkoutRaceRun('conflict', $accountB, $accountB,
    'go', 'pro', $keyB, true);
checkoutRaceMust(($conflict['owner']['outcome'] ?? null) === 'accepted'
    && ($conflict['challenger']['outcome'] ?? null) === 'idempotency_conflict'
    && DB::table('checkout_quotes_v1')->where('account_id', $accountB)->count() === 1
    && DB::table('checkout_quotes_v1')->where('account_id', $accountB)
        ->value('requested_plan_id') === 'go',
    'different purchase on the same idempotency key was accepted');
echo "P3 CHECKOUT PG18 2/3 PASS: conflicting plan denied AFTER Lock wait; "
    ."ONE original invoice\n";

// Scenario C: same key, DIFFERENT trusted account, parallel independent writes.
$accountC = checkoutRaceAccount();
$accountD = checkoutRaceAccount();
$keyC = 'race-isolated-'.bin2hex(random_bytes(10));
$cross = checkoutRaceRun('cross-account', $accountC, $accountD,
    'go', 'go', $keyC, false);
checkoutRaceMust(($cross['owner']['outcome'] ?? null) === 'accepted'
    && ($cross['challenger']['outcome'] ?? null) === 'accepted'
    && $cross['owner']['quote']['invoiceId'] !== $cross['challenger']['quote']['invoiceId']
    && DB::table('checkout_quotes_v1')->where('account_id', $accountC)->count() === 1
    && DB::table('checkout_quotes_v1')->where('account_id', $accountD)->count() === 1,
    'cross-account reservation unnecessarily blocked or cross-adopted');
echo "P3 CHECKOUT PG18 3/3 PASS: independent accounts write concurrently "
    ."without waiting for other account release\n";

checkoutRaceMust(DB::table('billing_entitlement_heads_v1')
    ->whereIn('account_id', [$accountA, $accountB, $accountC, $accountD])
    ->count() === 0, 'unverified quotes unexpectedly activated entitlements');
echo "P3 CHECKOUT PG18 COMPLETE: 3/3 true two-PHP-process races verified; "
    ."no provider settlement or paid grant\n";
