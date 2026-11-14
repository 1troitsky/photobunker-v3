<?php
declare(strict_types=1);

/**
 * P3 #222. REAL two independent PHP OS processes + PostgreSQL18 row/index
 * contention against SignedDeferredCommand::register() itself.
 *
 * HARD SAFETY GATE: exclusively a fresh disposable CI-only PG instance.
 * Never use production, staging, a developer database, S3 or Matrix.
 */
use App\Identity\Protocol;
use App\RemoteWipe\SignedDeferredCommand;
use Illuminate\Contracts\Console\Kernel;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;
use Symfony\Component\HttpKernel\Exception\HttpExceptionInterface;

function race222Must(bool $ok, string $why): void
{
    if (!$ok) {
        // Laravel's registered exception handler can log an uncaught CLI
        // exception without a nonzero process status. Always force a
        // nonzero OS exit; a logged FAIL can NEVER become a CI PASS.
        fwrite(STDERR, "Remote Wipe #222 PG18 RACE FAIL: {$why}\n");
        exit(1);
    }
}
function race222Guard(): void
{
    foreach ([
        'GITHUB_ACTIONS' => 'true',
        'PB3_REMOTE_WIPE_PG_RACE' => '1',
        'APP_ENV' => 'testing',
        'DB_CONNECTION' => 'pgsql',
        'DB_HOST' => '127.0.0.1',
        'DB_DATABASE' => 'pb3_remote_222_ci',
        'DB_USERNAME' => 'pb3_remote_ci',
    ] as $key => $expected) {
        race222Must(getenv($key) === $expected, 'REFUSED non-disposable context '.$key);
    }
    race222Must(extension_loaded('pdo_pgsql'), 'pdo_pgsql required');
}
race222Guard();
require dirname(__DIR__, 2).'/vendor/autoload.php';
$app = require dirname(__DIR__, 2).'/bootstrap/app.php';
$app->make(Kernel::class)->bootstrap();
race222Must(
    config('app.env') === 'testing'
    && config('database.default') === 'pgsql'
    && config('database.connections.pgsql.database') === 'pb3_remote_222_ci'
    && config('database.connections.pgsql.host') === '127.0.0.1'
    && DB::getSchemaBuilder()->hasTable('remote_wipe_commands')
    && DB::getSchemaBuilder()->hasTable('identity_devices'),
    'REFUSED unmigrated/non-disposable database'
);

function race222Wait(string $file, int $timeoutMs = 16000): void
{
    $start = microtime(true);
    while (!is_file($file)) {
        race222Must((microtime(true) - $start) * 1000 <= $timeoutMs,
            'timeout waiting for '.basename($file));
        usleep(25000);
    }
}
function race222Pair(): array
{
    $private = openssl_pkey_new(['private_key_type' => OPENSSL_KEYTYPE_EC, 'curve_name' => 'prime256v1']);
    race222Must($private !== false, 'synthetic EC key generation');
    $detail = openssl_pkey_get_details($private);
    race222Must(is_array($detail), 'synthetic EC public info');
    $pem = preg_replace('/-----[^-]+-----|\s+/', '', $detail['key']);
    $der = base64_decode($pem, true);
    race222Must(is_string($der), 'P-256 SPKI DER');
    return ['private' => $private, 'spki' => Protocol::encode($der)];
}
function race222Sign(string $message, mixed $private): string
{
    race222Must(openssl_sign($message, $der, $private, OPENSSL_ALGO_SHA256), 'P256 signature');
    race222Must(ord($der[0]) === 0x30, 'P256 DER tag');
    $offset = 2;
    $parse = static function () use (&$offset, $der): string {
        race222Must(ord($der[$offset++]) === 2, 'P256 DER integer');
        $size = ord($der[$offset++]);
        $scalar = substr($der, $offset, $size);
        $offset += $size;
        $scalar = ltrim($scalar, "\x00");
        race222Must(strlen($scalar) <= 32, 'P256 scalar size');
        return str_pad($scalar, 32, "\x00", STR_PAD_LEFT);
    };
    return Protocol::encode($parse().$parse());
}
function race222Account(): array
{
    $accountId = (string) Str::uuid();
    $actorId = (string) Str::uuid();
    $targetId = (string) Str::uuid();
    $root = race222Pair();
    $actor = race222Pair();
    $target = race222Pair();
    $now = now();

    DB::table('identity_accounts')->insert([
        'id' => $accountId,
        'operation_id' => (string) Str::uuid(),
        'prepare_hash' => str_repeat('d', 64),
        'status' => 'ready',
        'account_spki' => $root['spki'],
        'revision' => 1,
        'reserved_until' => $now->copy()->addHour(),
        'created_at' => $now,
        'updated_at' => $now,
    ]);
    foreach ([
        [$actorId, $actor['spki'], null],
        [$targetId, $target['spki'], $now->copy()->subMinute()],
    ] as [$deviceId, $pub, $revoked]) {
        DB::table('identity_devices')->insert([
            'id' => $deviceId,
            'account_id' => $accountId,
            'signing_spki' => $pub,
            'revoked_at' => $revoked,
            'created_at' => $now,
            'updated_at' => $now,
        ]);
    }
    return compact('accountId', 'actorId', 'targetId', 'root', 'actor', 'target');
}
function race222Wire(array $identity, ?string $operationId = null): array
{
    $payload = [
        'version' => 1,
        'operationId' => $operationId ?? (string) Str::uuid(),
        'accountId' => $identity['accountId'],
        'actorDeviceId' => $identity['actorId'],
        'targetDeviceId' => $identity['targetId'],
        'accountRevision' => 1,
        'scope' => 'device-local-only',
    ];
    $message = SignedDeferredCommand::commandMessage($payload);
    return [
        'accountId' => $identity['accountId'],
        'actorId' => $identity['actorId'],
        'payload' => $payload,
        'accountSignature' => race222Sign($message, $identity['root']['private']),
        'actorSignature' => race222Sign($message, $identity['actor']['private']),
    ];
}
function race222Invoke(array $wire): array
{
    return app(SignedDeferredCommand::class)->register(
        $wire['accountId'], $wire['actorId'], $wire['payload'],
        $wire['accountSignature'], $wire['actorSignature']
    );
}

/** Worker is genuinely forked into a new PHP process + PG connection. */
function race222Worker(array $args): never
{
    race222Must(count($args) === 6, 'worker arg count');
    [$mode, $role, $fixtureFile, $ownerReady, $challengerReady, $resultFile] = $args;
    race222Must($mode === 'worker' && in_array($role, ['owner', 'challenger'], true),
        'worker role');
    $wire = json_decode((string) file_get_contents($fixtureFile), true, 16, JSON_THROW_ON_ERROR);
    $backend = (int) DB::selectOne('SELECT pg_backend_pid() AS pid')->pid;
    $begin = microtime(true);
    try {
        if ($role === 'owner') {
            $status = DB::transaction(function () use ($wire, $ownerReady, $challengerReady, $backend): array {
                // Nested service transaction uses the EXACT production locking
                // order; keep the outer transaction open after registering.
                $status = race222Invoke($wire);
                file_put_contents($ownerReady, (string) $backend, LOCK_EX);
                race222Wait($challengerReady);
                usleep(1900000);
                return $status;
            }, 1);
        } else {
            file_put_contents($challengerReady, (string) $backend, LOCK_EX);
            $status = race222Invoke($wire);
        }
        $answer = [
            'outcome' => 'accepted',
            'unchanged' => $status['unchanged'],
            'status' => $status['localWipeStatus'],
            'cloudDeleted' => $status['cloudDeleted'],
            'matrixRemoteRevoked' => $status['matrixRemoteRevoked'],
        ];
    } catch (HttpExceptionInterface $e) {
        $answer = ['outcome' => 'denied', 'httpStatus' => $e->getStatusCode()];
    } catch (Throwable $e) {
        $answer = [
            'outcome' => 'UNEXPECTED',
            'type' => get_class($e),
            'reason' => substr($e->getMessage(), 0, 240),
        ];
    }
    $answer['osPid'] = getmypid();
    $answer['pgBackend'] = $backend;
    $answer['elapsedMs'] = (int) round((microtime(true) - $begin) * 1000);
    file_put_contents($resultFile, json_encode($answer, JSON_THROW_ON_ERROR), LOCK_EX);
    exit($answer['outcome'] === 'UNEXPECTED' ? 2 : 0);
}
function race222Spawn(string $role, string $fixture, string $ownerReady,
    string $challengerReady, string $output, string $logPrefix): mixed
{
    $command = [
        PHP_BINARY, __FILE__, 'worker', $role, $fixture,
        $ownerReady, $challengerReady, $output,
    ];
    $process = proc_open($command, [
        0 => ['pipe', 'r'],
        1 => ['file', $logPrefix.'.stdout', 'w'],
        2 => ['file', $logPrefix.'.stderr', 'w'],
    ], $pipes, dirname(__DIR__, 2), null, ['bypass_shell' => true]);
    race222Must(is_resource($process), 'proc_open failed');
    fclose($pipes[0]);
    return $process;
}
function race222ObserveLock(int $pid, int $timeoutMs = 1500): bool
{
    $start = microtime(true);
    while ((microtime(true) - $start) * 1000 < $timeoutMs) {
        $row = DB::selectOne(
            'SELECT wait_event_type FROM pg_stat_activity WHERE pid = ?', [$pid]
        );
        if ($row !== null && $row->wait_event_type === 'Lock') {
            return true;
        }
        usleep(30000);
    }
    return false;
}
function race222Run(string $label, array $first, array $second,
    string $challengerOutcome, ?int $denyStatus = null): void
{
    $dir = sys_get_temp_dir().'/pb3-remote-222-'.bin2hex(random_bytes(8));
    race222Must(mkdir($dir, 0700), 'private test fixture directory');
    $files = [
        'ownerIn' => $dir.'/owner.json',
        'otherIn' => $dir.'/other.json',
        'ownerReady' => $dir.'/owner.ready',
        'otherReady' => $dir.'/other.ready',
        'ownerOut' => $dir.'/owner.result',
        'otherOut' => $dir.'/other.result',
    ];
    file_put_contents($files['ownerIn'], json_encode($first, JSON_THROW_ON_ERROR));
    file_put_contents($files['otherIn'], json_encode($second, JSON_THROW_ON_ERROR));

    $owner = null;
    $challenger = null;
    try {
        $owner = race222Spawn('owner', $files['ownerIn'], $files['ownerReady'],
            $files['otherReady'], $files['ownerOut'], $dir.'/owner');
        race222Wait($files['ownerReady']);
        $challenger = race222Spawn('challenger', $files['otherIn'], $files['ownerReady'],
            $files['otherReady'], $files['otherOut'], $dir.'/challenger');
        race222Wait($files['otherReady']);
        $locked = race222ObserveLock((int) file_get_contents($files['otherReady']));
        race222Wait($files['ownerOut']);
        race222Wait($files['otherOut']);
        $ownerExit = proc_close($owner);
        $owner = null;
        $challengerExit = proc_close($challenger);
        $challenger = null;

        $a = json_decode((string) file_get_contents($files['ownerOut']), true, 16, JSON_THROW_ON_ERROR);
        $b = json_decode((string) file_get_contents($files['otherOut']), true, 16, JSON_THROW_ON_ERROR);
        race222Must($ownerExit === 0 && $challengerExit === 0,
            $label.' worker failed '.json_encode([$a, $b]));
        race222Must($locked, $label.' no REAL PostgreSQL pg_stat_activity Lock wait');
        race222Must($a['osPid'] !== $b['osPid'] && $a['pgBackend'] !== $b['pgBackend'],
            $label.' workers did not use separate PHP/PG processes');
        race222Must($a['outcome'] === 'accepted' && $a['unchanged'] === false
            && $a['status'] === 'wipe_pending' && $a['cloudDeleted'] === false,
            $label.' first signed command not safely accepted');
        race222Must($b['outcome'] === $challengerOutcome,
            $label.' wrong challenger outcome '.json_encode($b));
        if ($challengerOutcome === 'accepted') {
            race222Must($b['unchanged'] === true && $b['status'] === 'wipe_pending',
                $label.' exact retry must remain pending and unchanged');
        } else {
            race222Must(($b['httpStatus'] ?? null) === $denyStatus,
                $label.' expected fail-closed HTTP 409 '.json_encode($b));
        }
        race222Must($b['elapsedMs'] >= 400, $label.' contender did not actually wait');
        fwrite(STDOUT, "#222 PG18 {$label} PASS: real lock, two PHP processes, honest result\n");
    } finally {
        foreach ([$owner, $challenger] as $p) {
            if (is_resource($p)) {
                proc_terminate($p);
                proc_close($p);
            }
        }
        foreach (glob($dir.'/*') ?: [] as $file) {
            @unlink($file);
        }
        @rmdir($dir);
    }
}

if (($argv[1] ?? '') === 'worker') {
    race222Worker(array_slice($argv, 1));
}
race222Must(count($argv) === 1, 'unexpected CLI args');

$one = race222Account();
$same = race222Wire($one);
race222Run('EXACT-REPLAY', $same, $same, 'accepted');
race222Must(DB::table('remote_wipe_commands')->where('target_device_id', $one['targetId'])->count() === 1,
    'exact replay inserted more than one operation');

$two = race222Account();
$accepted = race222Wire($two);
$conflicting = race222Wire($two);
race222Run('SAME-TARGET-CONFLICT', $accepted, $conflicting, 'denied', 409);
race222Must(DB::table('remote_wipe_commands')->where('target_device_id', $two['targetId'])->count() === 1
    && DB::table('remote_wipe_commands')->where('operation_id', $accepted['payload']['operationId'])->exists()
    && !DB::table('remote_wipe_commands')->where('operation_id', $conflicting['payload']['operationId'])->exists(),
    'competing signed operation replaced original target command');

$a = race222Account();
$b = race222Account();
$globalOperation = (string) Str::uuid();
$first = race222Wire($a, $globalOperation);
$second = race222Wire($b, $globalOperation);
race222Run('CROSS-ACCOUNT-OP-ID', $first, $second, 'denied', 409);
race222Must(DB::table('remote_wipe_commands')->where('operation_id', $globalOperation)->count() === 1
    && DB::table('remote_wipe_commands')->where('operation_id', $globalOperation)
        ->value('account_id') === $a['accountId']
    && DB::table('remote_wipe_commands')->where('account_id', $b['accountId'])->count() === 0,
    'global opId collision adopted by unrelated account');

race222Must(DB::table('remote_wipe_commands')->count() === 3, 'only three inert commands should exist');
race222Must(DB::table('remote_wipe_commands')->whereNotNull('target_reported_at')->count() === 0,
    'test generated false local wipe receipt');
race222Must(DB::table('identity_devices')->whereIn('id',
    [$one['actorId'], $two['actorId'], $a['actorId'], $b['actorId']])
    ->whereNotNull('revoked_at')->count() === 0, 'actor device was unexpectedly revoked');
fwrite(STDOUT, "#222 PG18 COMPLETE: 3/3 proven two-process races, 3 pending commands, no live wipe\n");
