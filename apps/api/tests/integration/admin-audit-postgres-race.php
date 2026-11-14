<?php
declare(strict_types=1);

/**
 * #227: 3 actual concurrent PHP processes/PG18 transaction races for the
 * INERT AdminAuditLedger. NO admin actions, logins, grants, bans or revokes.
 *
 * Hard guard BEFORE Laravel boot: exclusively disposable GitHub CI PostgreSQL
 * service. No production/admin credential or network service is accessed.
 */
use App\Administration\AdminAuditLedger;
use App\Administration\AdminPrincipal;
use Illuminate\Contracts\Console\Kernel;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;

function must(bool $ok, string $description): void
{
    if (!$ok) {
        throw new RuntimeException('P3 #227 real PG race FAIL: '.$description);
    }
}

function isolate(): void
{
    $guard = [
        'GITHUB_ACTIONS' => 'true',
        'PB3_ADMIN_227_PG_RACE' => '1',
        'APP_ENV' => 'testing',
        'DB_CONNECTION' => 'pgsql',
        'DB_HOST' => '127.0.0.1',
        'DB_DATABASE' => 'pb3_admin_audit_227_ci',
        'DB_USERNAME' => 'pb3_admin_ci',
    ];
    foreach ($guard as $name => $value) {
        must(getenv($name) === $value, 'REFUSED outside disposable CI: '.$name);
    }
    must(extension_loaded('pdo_pgsql'), 'real PDO PostgreSQL extension required');
}

isolate();
require dirname(__DIR__, 2).'/vendor/autoload.php';
$app = require dirname(__DIR__, 2).'/bootstrap/app.php';
$app->make(Kernel::class)->bootstrap();
must(config('app.env') === 'testing'
    && config('database.default') === 'pgsql'
    && config('database.connections.pgsql.database') === 'pb3_admin_audit_227_ci'
    && config('database.connections.pgsql.host') === '127.0.0.1'
    && DB::getSchemaBuilder()->hasTable('admin_audit_heads_v1')
    && DB::getSchemaBuilder()->hasTable('admin_audit_records_v1'),
    'refuse non-disposable or unmigrated DB');

function awaitFile(string $file, int $maxMs = 25_000): void
{
    $started = microtime(true);
    while (!is_file($file)) {
        must((microtime(true) - $started) * 1000 < $maxMs,
            'timeout waiting for '.basename($file));
        usleep(20_000);
    }
}

function actor(array $e): AdminPrincipal
{
    return new AdminPrincipal(
        $e['actorId'], 'owner',
        $e['actorExpiresAtMs'], $e['mfaAtMs'],
    );
}

function record(array $event): array
{
    return app(AdminAuditLedger::class)->record(
        actor($event),
        $event['operationId'],
        'grants.issue',
        'account',
        $event['targetId'],
        'reviewed_trial',
        $event['expiresAtMs'],
    );
}

/** A completely independent PHP OS process + independently opened PG conn. */
function worker(array $args): never
{
    // worker, owner|contender, fixture, ownerReady, contenderReady, output
    must(count($args) === 6, 'worker argument count');
    [$command, $role, $fixture, $ownerReady, $contenderReady, $output] = $args;
    must($command === 'worker' && in_array($role, ['owner', 'contender'], true),
        'invalid worker role');
    $event = json_decode((string) file_get_contents($fixture), true, 16, JSON_THROW_ON_ERROR);
    must(is_array($event) && isset($event['operationId'], $event['actorId']),
        'synthetic fixture required');

    $backend = (int) DB::selectOne('SELECT pg_backend_pid() AS pid')->pid;
    $start = microtime(true);
    try {
        if ($role === 'owner') {
            DB::transaction(function () use (
                $event, $ownerReady, $contenderReady, $backend, &$result,
            ): void {
                // Hold global HEAD row lock beyond nested Ledger transaction.
                $head = DB::table('admin_audit_heads_v1')->where('id', 1)
                    ->lockForUpdate()->first();
                must($head !== null, 'owner locks durable admin head');
                $result = record($event);
                file_put_contents($ownerReady, (string) $backend);
                awaitFile($contenderReady);
                usleep(1_800_000);
            }, 1);
        } else {
            file_put_contents($contenderReady, (string) $backend);
            $result = record($event);
        }
        $result['outcome'] = 'recorded';
    } catch (DomainException $error) {
        $result = ['outcome' => 'denied', 'reason' => $error->getMessage()];
    } catch (Throwable $error) {
        $result = [
            'outcome' => 'unexpected_error',
            'type' => get_class($error),
            'reason' => $error->getMessage(),
        ];
    }
    $result['pgBackend'] = $backend;
    $result['osPid'] = getmypid();
    $result['elapsedMs'] = (int) round((microtime(true) - $start) * 1000);
    file_put_contents($output, json_encode($result, JSON_THROW_ON_ERROR));
    exit($result['outcome'] === 'unexpected_error' ? 2 : 0);
}

function spawn(string $role, string $input, string $ownerReady, string $contenderReady,
    string $result, string $log): mixed
{
    $command = [PHP_BINARY, __FILE__, 'worker', $role, $input, $ownerReady, $contenderReady, $result];
    $proc = proc_open($command, [
        0 => ['pipe', 'r'],
        1 => ['file', $log.'.stdout', 'w'],
        2 => ['file', $log.'.stderr', 'w'],
    ], $pipes, dirname(__DIR__, 2), null, ['bypass_shell' => true]);
    must(is_resource($proc), 'launch real independent PHP OS process');
    fclose($pipes[0]);
    return $proc;
}

function observedLock(int $pgPid, int $timeoutMs = 1_400): bool
{
    $start = microtime(true);
    while ((microtime(true) - $start) * 1000 < $timeoutMs) {
        $state = DB::selectOne(
            'SELECT wait_event_type FROM pg_stat_activity WHERE pid = ?', [$pgPid],
        );
        if ($state !== null && $state->wait_event_type === 'Lock') {
            return true;
        }
        usleep(25_000);
    }
    return false;
}

/** @return array{owner:array,contender:array} */
function race(string $name, array $ownerEvent, array $contenderEvent, bool $accept): array
{
    $directory = sys_get_temp_dir().'/pb3-admin-227-'.bin2hex(random_bytes(8));
    must(mkdir($directory, 0700), 'allocate private temp CI fixture directory');
    $ownerInput = $directory.'/owner-input.json';
    $contenderInput = $directory.'/contender-input.json';
    $ownerReady = $directory.'/owner.ready';
    $contenderReady = $directory.'/contender.ready';
    $ownerResult = $directory.'/owner-result.json';
    $contenderResult = $directory.'/contender-result.json';
    file_put_contents($ownerInput, json_encode($ownerEvent, JSON_THROW_ON_ERROR));
    file_put_contents($contenderInput, json_encode($contenderEvent, JSON_THROW_ON_ERROR));

    $owner = null;
    $contender = null;
    try {
        $owner = spawn('owner', $ownerInput, $ownerReady, $contenderReady, $ownerResult,
            $directory.'/owner');
        awaitFile($ownerReady);
        $contender = spawn('contender', $contenderInput, $ownerReady, $contenderReady,
            $contenderResult, $directory.'/contender');
        awaitFile($contenderReady);
        $blocked = observedLock((int) file_get_contents($contenderReady));
        awaitFile($ownerResult);
        awaitFile($contenderResult);
        $ownerExit = proc_close($owner);
        $owner = null;
        $contenderExit = proc_close($contender);
        $contender = null;
        $a = json_decode((string) file_get_contents($ownerResult), true, 16, JSON_THROW_ON_ERROR);
        $b = json_decode((string) file_get_contents($contenderResult), true, 16, JSON_THROW_ON_ERROR);
        must($ownerExit === 0 && $contenderExit === 0,
            $name.' worker failed '.json_encode([$a, $b]));
        must($blocked, $name.' must independently OBSERVE a real PostgreSQL lock wait');
        must($a['osPid'] !== $b['osPid'] && $a['pgBackend'] !== $b['pgBackend'],
            $name.' must use distinct processes AND PostgreSQL backends');
        must($a['outcome'] === 'recorded' && $a['state'] === 'recorded_only'
            && $a['replay'] === false, $name.' owner first append');
        must($b['outcome'] === ($accept ? 'recorded' : 'denied'),
            $name.' contender outcome '.json_encode($b));
        if ($accept) {
            must($b['state'] === 'recorded_only', $name.' no action authorization');
        } else {
            must($b['reason'] === 'admin.audit_inconsistent',
                $name.' immutable operation collision must fail closed');
        }
        must($b['elapsedMs'] >= 300,
            $name.' contender did not endure actual serialized lock wait');
        return ['owner' => $a, 'contender' => $b];
    } finally {
        foreach ([$owner, $contender] as $proc) {
            if (is_resource($proc)) {
                proc_terminate($proc);
                proc_close($proc);
            }
        }
        foreach (glob($directory.'/*') ?: [] as $file) {
            @unlink($file);
        }
        @rmdir($directory);
    }
}

if (($argv[1] ?? null) === 'worker') {
    worker(array_slice($argv, 1));
}
must(count($argv) === 1, 'unexpected command-line inputs');
$now = (int) now()->getTimestampMs();
$principal = [
    'actorId' => (string) Str::uuid(),
    'actorExpiresAtMs' => $now + 3_600_000,
    'mfaAtMs' => $now - 2_000,
];
$original = $principal + [
    'operationId' => (string) Str::uuid(),
    'targetId' => (string) Str::uuid(),
    'expiresAtMs' => $now + 86_400_000,
];
$same = race('exact-idempotent-replay', $original, $original, true);
must($same['contender']['replay'] === true
    && $same['contender']['digest'] === $same['owner']['digest'],
    'original UUID retry must return SAME event digest');
must(DB::table('admin_audit_records_v1')->count() === 1,
    'idempotent retry must persist only one proposed event');
fwrite(STDOUT, "P3 #227 PG18 REAL REPLAY PASS: two PHP processes, observed Lock, one event\n");

$collision = $principal + [
    'operationId' => (string) Str::uuid(),
    'targetId' => (string) Str::uuid(),
    'expiresAtMs' => $now + 86_400_000,
];
$collisionOther = $collision;
$collisionOther['targetId'] = (string) Str::uuid();
race('same-operation-foreign-target', $collision, $collisionOther, false);
must(DB::table('admin_audit_records_v1')->count() === 2,
    'same operationId different target may not create extra event');
fwrite(STDOUT, "P3 #227 PG18 REAL COLLISION PASS: original append remains immutable\n");

$next = $principal + [
    'operationId' => (string) Str::uuid(),
    'targetId' => (string) Str::uuid(),
    'expiresAtMs' => $now + 86_400_000,
];
$otherPrincipal = [
    'actorId' => (string) Str::uuid(),
    'actorExpiresAtMs' => $now + 3_600_000,
    'mfaAtMs' => $now - 2_000,
];
$another = $otherPrincipal + [
    'operationId' => (string) Str::uuid(),
    'targetId' => (string) Str::uuid(),
    'expiresAtMs' => $now + 86_400_000,
];
$distinct = race('distinct-actors-append', $next, $another, true);
must($distinct['contender']['replay'] === false
    && $distinct['owner']['digest'] !== $distinct['contender']['digest'],
    'distinct operations must append separate hash-linked events');
$report = app(AdminAuditLedger::class)->verifyChain();
must($report['state'] === 'database_consistent_only'
    && $report['count'] === 4
    && $report['lastDigest'] === $distinct['contender']['digest'],
    'four total records must form internally consistent real PG chain');
must(DB::table('admin_audit_heads_v1')->where('id', 1)->value('revision') == 4,
    'global head must persist exact four-append revision');
fwrite(STDOUT, "P3 #227 PG18 REAL DISTINCT APPEND PASS: cross-actor serialized chain\n");
fwrite(STDOUT, "P3 #227 PG18 COMPLETE: 3/3 REAL independent-PHP-process Lock races PASS; 4 RECORDS; NO admin actions, MFA sessions or external tamper anchors\n");
