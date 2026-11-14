<?php
declare(strict_types=1);

/**
 * #228: TRUE PostgreSQL18 lock contention across TWO OS PHP processes and
 * TWO independently established PDO connections for INTERNAL temporary
 * restriction/explicit release policy. Inert synthetic identities only.
 *
 * Security guard runs BEFORE Laravel boots. Never use a live service or real
 * customer identity. These tests do NOT mount an admin route, authenticate a
 * real privileged user or enforce production requests.
 */

use App\Administration\AdminPrincipal;
use App\Administration\Restrictions\TemporaryRestrictionLedger;
use Carbon\CarbonImmutable;
use Illuminate\Contracts\Console\Kernel;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;

function ensure(bool $ok, string $description): void
{
    if (!$ok) {
        throw new RuntimeException('P3 #228 real restriction PG18 race FAIL: '.$description);
    }
}

function requireDisposable(): void
{
    foreach ([
        'GITHUB_ACTIONS' => 'true',
        'PB3_ADMIN_228_PG_RACE' => '1',
        'APP_ENV' => 'testing',
        'DB_CONNECTION' => 'pgsql',
        'DB_HOST' => '127.0.0.1',
        'DB_DATABASE' => 'pb3_admin_trial_228_ci',
        'DB_USERNAME' => 'pb3_admin_228_ci',
    ] as $key => $expected) {
        ensure(getenv($key) === $expected, 'REFUSED non-disposable CI: '.$key);
    }
    ensure(extension_loaded('pdo_pgsql'), 'real PostgreSQL PDO extension required');
}

requireDisposable();
require dirname(__DIR__, 2).'/vendor/autoload.php';
$app = require dirname(__DIR__, 2).'/bootstrap/app.php';
$app->make(Kernel::class)->bootstrap();
ensure(config('app.env') === 'testing'
    && config('database.default') === 'pgsql'
    && config('database.connections.pgsql.host') === '127.0.0.1'
    && config('database.connections.pgsql.database') === 'pb3_admin_trial_228_ci'
    && DB::getSchemaBuilder()->hasTable('identity_accounts')
    && DB::getSchemaBuilder()->hasTable('identity_devices')
    && DB::getSchemaBuilder()->hasTable('admin_temporary_restriction_heads_v1')
    && DB::getSchemaBuilder()->hasTable('admin_temporary_restriction_events_v1'),
    'refuse non-disposable or unmigrated DB');

function waitFor(string $path, int $timeoutMs = 25000): void
{
    $start = microtime(true);
    while (!is_file($path)) {
        ensure((microtime(true) - $start) * 1000 < $timeoutMs,
            'timeout waiting for '.basename($path));
        usleep(20000);
    }
}

function dt(mixed $date): ?string
{
    return $date === null ? null
        : CarbonImmutable::parse((string) $date, 'UTC')->utc()->format('Y-m-d\TH:i:s\Z');
}

function principal(array $fixture): AdminPrincipal
{
    // An explicit near-expiry MFA marker is resolved *just before invoking*
    // the operation in this OS process. Initial access is valid; the lock
    // wait must push it outside the 300s policy limit.
    $mfaAt = isset($fixture['mfaAgeMs'])
        ? CarbonImmutable::now('UTC')->getTimestampMs() - (int) $fixture['mfaAgeMs']
        : (int) $fixture['mfaAtMs'];

    return new AdminPrincipal(
        $fixture['actorId'],
        $fixture['role'] ?? 'operator',
        (int) $fixture['actorExpiresAtMs'],
        $mfaAt,
    );
}

function change(array $fixture): array
{
    return app(TemporaryRestrictionLedger::class)->changeTrusted(
        principal($fixture),
        $fixture['operationId'],
        $fixture['accountId'],
        $fixture['targetType'],
        $fixture['targetId'],
        $fixture['action'],
        (int) $fixture['expectedRevision'],
        $fixture['reasonCode'],
        $fixture['expiresAt'] === null
            ? null : CarbonImmutable::parse($fixture['expiresAt'], 'UTC'),
    );
}

function worker(array $args): never
{
    ensure(count($args) === 6, 'worker argument count');
    [$cmd, $role, $input, $ownerReady, $contenderReady, $output] = $args;
    ensure($cmd === 'worker' && in_array($role, ['owner', 'contender'], true),
        'worker command and role');
    $fixture = json_decode((string) file_get_contents($input),
        true, 20, JSON_THROW_ON_ERROR);
    ensure(is_array($fixture) && isset($fixture['accountId'],
        $fixture['targetId'], $fixture['operationId']), 'synthetic fixture');
    $backend = (int) DB::selectOne('SELECT pg_backend_pid() AS pid')->pid;
    $start = microtime(true);
    try {
        if ($role === 'owner') {
            DB::transaction(function () use (
                $fixture, $backend, $ownerReady, $contenderReady, &$result,
            ): void {
                // Exact same lock used by TemporaryRestrictionLedger, BEFORE
                // the initial restriction HEAD exists. Nested transaction
                // must not release until AFTER independent contender waits.
                $account = DB::table('identity_accounts')
                    ->where('id', $fixture['accountId'])
                    ->lockForUpdate()->first();
                ensure($account !== null && $account->status === 'ready',
                    'owner holds existing READY account lock');
                $result = change($fixture);
                file_put_contents($ownerReady, (string) $backend);
                waitFor($contenderReady);
                usleep(2200000);
            }, 1);
        } else {
            file_put_contents($contenderReady, (string) $backend);
            $result = change($fixture);
        }
        $result['outcome'] = 'applied';
    } catch (DomainException $e) {
        $result = ['outcome' => 'denied', 'reason' => $e->getMessage()];
    } catch (Throwable $e) {
        $result = [
            'outcome' => 'unexpected_error',
            'type' => get_class($e),
            'reason' => $e->getMessage(),
        ];
    }
    $result['pgBackend'] = $backend;
    $result['osPid'] = getmypid();
    $result['elapsedMs'] = (int) round((microtime(true) - $start) * 1000);
    file_put_contents($output, json_encode($result, JSON_THROW_ON_ERROR));
    exit($result['outcome'] === 'unexpected_error' ? 2 : 0);
}

function spawn(
    string $role, string $input, string $ownerReady,
    string $contenderReady, string $result, string $log,
): mixed {
    $proc = proc_open([
        PHP_BINARY, __FILE__, 'worker', $role, $input,
        $ownerReady, $contenderReady, $result,
    ], [
        0 => ['pipe', 'r'],
        1 => ['file', $log.'.stdout', 'w'],
        2 => ['file', $log.'.stderr', 'w'],
    ], $pipes, dirname(__DIR__, 2), null, ['bypass_shell' => true]);
    ensure(is_resource($proc), 'launch independent PHP OS process');
    fclose($pipes[0]);
    return $proc;
}

function observedLock(int $pid, int $maxMs = 1550): bool
{
    $start = microtime(true);
    while ((microtime(true) - $start) * 1000 < $maxMs) {
        $row = DB::selectOne(
            'SELECT wait_event_type FROM pg_stat_activity WHERE pid = ?', [$pid],
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
function race(string $name, array $ownerInput, array $contenderInput): array
{
    $directory = sys_get_temp_dir().'/pb3-admin-restriction-race-'.bin2hex(random_bytes(8));
    ensure(mkdir($directory, 0700), 'create private disposable fixtures');
    $inputA = $directory.'/a.json';
    $inputB = $directory.'/b.json';
    $ownerReady = $directory.'/a.ready';
    $contenderReady = $directory.'/b.ready';
    $resultA = $directory.'/a.out';
    $resultB = $directory.'/b.out';
    file_put_contents($inputA, json_encode($ownerInput, JSON_THROW_ON_ERROR));
    file_put_contents($inputB, json_encode($contenderInput, JSON_THROW_ON_ERROR));
    $owner = null;
    $contender = null;
    try {
        $owner = spawn('owner', $inputA, $ownerReady, $contenderReady,
            $resultA, $directory.'/a');
        waitFor($ownerReady);
        $contender = spawn('contender', $inputB, $ownerReady, $contenderReady,
            $resultB, $directory.'/b');
        waitFor($contenderReady);
        $locked = observedLock((int) file_get_contents($contenderReady));
        waitFor($resultA);
        waitFor($resultB);
        $exitA = proc_close($owner);
        $owner = null;
        $exitB = proc_close($contender);
        $contender = null;
        $a = json_decode((string) file_get_contents($resultA), true, 20, JSON_THROW_ON_ERROR);
        $b = json_decode((string) file_get_contents($resultB), true, 20, JSON_THROW_ON_ERROR);
        ensure($exitA === 0 && $exitB === 0,
            $name.' subprocess unexpectedly exited '.json_encode([$a,$b]));
        ensure($locked,
            $name.' MUST observe actual PostgreSQL wait_event_type=Lock');
        ensure($a['osPid'] !== $b['osPid']
            && $a['pgBackend'] !== $b['pgBackend'],
            $name.' requires TWO independent OS PHP processes and PG backends');
        ensure($a['outcome'] === 'applied'
            && $a['state'] === 'internal_restriction_event_recorded'
            && $a['operationId'] === $ownerInput['operationId']
            && $a['revision'] === $ownerInput['expectedRevision'] + 1
            && $a['replay'] === false,
            $name.' original transaction must write one new event');
        ensure($b['elapsedMs'] >= 300,
            $name.' contender must block on genuine database transaction');
        return ['owner' => $a, 'contender' => $b];
    } finally {
        foreach ([$owner, $contender] as $p) {
            if (is_resource($p)) {
                proc_terminate($p);
                proc_close($p);
            }
        }
        foreach (glob($directory.'/*') ?: [] as $path) {
            @unlink($path);
        }
        @rmdir($directory);
    }
}

function newAccount(): string
{
    $id = (string) Str::uuid();
    DB::table('identity_accounts')->insert([
        'id' => $id,
        'operation_id' => (string) Str::uuid(),
        'prepare_hash' => str_repeat('a', 64),
        'status' => 'ready',
        'reserved_until' => now()->addDay(),
        'created_at' => now(),
        'updated_at' => now(),
    ]);
    return $id;
}

function newDevice(string $accountId): string
{
    $id = (string) Str::uuid();
    DB::table('identity_devices')->insert([
        'id' => $id,
        'account_id' => $accountId,
        'signing_spki' => 'synthetic-disposable-test-pubkey-not-a-real-secret',
        'created_at' => now(),
        'updated_at' => now(),
    ]);
    return $id;
}

function fixture(
    array $actor, string $accountId, string $targetType, string $targetId,
    string $action = 'restrict', int $revision = 0,
): array {
    return [
        'actorId' => $actor['actorId'],
        'actorExpiresAtMs' => $actor['actorExpiresAtMs'],
        'mfaAtMs' => $actor['mfaAtMs'],
        'role' => 'operator',
        'operationId' => (string) Str::uuid(),
        'accountId' => $accountId,
        'targetType' => $targetType,
        'targetId' => $targetId,
        'action' => $action,
        'expectedRevision' => $revision,
        'reasonCode' => $action === 'restrict'
            ? 'abuse_report' : 'appeal_accepted',
        'expiresAt' => $action === 'restrict'
            ? CarbonImmutable::now('UTC')->addDays(2)
                ->startOfSecond()->format('Y-m-d\TH:i:s\Z') : null,
    ];
}

/**
 * Independently recompute each record hash and full per-target chain, not
 * just the HEAD count. No plaintext, identifiers from customer accounts or
 * external security anchor. Do not claim tamper-proof outside test DB.
 *
 * @param array<int,string> $actions
 */
function verifyTarget(
    string $accountId, string $type, string $id, array $actions,
): void {
    $events = DB::table('admin_temporary_restriction_events_v1')
        ->where('target_type', $type)->where('target_id', $id)
        ->orderBy('revision')->get();
    ensure($events->count() === count($actions),
        $type.' event cardinality mismatch');
    $previous = str_repeat('0',64);
    foreach ($events as $index => $row) {
        $revision = $index + 1;
        ensure($row->account_id === $accountId
            && $row->target_type === $type && $row->target_id === $id
            && $row->action === $actions[$index]
            && (int) $row->revision === $revision
            && (int) $row->expected_revision === $index
            && hash_equals($previous, (string) $row->previous_hash),
            $type.' event malformed/changed or history not chained');
        $computed = hash('sha256', json_encode([
            'domain' => 'pb3.admin.temporary-restriction-event.v1',
            'operationId' => $row->operation_id,
            'actorId' => $row->actor_id,
            'accountId' => $row->account_id,
            'targetType' => $row->target_type,
            'targetId' => $row->target_id,
            'action' => $row->action,
            'expectedRevision' => (int) $row->expected_revision,
            'revision' => (int) $row->revision,
            'reasonCode' => $row->reason_code,
            'expiresAt' => dt($row->expires_at),
            'requestHash' => $row->request_hash,
            'previousHash' => $row->previous_hash,
            'recordedAt' => dt($row->recorded_at),
        ], JSON_UNESCAPED_SLASHES | JSON_THROW_ON_ERROR));
        ensure(hash_equals((string) $row->event_hash, $computed),
            $type.' event SHA256 mismatch');
        $previous = (string) $row->event_hash;
    }
    $head = DB::table('admin_temporary_restriction_heads_v1')
        ->where('target_type', $type)->where('target_id', $id)->first();
    ensure($head !== null && $head->account_id === $accountId
        && (int) $head->revision === count($actions)
        && hash_equals((string) $head->last_event_hash, $previous)
        && $head->last_operation_id === $events->last()->operation_id,
        $type.' current CAS head must match full append-only chain');
}

function admission(string $accountId, string $deviceId, bool $denied): void
{
    try {
        app(TemporaryRestrictionLedger::class)
            ->assertNotRestrictedForTrustedSession($accountId, $deviceId);
        ensure(!$denied, 'restricted principal was admitted');
    } catch (DomainException $e) {
        ensure($denied && $e->getMessage() === 'admin.restriction_access_denied',
            'unexpected admission denial '.$e->getMessage());
    }
}

if (($argv[1] ?? null) === 'worker') {
    worker(array_slice($argv, 1));
}
ensure(count($argv) === 1, 'unexpected CLI arguments');

// This actor is a synthetic principal, NOT derived from a real MFA provider.
$actorId = newAccount();
$nowMs = CarbonImmutable::now('UTC')->getTimestampMs();
$actor = [
    'actorId' => $actorId,
    'actorExpiresAtMs' => $nowMs + 3600000,
    'mfaAtMs' => $nowMs - 1000,
];

// 1. Same operation ID and payload while original UNCOMMITTED. Exactly one
// restriction, one current head, and a historical replay, never a second ban.
$a1 = newAccount();
$d1 = newDevice($a1);
$restrict1 = fixture($actor, $a1, 'account', $a1);
$same = race('exact-Lost-ACK-restrict-replay', $restrict1, $restrict1);
ensure($same['contender']['outcome'] === 'applied'
    && $same['contender']['replay'] === true
    && $same['contender']['revision'] === 1,
    'Lost ACK restrict must replay same committed revision');
verifyTarget($a1, 'account', $a1, ['restrict']);
admission($a1, $d1, true);
fwrite(STDOUT, "P3 #228 PG18 RESTRICTION REAL SAME-OP LOST ACK PASS: two PHP, actual Lock, one restriction\n");

// 2. Same operation UUID with changed reason must NOT overwrite event.
$a2 = newAccount();
newDevice($a2);
$restrict2 = fixture($actor, $a2, 'account', $a2);
$changed = $restrict2;
$changed['reasonCode'] = 'policy_violation';
$collision = race('same-operation-changed-reason', $restrict2, $changed);
ensure($collision['contender']['outcome'] === 'denied'
    && $collision['contender']['reason'] === 'admin.restriction_conflicting_replay',
    'changed reason under same operation must fail closed');
verifyTarget($a2, 'account', $a2, ['restrict']);
ensure(DB::table('admin_temporary_restriction_events_v1')
    ->where('operation_id', $restrict2['operationId'])
    ->value('reason_code') === 'abuse_report',
    'original reason must not be overwritten');
fwrite(STDOUT, "P3 #228 PG18 RESTRICTION REAL CHANGED REASON DENY PASS\n");

// 3. Distinct operations both claim initial revision 0 (NO head exists).
// Second actor must see CAS 1 and leave NO stray audit event.
$a3 = newAccount();
newDevice($a3);
$first3 = fixture($actor, $a3, 'account', $a3);
$second3 = $first3;
$second3['operationId'] = (string) Str::uuid();
$second3['reasonCode'] = 'policy_violation';
$stale = race('distinct-initial-writers-stale-CAS', $first3, $second3);
ensure($stale['contender']['outcome'] === 'denied'
    && $stale['contender']['reason'] === 'admin.restriction_revision_conflict',
    'different op concurrent initial revision must fail CAS');
ensure(!DB::table('admin_temporary_restriction_events_v1')
    ->where('operation_id', $second3['operationId'])->exists(),
    'stale first-write loser cannot leave orphan event');
verifyTarget($a3, 'account', $a3, ['restrict']);
fwrite(STDOUT, "P3 #228 PG18 RESTRICTION REAL INITIAL-CAS CONFLICT PASS: one history event only\n");

// 4. Release an ALREADY COMMITTED active restriction, while a concurrent
// exact Lost ACK release repeats. The prior event must remain immutable.
$a4 = newAccount();
$d4 = newDevice($a4);
$before4 = fixture($actor, $a4, 'account', $a4);
change($before4);
$release4 = fixture($actor, $a4, 'account', $a4, 'release', 1);
$sameRelease = race('concurrent-exact-release-replay', $release4, $release4);
ensure($sameRelease['contender']['outcome'] === 'applied'
    && $sameRelease['contender']['replay'] === true
    && $sameRelease['contender']['revision'] === 2,
    'concurrent exact release must return same historical revision 2');
verifyTarget($a4, 'account', $a4, ['restrict','release']);
admission($a4, $d4, false);
fwrite(STDOUT, "P3 #228 PG18 RESTRICTION REAL RELEASE LOST ACK PASS: historical ban retained\n");

// 5. Competing release requests same target/revision but DIFFERENT operation
// IDs. Winner only, second MUST reject stale expected revision.
$a5 = newAccount();
$d5 = newDevice($a5);
change(fixture($actor, $a5, 'account', $a5));
$release5 = fixture($actor, $a5, 'account', $a5, 'release', 1);
$other5 = $release5;
$other5['operationId'] = (string) Str::uuid();
$staleRelease = race('concurrent-different-release-ops', $release5, $other5);
ensure($staleRelease['contender']['outcome'] === 'denied'
    && $staleRelease['contender']['reason'] === 'admin.restriction_revision_conflict',
    'second release must fail CAS, not forge a new release');
verifyTarget($a5, 'account', $a5, ['restrict','release']);
admission($a5, $d5, false);
fwrite(STDOUT, "P3 #228 PG18 RESTRICTION REAL RELEASE STALE-CAS PASS\n");

// 6. Same-account restriction races against device-only restriction. Both
// SHOULD commit on distinct CAS heads but must serialize via account row.
$a6 = newAccount();
$d6 = newDevice($a6);
$d6Other = newDevice($a6);
$account6 = fixture($actor, $a6, 'account', $a6);
$device6 = fixture($actor, $a6, 'device', $d6);
$cross = race('same-account-cross-scope-serialize', $account6, $device6);
ensure($cross['contender']['outcome'] === 'applied'
    && $cross['contender']['replay'] === false
    && $cross['contender']['revision'] === 1,
    'different target scopes serialize and commit independently');
verifyTarget($a6, 'account', $a6, ['restrict']);
verifyTarget($a6, 'device', $d6, ['restrict']);
admission($a6, $d6, true);
admission($a6, $d6Other, true);
ensure(DB::table('identity_devices')->where('id', $d6)
    ->whereNull('revoked_at')->exists(), 'policy restriction does NOT revoke keys');
fwrite(STDOUT, "P3 #228 PG18 RESTRICTION REAL CROSS-SCOPE SERIALIZATION PASS\n");

// 7. MFA proof valid at submission but expires WHILE waiting on a genuine
// PG row lock. The post-lock authorization check MUST deny and log nothing.
$a7 = newAccount();
$d7 = newDevice($a7);
$restrict7 = fixture($actor, $a7, 'account', $a7);
$expired7 = $restrict7;
$expired7['operationId'] = (string) Str::uuid();
$expired7['mfaAgeMs'] = 299000; // just under 5min at worker invocation
$staleMfa = race('MFA-expires-during-real-DB-lock', $restrict7, $expired7);
ensure($staleMfa['contender']['outcome'] === 'denied'
    && $staleMfa['contender']['reason'] === 'admin.access_denied',
    'MFA must be rechecked after PG lock; no stale privilege action');
ensure(!DB::table('admin_temporary_restriction_events_v1')
    ->where('operation_id', $expired7['operationId'])->exists(),
    'stale MFA contender must not persist event');
verifyTarget($a7, 'account', $a7, ['restrict']);
admission($a7, $d7, true);
fwrite(STDOUT, "P3 #228 PG18 RESTRICTION REAL MFA-LATE-EXPIRY DENY PASS\n");

ensure(DB::table('admin_temporary_restriction_events_v1')->count() === 10,
    'exact 10 committed immutable restriction/release events across seven races');
ensure(DB::table('admin_temporary_restriction_heads_v1')->count() === 8,
    'exact eight per-target CAS heads including independent account/device scope');
fwrite(STDOUT, "P3 #228 PG18 RESTRICTION COMPLETE: 7/7 TRUE two-PHP/two-backend PostgreSQL18 lock races PASS, 10 immutable events, 8 heads, no orphan; INTERNAL unmounted policy ONLY\n");
