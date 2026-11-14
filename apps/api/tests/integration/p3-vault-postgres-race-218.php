<?php
declare(strict_types=1);

/**
 * P3 #218: two INDEPENDENT OS PHP processes and one PostgreSQL 18 account
 * row lock. Never accesses real customer records or makes S3 requests.
 * Use ONLY the disposable CI database; the parent proves B is actually
 * waiting on PostgreSQL before letting A commit its staged generation.
 */
use App\Backup\RecoveryVaultGenerationLedger;
use Illuminate\Contracts\Console\Kernel;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;

if (getenv('PB3_ISOLATED_STORAGE_SMOKE') !== '1'
    || getenv('APP_ENV') !== 'testing'
    || getenv('DB_CONNECTION') !== 'pgsql'
    || getenv('DB_HOST') !== '127.0.0.1'
    || getenv('DB_DATABASE') !== 'pb3_ci_p0'
    || getenv('S3_ENDPOINT') !== 'http://127.0.0.1:3900'
    || getenv('S3_BUCKET') !== 'pb3-ci-p0') {
    throw new RuntimeException('vault.race_non_disposable_refused');
}
require dirname(__DIR__, 2).'/vendor/autoload.php';
$app = require dirname(__DIR__, 2).'/bootstrap/app.php';
$app->make(Kernel::class)->bootstrap();
if (config('database.default') !== 'pgsql'
    || config('app.env') !== 'testing'
    || DB::connection()->getDriverName() !== 'pgsql'
    || !DB::getSchemaBuilder()->hasTable('backup_generations_v1')) {
    throw new RuntimeException('vault.race_non_pg18_refused');
}
$version = (string) DB::selectOne('SHOW server_version')->server_version;
if (!str_starts_with($version, '18.')) {
    throw new RuntimeException('vault.race_requires_pg18');
}

/** Synthetic test-only identifiers, never user-generated source data. */
function raceAssert(bool $condition, string $reason): void
{
    if (!$condition) throw new RuntimeException('vault.race_failed: '.$reason);
}
function raceSignal(string $dir, string $name, string $content): void
{
    if (file_put_contents($dir.'/'.$name, $content, LOCK_EX) === false) {
        throw new RuntimeException('vault.race_signal_failed');
    }
}
function raceWait(string $path, int $seconds = 12): void
{
    $until = microtime(true) + $seconds;
    while (!is_file($path) && microtime(true) < $until) {
        usleep(40000);
    }
    raceAssert(is_file($path), 'timed out waiting for '.basename($path));
}

if (($argv[1] ?? null) === 'worker') {
    try {
        // NOTE: parent passes only synthetic IDs and a private /tmp directory.
        [$script, $mode, $role, $account, $operation, $lease, $generation,
            $sha, $byteCount, $dir] = $argv;
        raceAssert($mode === 'worker' && in_array($role, ['A', 'B'], true),
            'invalid worker');
        $vault = app(RecoveryVaultGenerationLedger::class);
        $backend = (int) DB::selectOne('SELECT pg_backend_pid() AS pid')->pid;
        raceAssert($backend > 0, 'missing real independent PostgreSQL session');
        raceSignal($dir, $role.'.pid', (string) $backend);
        if ($role === 'A') {
            DB::transaction(static function () use (
                $dir, $account, $operation, $lease, $generation, $sha,
                $byteCount, $vault
            ): void {
                // This outer TX intentionally keeps its account lock while
                // B enters the normal stageTrusted implementation.
                $row = DB::table('identity_accounts')->where('id', $account)
                    ->lockForUpdate()->first();
                raceAssert($row !== null, 'account row lock not acquired');
                raceSignal($dir, 'A.locked', 'true');
                raceWait($dir.'/release-A');
                $vault->stageTrusted(
                    $account, $operation, $lease, $generation, $sha, (int) $byteCount);
            });
            raceSignal($dir, 'A.result', 'created');
        } else {
            try {
                $vault->stageTrusted(
                    $account, $operation, $lease, $generation, $sha, (int) $byteCount);
            } catch (RuntimeException $e) {
                raceAssert($e->getMessage() === 'vault.stage_in_progress',
                    'unexpected concurrent outcome '.$e->getMessage());
                raceSignal($dir, 'B.result', 'rejected');
                exit(0);
            }
            throw new RuntimeException('vault.unsafe_double_stage');
        }
        exit(0);
    } catch (Throwable $e) {
        fwrite(STDERR, $e->getMessage()."\n");
        exit(61);
    }
}

/** Start one REAL OS subprocess with its own PDO connection. */
function raceSpawn(
    string $role, string $account, string $operation, string $lease,
    string $generation, string $sha, string $dir
): mixed {
    $args = [
        PHP_BINARY, __FILE__, 'worker', $role, $account, $operation, $lease,
        $generation, $sha, '512', $dir,
    ];
    $out = [
        0 => ['file', '/dev/null', 'r'],
        1 => ['file', $dir.'/'.$role.'.out', 'w'],
        2 => ['file', $dir.'/'.$role.'.err', 'w'],
    ];
    $proc = proc_open($args, $out, $pipes, dirname(__DIR__, 2));
    raceAssert(is_resource($proc), 'failed to spawn '. $role);
    return $proc;
}
/** Fail closed on stuck child rather than letting CI hang indefinitely. */
function raceReap(mixed $proc, string $role, string $dir): void
{
    if (!is_resource($proc)) return;
    $deadline = microtime(true) + 16;
    $status = proc_get_status($proc);
    while ($status['running'] && microtime(true) < $deadline) {
        usleep(50000);
        $status = proc_get_status($proc);
    }
    if ($status['running']) {
        proc_terminate($proc);
        proc_close($proc);
        throw new RuntimeException('vault.race_worker_timeout_'.$role);
    }
    $exitCode = (int) $status['exitcode'];
    $closeCode = proc_close($proc);
    if ($exitCode === -1) $exitCode = $closeCode;
    raceAssert($exitCode === 0, $role.' worker exited '.$exitCode.'; '
        .(string) @file_get_contents($dir.'/'.$role.'.err'));
}
function raceCleanDir(string $dir): void
{
    if (!is_dir($dir)) return;
    foreach (scandir($dir) ?: [] as $name) {
        if ($name === '.' || $name === '..') continue;
        // Exact synthetic temporary directory, never a user-provided path.
        if (is_file($dir.'/'.$name)) unlink($dir.'/'.$name);
    }
    rmdir($dir);
}
$account = (string) Str::uuid();
$operation = (string) Str::uuid();
$lease = (string) Str::uuid();
$aGeneration = (string) Str::uuid();
$bGeneration = (string) Str::uuid();
$sha = hash('sha256', random_bytes(512));
$dir = sys_get_temp_dir().'/pb3-vault-218-race-'.bin2hex(random_bytes(12));
raceAssert(mkdir($dir, 0700), 'could not create isolated IPC directory');
DB::table('identity_accounts')->insert([
    'id' => $account, 'operation_id' => (string) Str::uuid(),
    'prepare_hash' => str_repeat('e', 64), 'status' => 'ready',
    'reserved_until' => now()->addDay(), 'created_at' => now(),
    'updated_at' => now(),
]);
DB::table('backup_start_operations_v1')->insert([
    'operation_id' => $operation, 'account_id' => $account,
    'lease_id' => $lease, 'state' => 'started', 'reserved_at' => now(),
    'accepted_at' => now(), 'lease_expires_at' => now()->addMinutes(15),
    'finished_at' => null,
]);
$workerA = null;
$workerB = null;
try {
    $workerA = raceSpawn('A', $account, $operation, $lease, $aGeneration, $sha, $dir);
    raceWait($dir.'/A.locked');
    $aPid = (int) file_get_contents($dir.'/A.pid');
    $workerB = raceSpawn('B', $account, $operation, $lease, $bGeneration, $sha, $dir);
    raceWait($dir.'/B.pid');
    $bPid = (int) file_get_contents($dir.'/B.pid');
    raceAssert($aPid > 0 && $bPid > 0 && $aPid !== $bPid,
        'two processes did not establish independent PG backends');

    $observed = false;
    $until = microtime(true) + 10;
    while (microtime(true) < $until) {
        $waiting = DB::selectOne(
            'SELECT wait_event_type, wait_event FROM pg_stat_activity WHERE pid = ?',
            [$bPid]);
        if ($waiting && $waiting->wait_event_type === 'Lock') {
            $observed = true;
            break;
        }
        usleep(60000);
    }
    raceAssert($observed, 'real PostgreSQL row-lock wait was not observed');
    raceAssert(!is_file($dir.'/B.result'),
        'B completed without waiting for the account lock');
    raceSignal($dir, 'release-A', 'true');
    raceReap($workerA, 'A', $dir);
    $workerA = null;
    raceReap($workerB, 'B', $dir);
    $workerB = null;
    raceAssert(trim((string) file_get_contents($dir.'/A.result')) === 'created',
        'A did not create the one staged generation');
    raceAssert(trim((string) file_get_contents($dir.'/B.result')) === 'rejected',
        'B did not reject its competing stage');
    raceAssert(
        DB::table('backup_generations_v1')->where('account_id', $account)
            ->where('state', 'staged')->count() === 1,
        'more than one stage was committed');
    raceAssert(
        DB::table('backup_generations_v1')->where('account_id', $account)
            ->where('id', $aGeneration)->where('state', 'staged')->exists(),
        'lock winner did not persist');
    raceAssert(
        !DB::table('backup_generations_v1')->where('account_id', $account)
            ->where('id', $bGeneration)->exists(),
        'losing request inserted a stage');
    raceAssert(
        !DB::table('backup_generation_heads_v1')->where('account_id', $account)
            ->exists(),
        'unverified staging was incorrectly marked active');
    fwrite(STDOUT,
        "P3 #218 TWO-PROCESS PG18: observed Lock wait; exactly one ".
        "stage committed, competing stage rejected, no false verified head PASS\n");
} finally {
    // Always release a waiting synthetic process before any cleanup.
    if (is_dir($dir)) raceSignal($dir, 'release-A', 'true');
    foreach (['A' => $workerA, 'B' => $workerB] as $role => $process) {
        if (is_resource($process)) {
            try { raceReap($process, $role, $dir); }
            catch (Throwable $ignored) { /* original failure remains loud */ }
        }
    }
    raceCleanDir($dir);
}
