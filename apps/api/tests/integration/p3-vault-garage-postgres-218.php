<?php
declare(strict_types=1);

/**
 * ONLY disposable PostgreSQL 18 + Garage 2.5. Synthetic ciphertext fixtures;
 * never use real accounts, keys, buckets, or production object references.
 */
use App\Backup\RecoveryVaultGenerationLedger;
use App\Backup\VaultManifestWriteOnceUploader;
use App\Storage\StorageAdapter;
use Illuminate\Contracts\Console\Kernel;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;

if (getenv('PB3_ISOLATED_STORAGE_SMOKE') !== '1'
    || getenv('APP_ENV') !== 'testing'
    || getenv('DB_CONNECTION') !== 'pgsql'
    || getenv('DB_DATABASE') !== 'pb3_ci_p0'
    || getenv('DB_HOST') !== '127.0.0.1'
    || getenv('S3_ENDPOINT') !== 'http://127.0.0.1:3900'
    || getenv('S3_BUCKET') !== 'pb3-ci-p0') {
    throw new RuntimeException('vault.refuse_non_disposable_fixture');
}
require dirname(__DIR__, 2).'/vendor/autoload.php';
$app = require dirname(__DIR__, 2).'/bootstrap/app.php';
$app->make(Kernel::class)->bootstrap();
$disk = config('filesystems.disks.ciphertext');
if (config('database.default') !== 'pgsql'
    || config('app.env') !== 'testing'
    || ($disk['endpoint'] ?? null) !== 'http://127.0.0.1:3900'
    || ($disk['bucket'] ?? null) !== 'pb3-ci-p0'
    || !DB::getSchemaBuilder()->hasTable('backup_generations_v1')) {
    throw new RuntimeException('vault.refuse_unverified_fixture');
}

function requireVault(bool $condition, string $detail): void
{
    if (!$condition) {
        throw new RuntimeException('vault.fixture_failed: '.$detail);
    }
}
function requireVaultFailure(callable $fn, string $reason): void
{
    try {
        $fn();
    } catch (RuntimeException $e) {
        if ($e->getMessage() === $reason) {
            return;
        }
        throw new RuntimeException(
            'vault.wrong_failure: expected '.$reason.' received '.$e->getMessage(), 0, $e);
    }
    throw new RuntimeException('vault.unsafe_acceptance: '.$reason);
}
function vaultPut(StorageAdapter $storage, string $key, string $contents): void
{
    $stream = fopen('php://temp', 'w+b');
    if (!is_resource($stream)) throw new RuntimeException('vault.fixture_stream_failed');
    try {
        fwrite($stream, $contents);
        rewind($stream);
        requireVault($storage->putStream($key, $stream), 'Garage PUT');
    } finally {
        fclose($stream);
    }
}
function vaultBytes(StorageAdapter $storage, string $key): string
{
    $stream = $storage->readStream($key);
    requireVault(is_resource($stream), 'Garage GET');
    try {
        return stream_get_contents($stream);
    } finally {
        fclose($stream);
    }
}
function vaultStart(string $account): array
{
    $operation = (string) Str::uuid();
    $lease = (string) Str::uuid();
    DB::table('backup_start_operations_v1')->insert([
        'operation_id' => $operation, 'account_id' => $account,
        'lease_id' => $lease, 'state' => 'started',
        'reserved_at' => now(), 'accepted_at' => now(),
        'lease_expires_at' => now()->addMinutes(15),
        'finished_at' => null,
    ]);
    return compact('account', 'operation', 'lease');
}
function vaultStage(
    RecoveryVaultGenerationLedger $vault, array $auth, string $contents
): array {
    $generation = (string) Str::uuid();
    $key = $vault->stageTrusted(
        $auth['account'], $auth['operation'], $auth['lease'],
        $generation, hash('sha256', $contents), strlen($contents));
    return compact('generation', 'key');
}
function vaultActivate(
    RecoveryVaultGenerationLedger $vault, array $auth, array $generation
): string {
    return $vault->activateVerifiedTrusted(
        $auth['account'], $auth['operation'], $auth['lease'],
        $generation['generation']);
}
function vaultComplete(array $auth): void
{
    DB::table('backup_start_operations_v1')
        ->where('operation_id', $auth['operation'])
        ->update([
            'state' => 'completed', 'lease_expires_at' => null,
            'finished_at' => now(),
        ]);
}
$account = (string) Str::uuid();
DB::table('identity_accounts')->insert([
    'id' => $account, 'operation_id' => (string) Str::uuid(),
    'prepare_hash' => str_repeat('c', 64), 'status' => 'ready',
    'reserved_until' => now()->addDay(), 'created_at' => now(),
    'updated_at' => now(),
]);
$storage = app(StorageAdapter::class); // actual Garage, not Storage::fake
$vault = app(RecoveryVaultGenerationLedger::class);
$conditionalWriter = app(VaultManifestWriteOnceUploader::class);
$written = [];
try {
    $a = vaultStart($account);
    $firstBytes = random_bytes(512);
    $first = vaultStage($vault, $a, $firstBytes);
    requireVaultFailure(
        static fn() => vaultActivate($vault, $a, $first),
        'vault.manifest_not_verified');
    requireVault($vault->currentActive($account) === null,
        'missing manifest never creates a head');
    requireVaultFailure(
        static fn() => $conditionalWriter->publishStagedTrusted(
            $a['account'], $a['operation'], $a['lease'], $first['generation'],
            random_bytes(strlen($firstBytes))),
        'vault.publisher_not_authorized');
    requireVault(!$storage->exists($first['key']),
        'wrong hash cannot publish an object');
    requireVault(
        $conditionalWriter->publishStagedTrusted(
            $a['account'], $a['operation'], $a['lease'], $first['generation'],
            $firstBytes) === $first['key'],
        'native S3 If-None-Match first writer succeeded');
    $written[] = $first['key'];
    requireVaultFailure(
        static fn() => $conditionalWriter->publishStagedTrusted(
            $a['account'], $a['operation'], $a['lease'], $first['generation'],
            $firstBytes),
        'vault.write_once_conflict');
    requireVault(vaultBytes($storage, $first['key']) === $firstBytes,
        'duplicate conditional PUT did not overwrite first object');
    requireVault(vaultActivate($vault, $a, $first) === $first['generation'],
        'real physical Garage readback accepted');
    requireVault(vaultActivate($vault, $a, $first) === $first['generation'],
        'lost ACK replay');
    requireVault($vault->currentActive($account)->id === $first['generation'],
        'first verified active');
    requireVault(
        $vault->readVerifiedActiveCiphertextTrusted($account) === $firstBytes,
        'trusted active read returns exact ciphertext from actual Garage');
    // Post-activation overwrite with same-length ciphertext is a physical
    // negative: an active DB receipt alone must NOT approve altered S3 data.
    vaultPut($storage, $first['key'], random_bytes(strlen($firstBytes)));
    requireVaultFailure(
        static fn() => $vault->readVerifiedActiveCiphertextTrusted($account),
        'vault.manifest_not_verified');
    vaultPut($storage, $first['key'], $firstBytes);
    requireVault(
        $vault->readVerifiedActiveCiphertextTrusted($account) === $firstBytes,
        'restored physically verified ciphertext can be read again');
    vaultComplete($a);

    $b = vaultStart($account);
    $secondBytes = random_bytes(520);
    $second = vaultStage($vault, $b, $secondBytes);
    vaultPut($storage, $second['key'], random_bytes(strlen($secondBytes)));
    $written[] = $second['key'];
    requireVaultFailure(
        static fn() => vaultActivate($vault, $b, $second),
        'vault.manifest_not_verified');
    requireVault($vault->currentActive($account)->id === $first['generation'],
        'equal-length corrupted Garage object did not replace active');
    requireVault(vaultBytes($storage, $first['key']) === $firstBytes,
        'old ciphertext survived corrupt replacement');
    // Simulate retry/recovery of an incomplete remote write.
    vaultPut($storage, $second['key'], $secondBytes);
    requireVault(vaultActivate($vault, $b, $second) === $second['generation'],
        'verified replacement accepted');
    requireVault($vault->currentActive($account)->id === $second['generation'],
        'single active head moved atomically');
    requireVault(vaultBytes($storage, $first['key']) === $firstBytes,
        'retired Garage bytes preserved for later retention/GC');
    requireVault(
        DB::table('backup_generations_v1')->where('account_id', $account)
            ->where('state', 'active')->count() === 1,
        'one active generation');
    vaultComplete($b);

    $c = vaultStart($account);
    $staleBytes = random_bytes(512);
    $stale = vaultStage($vault, $c, $staleBytes);
    vaultPut($storage, $stale['key'], $staleBytes);
    $written[] = $stale['key'];
    DB::table('backup_start_operations_v1')
        ->where('operation_id', $c['operation'])
        ->update(['lease_expires_at' => now()->subMinute()]);
    requireVaultFailure(
        static fn() => vaultActivate($vault, $c, $stale),
        'vault.backup_lease_not_started');
    requireVault($vault->abandonStaleTrusted($account) === $stale['generation'],
        'expire staging under account lock');
    requireVault($vault->currentActive($account)->id === $second['generation'],
        'stale worker cannot destroy current active head');
    requireVault(vaultBytes($storage, $stale['key']) === $staleBytes,
        'abandon metadata never physically deletes');
    DB::table('backup_start_operations_v1')
        ->where('operation_id', $c['operation'])
        ->update(['state' => 'expired', 'lease_expires_at' => null,
            'finished_at' => now()]);
    $d = vaultStart($account);
    $fourth = vaultStage($vault, $d, random_bytes(512));
    requireVault($fourth['generation'] !== $stale['generation'],
        'new generation can start after failed worker without reviving stale');
    fwrite(STDOUT,
        "P3 #218 REAL PG18/Garage: create-only conditional PUT, missing/valid/corrupt/retry, lost-ACK, ".
        "verified replacement, post-activation tamper denial, retired bytes, ".
        "stale lease and release PASS\n");
} finally {
    // The initial hard guards above ensure this can only touch synthetic
    // keys in the disposable test bucket. No production deletion.
    foreach ($written as $key) {
        if ($storage->exists($key)) {
            requireVault($storage->delete($key), 'fixture cleanup');
        }
    }
}
