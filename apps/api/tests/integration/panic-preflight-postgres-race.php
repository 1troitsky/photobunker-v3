<?php
declare(strict_types=1);

/**
 * P3 #221: REAL independent PHP processes and PostgreSQL 18 locks for the
 * server's INERT Panic prepared-intent ledger. NO network API, no revoke, no
 * object deletion, no Matrix operation, no local key wipe and no ACK.
 *
 * Absolute guard: may ONLY operate against its own fresh disposable GitHub
 * Actions PostgreSQL service with a uniquely named synthetic CI database.
 */
use App\Identity\Protocol;
use App\Panic\PreparedIntentLedger;
use Illuminate\Contracts\Console\Kernel;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;

function requiredIsolation(): void
{
    $required = [
        'GITHUB_ACTIONS' => 'true',
        'PB3_PANIC_ISOLATED_PG_QA' => '1',
        'APP_ENV' => 'testing',
        'DB_CONNECTION' => 'pgsql',
        'DB_HOST' => '127.0.0.1',
        'DB_DATABASE' => 'pb3_panic_221_ci',
        'DB_USERNAME' => 'pb3_panic_ci',
    ];
    foreach ($required as $name => $value) {
        if (getenv($name) !== $value) {
            throw new RuntimeException('P3 Panic PG race REFUSED outside isolated CI: '.$name);
        }
    }
    if (!extension_loaded('pdo_pgsql')) {
        throw new RuntimeException('P3 Panic PG race requires pdo_pgsql');
    }
}

requiredIsolation();
require dirname(__DIR__, 2).'/vendor/autoload.php';
$app = require dirname(__DIR__, 2).'/bootstrap/app.php';
$app->make(Kernel::class)->bootstrap();

if (config('app.env') !== 'testing'
    || config('database.default') !== 'pgsql'
    || config('database.connections.pgsql.database') !== 'pb3_panic_221_ci'
    || config('database.connections.pgsql.host') !== '127.0.0.1'
    || !DB::getSchemaBuilder()->hasTable('identity_accounts')
    || !DB::getSchemaBuilder()->hasTable('identity_devices')
    || !DB::getSchemaBuilder()->hasTable('panic_preflight_intents_v1')) {
    throw new RuntimeException('P3 Panic PG race refused unmigrated/non-disposable database');
}

function must(bool $condition, string $message): void
{
    if (!$condition) {
        throw new RuntimeException('P3 Panic PG race FAIL: '.$message);
    }
}

function waitFile(string $path, int $timeoutMs = 25000): void
{
    $started = microtime(true);
    while (!is_file($path)) {
        if ((microtime(true) - $started) * 1000 > $timeoutMs) {
            throw new RuntimeException('P3 Panic PG race timed out waiting for '.basename($path));
        }
        usleep(25000);
    }
}

function signP1363(string $message, mixed $key): string
{
    must(openssl_sign($message, $der, $key, OPENSSL_ALGO_SHA256), 'OpenSSL sign');
    must(ord($der[0]) === 0x30, 'OpenSSL ECDSA DER SEQUENCE');
    $index = 2;
    $readInteger = static function () use ($der, &$index): string {
        if (ord($der[$index++]) !== 2) {
            throw new RuntimeException('Invalid DER integer');
        }
        $length = ord($der[$index++]);
        $integer = substr($der, $index, $length);
        $index += $length;
        must(strlen($integer) >= 1 && strlen($integer) <= 33, 'ECDSA integer length');
        $integer = ltrim($integer, "\x00");
        must(strlen($integer) <= 32, 'P-256 integer exceeds 32 bytes');
        return str_pad($integer, 32, "\x00", STR_PAD_LEFT);
    };
    return Protocol::encode($readInteger().$readInteger());
}

/** Synthetic, server-trusted ready identity with a REAL P-256 signing SPKI. */
function seedIdentity(): array
{
    $key = openssl_pkey_new([
        'private_key_type' => OPENSSL_KEYTYPE_EC,
        'curve_name' => 'prime256v1',
    ]);
    must($key !== false, 'allocate synthetic P-256 key');
    $details = openssl_pkey_get_details($key);
    must(is_array($details), 'inspect synthetic public key');
    $pem = preg_replace('/-----[^-]+-----|\s+/', '', $details['key']);
    must(is_string($pem), 'public key PEM');
    $raw = base64_decode($pem, true);
    must($raw !== false, 'public key SPKI DER');

    $accountId = (string) Str::uuid();
    $deviceId = (string) Str::uuid();
    $now = now();
    DB::table('identity_accounts')->insert([
        'id' => $accountId,
        'operation_id' => (string) Str::uuid(),
        'prepare_hash' => str_repeat('a', 64),
        'status' => 'ready',
        'revision' => 1,
        'reserved_until' => $now->copy()->addHour(),
        'created_at' => $now,
        'updated_at' => $now,
    ]);
    DB::table('identity_devices')->insert([
        'id' => $deviceId,
        'account_id' => $accountId,
        'signing_spki' => Protocol::encode($raw),
        'revoked_at' => null,
        'created_at' => $now,
        'updated_at' => $now,
    ]);

    return ['accountId' => $accountId, 'deviceId' => $deviceId, 'key' => $key];
}

function signedWire(array $identity, ?string $operationId = null): array
{
    $payload = [
        'version' => 1,
        'purpose' => 'panic.live-delete',
        'operationId' => $operationId ?? (string) Str::uuid(),
        'accountId' => $identity['accountId'],
        'deviceId' => $identity['deviceId'],
        'keyRevision' => 1,
        'nonce' => Protocol::encode(random_bytes(32)),
        'issuedAt' => gmdate('Y-m-d\TH:i:s').'.000Z',
        'liveScope' => 'all-live-locations',
        'vault' => 'preserve-existing-verified',
    ];
    ksort($payload, SORT_STRING);
    $contract = json_encode($payload, JSON_UNESCAPED_SLASHES | JSON_THROW_ON_ERROR);
    return [
        'contract' => $contract,
        'signature' => signP1363("photobunker.panic.intent.v1\n".$contract, $identity['key']),
    ];
}

/** A child always connects to Postgres independently (new PHP OS process). */
function runWorker(array $args): never
{
    // worker, owner|challenger, jsonFixture, ownerReady, challengerReady, result
    must(count($args) === 6, 'invalid worker CLI argument count');
    [$kind, $role, $fixturePath, $ownerReady, $challengerReady, $output] = $args;
    must($kind === 'worker' && in_array($role, ['owner', 'challenger'], true),
        'invalid race worker role');
    $fixture = json_decode((string) file_get_contents($fixturePath), true, 16, JSON_THROW_ON_ERROR);
    must(is_array($fixture) && isset($fixture['wire'], $fixture['accountId'], $fixture['deviceId']),
        'invalid CI-only worker fixture');

    $pgBackend = (int) DB::selectOne('SELECT pg_backend_pid() AS pid')->pid;
    $start = microtime(true);
    $result = ['outcome' => 'unknown'];
    try {
        $ledger = app(PreparedIntentLedger::class);
        if ($role === 'owner') {
            // Outer transaction holds the account-row lock (same-device
            // cases) or the GLOBAL operationId unique-index insertion (cross-
            // account case) UNCOMMITTED until the contender is actually
            // waiting in Postgres. This is a real DB race, not a sleep-only
            // approximation of simultaneous independent calls.
            DB::transaction(function () use (
                $fixture, $ledger, $ownerReady, $challengerReady, &$result, $pgBackend
            ): void {
                if (($fixture['lockAccountFirst'] ?? false) === true) {
                    $account = DB::table('identity_accounts')
                        ->where('id', $fixture['accountId'])
                        ->lockForUpdate()->first();
                    must($account !== null, 'owner acquired account lock');
                }
                $accepted = $ledger->prepare(
                    $fixture['wire'], $fixture['accountId'], $fixture['deviceId'],
                );
                $result = ['outcome' => 'prepared', 'replay' => $accepted['replay'],
                    'phase' => $accepted['phase']];
                file_put_contents($ownerReady, (string) $pgBackend);
                waitFile($challengerReady);
                // Real PostgreSQL conflict is independently observed via
                // pg_stat_activity(wait_event_type='Lock') by the parent.
                usleep(1800000);
            }, 1);
        } else {
            file_put_contents($challengerReady, (string) $pgBackend);
            $accepted = $ledger->prepare(
                $fixture['wire'], $fixture['accountId'], $fixture['deviceId'],
            );
            $result = ['outcome' => 'prepared', 'replay' => $accepted['replay'],
                'phase' => $accepted['phase']];
        }
    } catch (DomainException $error) {
        $result = ['outcome' => 'denied', 'reason' => $error->getMessage()];
    } catch (Throwable $fatal) {
        $result = ['outcome' => 'unexpected_error', 'type' => get_class($fatal),
            'reason' => $fatal->getMessage()];
    }
    $result['elapsedMs'] = (int) round((microtime(true) - $start) * 1000);
    $result['pgBackend'] = $pgBackend;
    $result['osPid'] = getmypid();
    file_put_contents($output, json_encode($result, JSON_THROW_ON_ERROR));
    exit($result['outcome'] === 'unexpected_error' ? 2 : 0);
}

function spawnWorker(
    string $role, string $fixtureFile, string $ownerReady,
    string $challengerReady, string $outputFile, string $logFile,
): mixed {
    $command = [
        PHP_BINARY, __FILE__, 'worker', $role, $fixtureFile, $ownerReady,
        $challengerReady, $outputFile,
    ];
    $process = proc_open($command, [
        0 => ['pipe', 'r'],
        1 => ['file', $logFile.'.stdout', 'w'],
        2 => ['file', $logFile.'.stderr', 'w'],
    ], $pipes, dirname(__DIR__, 2), null, ['bypass_shell' => true]);
    must(is_resource($process), 'launch real PHP OS worker');
    fclose($pipes[0]);
    return $process;
}

function awaitRealPgLock(int $contenderBackend, int $timeoutMs = 1400): bool
{
    $started = microtime(true);
    while ((microtime(true) - $started) * 1000 < $timeoutMs) {
        $activity = DB::selectOne(
            'SELECT wait_event_type, wait_event FROM pg_stat_activity WHERE pid = ?',
            [$contenderBackend],
        );
        if ($activity !== null && $activity->wait_event_type === 'Lock') {
            return true;
        }
        usleep(30000);
    }
    return false;
}

/**
 * @return array{owner:array,challenger:array}
 * Both workers are independent PHP OS processes / unique PG backends, with
 * a confirmed real PostgreSQL lock wait, committed persistent record and a
 * deterministic owner-first winner.
 */
function race(
    string $label, array $ownerFixture, array $challengerFixture,
    string $expectedChallenger, ?string $expectedDenial = null,
): array {
    $dir = sys_get_temp_dir().'/pb3-panic-pg-221-'.bin2hex(random_bytes(8));
    must(mkdir($dir, 0700), 'allocate private temporary CI fixture directory');
    $ownerFixtureFile = $dir.'/owner-input.json';
    $challengerFixtureFile = $dir.'/challenger-input.json';
    $ownerReady = $dir.'/owner.ready';
    $challengerReady = $dir.'/challenger.ready';
    $ownerOutput = $dir.'/owner-result.json';
    $challengerOutput = $dir.'/challenger-result.json';
    file_put_contents($ownerFixtureFile, json_encode($ownerFixture, JSON_THROW_ON_ERROR));
    file_put_contents($challengerFixtureFile, json_encode($challengerFixture, JSON_THROW_ON_ERROR));

    $owner = null;
    $challenger = null;
    try {
        $owner = spawnWorker('owner', $ownerFixtureFile, $ownerReady,
            $challengerReady, $ownerOutput, $dir.'/owner');
        waitFile($ownerReady);
        $challenger = spawnWorker('challenger', $challengerFixtureFile, $ownerReady,
            $challengerReady, $challengerOutput, $dir.'/challenger');
        waitFile($challengerReady);
        $challengerPid = (int) file_get_contents($challengerReady);
        $observedDbLock = awaitRealPgLock($challengerPid);
        waitFile($ownerOutput);
        waitFile($challengerOutput);
        $ownerExit = proc_close($owner);
        $owner = null;
        $challengerExit = proc_close($challenger);
        $challenger = null;

        $first = json_decode((string) file_get_contents($ownerOutput), true, 16, JSON_THROW_ON_ERROR);
        $second = json_decode((string) file_get_contents($challengerOutput), true, 16, JSON_THROW_ON_ERROR);
        must($ownerExit === 0 && $challengerExit === 0,
            $label.' worker exit non-zero: '.json_encode([$first, $second]));
        must($observedDbLock,
            $label.' did not prove a genuine pg_stat_activity PostgreSQL Lock wait');
        must($first['pgBackend'] !== $second['pgBackend']
            && $first['osPid'] !== $second['osPid'],
            $label.' did not use independent PHP processes / PostgreSQL backends');
        must($first['outcome'] === 'prepared' && $first['phase'] === 'preflight_only'
            && $first['replay'] === false, $label.' owner must prepare first');
        must($second['outcome'] === $expectedChallenger,
            $label.' contender wrong outcome '.json_encode($second));
        if ($expectedChallenger === 'prepared') {
            must(($second['replay'] ?? null) === true
                && ($second['phase'] ?? null) === 'preflight_only',
                $label.' byte-identical replay must be inert/idempotent');
        } else {
            must(($second['reason'] ?? null) === $expectedDenial,
                $label.' wrong fail-closed collision result');
        }
        must($second['elapsedMs'] >= 350,
            $label.' contender did not exhibit the observed account/index lock wait');
        return ['owner' => $first, 'challenger' => $second];
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
    runWorker(array_slice($argv, 1));
}
must(count($argv) === 1, 'unexpected PG race harness CLI arguments');

$original = seedIdentity();
$originalWire = signedWire($original);
race(
    'exact-replay',
    ['accountId' => $original['accountId'], 'deviceId' => $original['deviceId'],
        'wire' => $originalWire, 'lockAccountFirst' => true],
    ['accountId' => $original['accountId'], 'deviceId' => $original['deviceId'],
        'wire' => $originalWire],
    'prepared',
);
$originalOp = json_decode($originalWire['contract'], true, 16, JSON_THROW_ON_ERROR)['operationId'];
must(DB::table('panic_preflight_intents_v1')->where('device_id', $original['deviceId'])->count() === 1,
    'same operation exact retry must persist ONE row');
must(DB::table('panic_preflight_intents_v1')->where('operation_id', $originalOp)
    ->value('contract_json') === $originalWire['contract'],
    'retry must preserve original canonical signed bytes');
fwrite(STDOUT, "P3 #221 PG18 EXACT REPLAY PASS: two PHP processes, real row-lock wait, one immutable preflight_only row\n");

$conflicting = seedIdentity();
$conflictOne = signedWire($conflicting);
$conflictTwo = signedWire($conflicting);
race(
    'same-device-conflict',
    ['accountId' => $conflicting['accountId'], 'deviceId' => $conflicting['deviceId'],
        'wire' => $conflictOne, 'lockAccountFirst' => true],
    ['accountId' => $conflicting['accountId'], 'deviceId' => $conflicting['deviceId'],
        'wire' => $conflictTwo],
    'denied', 'panic.preflight_conflict',
);
must(DB::table('panic_preflight_intents_v1')->where('device_id', $conflicting['deviceId'])->count() === 1,
    'two different valid commands may not overwrite first same-device row');
must(DB::table('panic_preflight_intents_v1')->where('device_id', $conflicting['deviceId'])
    ->value('contract_json') === $conflictOne['contract'],
    'second signed command must not overwrite original device bytes');
fwrite(STDOUT, "P3 #221 PG18 SAME-DEVICE CONFLICT PASS: distinct signed commands, lock wait and original immutable row\n");

$accountA = seedIdentity();
$accountB = seedIdentity();
$globalOperationId = (string) Str::uuid();
$globalOne = signedWire($accountA, $globalOperationId);
$globalTwo = signedWire($accountB, $globalOperationId);
race(
    'global-op-id-conflict',
    ['accountId' => $accountA['accountId'], 'deviceId' => $accountA['deviceId'],
        'wire' => $globalOne, 'lockAccountFirst' => false],
    ['accountId' => $accountB['accountId'], 'deviceId' => $accountB['deviceId'],
        'wire' => $globalTwo],
    'denied', 'panic.preflight_conflict',
);
must(DB::table('panic_preflight_intents_v1')->where('operation_id', $globalOperationId)->count() === 1,
    'global same-operationId cross-account collision must persist one row');
must(DB::table('panic_preflight_intents_v1')->where('operation_id', $globalOperationId)
    ->value('account_id') === $accountA['accountId'],
    'global operationId must remain bound to original account');
must(DB::table('panic_preflight_intents_v1')->where('account_id', $accountB['accountId'])->count() === 0,
    'other account must not silently adopt the original operation');
fwrite(STDOUT, "P3 #221 PG18 CROSS-ACCOUNT GLOBAL OP-ID PASS: actual unique-index lock wait and no adoption\n");

DB::table('identity_devices')->where('id', $original['deviceId'])
    ->update(['revoked_at' => now()]);
try {
    app(PreparedIntentLedger::class)->prepare($originalWire, $original['accountId'], $original['deviceId']);
    throw new RuntimeException('revoked replay unexpectedly accepted');
} catch (DomainException $exception) {
    must($exception->getMessage() === 'panic.device_unavailable',
        'revoked device must fail closed BEFORE exact replay');
}
must(DB::table('panic_preflight_intents_v1')->where('device_id', $original['deviceId'])->count() === 1,
    'revoked replay must neither remove nor change existing non-destructive ledger');
fwrite(STDOUT, "P3 #221 PG18 REVOKED DEVICE REPLAY PASS: current device authority required\n");

DB::table('identity_accounts')->where('id', $conflicting['accountId'])
    ->update(['revision' => 2]);
try {
    app(PreparedIntentLedger::class)->prepare(
        $conflictOne, $conflicting['accountId'], $conflicting['deviceId'],
    );
    throw new RuntimeException('stale key-revision replay unexpectedly accepted');
} catch (DomainException $exception) {
    must($exception->getMessage() === 'panic.invalid_intent',
        'old signed request must fail after account key revision');
}
must(DB::table('panic_preflight_intents_v1')->where('device_id', $conflicting['deviceId'])->count() === 1,
    'key revision rejection must preserve original preflight journal record');
fwrite(STDOUT, "P3 #221 PG18 KEY REVISION REPLAY PASS: signed stale revision rejected\n");

must(DB::table('panic_preflight_intents_v1')->count() === 3,
    'exactly three synthetic preflight_only records expected after all races');
must(DB::table('panic_preflight_intents_v1')
    ->where('phase', '!=', 'preflight_only')->count() === 0,
    'no authorized, executing, acknowledged or deletion phase may be created');
fwrite(STDOUT, "P3 #221 PG18 COMPLETE: 3/3 genuine two-process lock races + revoked/revision negatives, 3 inert rows, zero deletion\n");
