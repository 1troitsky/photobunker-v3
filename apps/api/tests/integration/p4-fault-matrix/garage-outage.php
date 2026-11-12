<?php
declare(strict_types=1);

/**
 * P4 FAULT MATRIX — actual disposable Garage stop/start, independent live
 * PostgreSQL, durable photo reservation, and safe TTL/tombstone recovery.
 *
 * NEVER run against any real account, database, cloud, or non-CI bucket.
 * Called in three distinct PHP processes from p0-02-storage.yml.
 *
 * Matrix/Synapse and Backup are not started here; never report those PASS.
 */
use App\Photo\Lifecycle;
use Illuminate\Contracts\Console\Kernel;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Storage;
use Illuminate\Support\Str;

$mode = $argv[1] ?? '';
if (!in_array($mode, ['prepare', 's3-down', 'recover'], true)
    || getenv('GITHUB_ACTIONS') !== 'true'
    || getenv('PB3_ISOLATED_STORAGE_SMOKE') !== '1'
    || getenv('APP_ENV') !== 'testing'
    || getenv('DB_CONNECTION') !== 'pgsql'
    || getenv('DB_HOST') !== '127.0.0.1'
    || getenv('DB_DATABASE') !== 'pb3_ci_p0'
    || getenv('S3_ENDPOINT') !== 'http://127.0.0.1:3900'
    || getenv('S3_BUCKET') !== 'pb3-ci-p0'
    || getenv('PB3_ENABLE_PHOTO_CLEANUP') === 'true'
    || getenv('RUNNER_TEMP') === false) {
    throw new RuntimeException('p4.fault_matrix.non_disposable_environment');
}

$fixtureFile = (string) getenv('P4_FAULT_FIXTURE');
if ($fixtureFile !== rtrim((string) getenv('RUNNER_TEMP'), '/') . '/pb3-p4-fault-fixture.json') {
    throw new RuntimeException('p4.fault_matrix.unsafe_fixture_path');
}

$root = dirname(__DIR__, 3);
require $root . '/vendor/autoload.php';
$app = require $root . '/bootstrap/app.php';
$app->make(Kernel::class)->bootstrap();

$diskConfig = config('filesystems.disks.ciphertext');
if (config('database.default') !== 'pgsql'
    || config('app.env') !== 'testing'
    || ($diskConfig['endpoint'] ?? '') !== 'http://127.0.0.1:3900'
    || ($diskConfig['bucket'] ?? '') !== 'pb3-ci-p0'
    || config('photo_sync.cleanup_enabled', false)) {
    throw new RuntimeException('p4.fault_matrix.unsafe_app_configuration');
}
foreach (['identity_accounts','identity_devices','photo_records',
    'photo_objects','storage_locations','photo_tombstones'] as $table) {
    if (!DB::getSchemaBuilder()->hasTable($table)) {
        throw new RuntimeException('p4.fault_matrix.missing_schema');
    }
}
// The existing reconciliation batch threshold must consider our deliberately
// two-hour-old synthetic upload, not default production grace.
config()->set('photo_sync.orphan_grace_hours', 1);
config()->set('photo_sync.tombstone_sweep_seconds', 60);

$assert = static function (bool $condition, string $reason): void {
    if (!$condition) {
        throw new RuntimeException('p4.fault_matrix.' . $reason);
    }
};

$disk = Storage::disk('ciphertext');
$lifecycle = app(Lifecycle::class);

if ($mode === 'prepare') {
    $account = (string) Str::uuid();
    $device = (string) Str::uuid();
    $photo = (string) Str::uuid();
    $asset = (string) Str::uuid();
    $operation = (string) Str::uuid();
    $objectKey = 'cipher/v1/' . $account . '/' . $photo . '/' . $asset;
    $ciphertext = random_bytes(2093); // SYNTHETIC bytes, not user media.
    $sha = hash('sha256', $ciphertext);
    $now = now();

    DB::table('identity_accounts')->insert([
        'id' => $account,
        'operation_id' => (string) Str::uuid(),
        'prepare_hash' => str_repeat('d', 64),
        'status' => 'ready',
        'reserved_until' => now()->addDay(),
        'created_at' => $now,
        'updated_at' => $now,
    ]);
    DB::table('identity_devices')->insert([
        'id' => $device,
        'account_id' => $account,
        'signing_spki' => 'synthetic-p4-only',
        'created_at' => $now,
        'updated_at' => $now,
    ]);
    DB::table('photo_records')->insert([
        'id' => $photo,
        'account_id' => $account,
        'device_id' => $device,
        'operation_id' => $operation,
        'state' => 'pending',
        'expires_at' => now()->addDays(2)->getTimestampMs(),
        'contract_hash' => str_repeat('c', 64),
        'contract_json' => '{}',
        'signature' => 'synthetic-p4-only',
        'created_at' => $now,
        'updated_at' => $now,
    ]);
    DB::table('photo_objects')->insert([
        'id' => $asset,
        'photo_id' => $photo,
        'kind' => 'master',
        'revision' => 1,
        'bytes' => strlen($ciphertext),
        'sha256' => $sha,
        'manifest_json' => '{}',
        'object_key' => $objectKey,
        'state' => 'uploading',
        'created_at' => now()->subHours(2),
        'updated_at' => now()->subHours(2),
    ]);
    DB::table('storage_locations')->insert([
        'id' => (string) Str::uuid(),
        'asset_id' => $asset,
        'provider' => 'app_s3',
        'object_key' => $objectKey,
        'bytes' => strlen($ciphertext),
        'sha256' => $sha,
        'state' => 'reserved',
        'created_at' => $now,
        'updated_at' => $now,
    ]);

    $assert($disk->put($objectKey, $ciphertext) !== false,
        'fixture_ciphertext_put_failed');
    $assert($disk->exists($objectKey), 'fixture_ciphertext_missing');
    $assert(hash_equals($sha, hash('sha256', (string) $disk->get($objectKey))),
        'fixture_ciphertext_corrupt');

    $payload = [
        'account' => $account,
        'photo' => $photo,
        'asset' => $asset,
        'key' => $objectKey,
        'sha256' => $sha,
        'bytes' => strlen($ciphertext),
    ];
    $json = json_encode($payload, JSON_THROW_ON_ERROR);
    $assert(file_put_contents($fixtureFile, $json, LOCK_EX) !== false,
        'fixture_state_write_failed');
    chmod($fixtureFile, 0600);
    fwrite(STDOUT, "P4 Garage fault matrix PREPARED: real S3 + PostgreSQL, synthetic ciphertext only\n");
    exit(0);
}

$raw = file_get_contents($fixtureFile);
$payload = is_string($raw) ? json_decode($raw, true, 8, JSON_THROW_ON_ERROR) : null;
$assert(is_array($payload) && array_keys($payload) ===
    ['account','photo','asset','key','sha256','bytes'], 'invalid_fixture_state');
foreach (['account','photo','asset'] as $field) {
    $assert(is_string($payload[$field])
        && preg_match('/\A[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}\z/D',
            $payload[$field]) === 1, 'invalid_fixture_identifier');
}
$assert($payload['key'] === 'cipher/v1/' . $payload['account'] . '/'
    . $payload['photo'] . '/' . $payload['asset'], 'invalid_fixture_object_key');
$assert(is_string($payload['sha256'])
    && preg_match('/\A[a-f0-9]{64}\z/D', $payload['sha256']) === 1
    && is_int($payload['bytes']) && $payload['bytes'] === 2093, 'invalid_fixture_integrity');

$asset = $payload['asset'];
$photo = $payload['photo'];
$key = $payload['key'];
$assert(DB::select('SELECT 1') !== [], 'postgres_unavailable');
$assert(DB::table('photo_records')->where('id', $photo)->where('state', 'pending')->exists(),
    'lost_pending_parent');

if ($mode === 's3-down') {
    // docker stop pb3-p0-garage is performed by the CI workflow BEFORE this
    // process. PostgreSQL remains reachable; no mocked provider.
    $result = $lifecycle->reconcileStalledUploads(1);
    $assert($result === ['verified' => 0, 'reset' => 0, 'deferred' => 0, 'errors' => 1],
        's3_outage_false_reconciliation_ack');
    $assert(DB::table('photo_records')->where('id', $photo)
        ->where('state', 'pending')->exists(), 'parent_removed_during_s3_outage');
    $assert(DB::table('photo_objects')->where('id', $asset)
        ->where('state', 'uploading')->exists(), 'lease_reset_on_s3_outage');
    $assert(DB::table('storage_locations')->where('asset_id', $asset)
        ->where('state', 'reserved')->exists(), 'placement_lost_on_s3_outage');
    fwrite(STDOUT, "P4 Garage fault matrix S3-DOWN PASS: live PostgreSQL, zero false ACK, durable pending/lease/location\n");
    exit(0);
}

// Garage has been restarted using the SAME on-disk metadata and S3 key.
// The original encrypted object, reserved before the outage, must survive.
$copy = $disk->get($key);
$assert(is_string($copy) && strlen($copy) === $payload['bytes']
    && hash_equals($payload['sha256'], hash('sha256', $copy)),
    'restarted_garage_lost_ciphertext');

$reconcile = $lifecycle->reconcileStalledUploads(1);
$assert($reconcile === ['verified' => 1, 'reset' => 0, 'deferred' => 0, 'errors' => 0],
    'failed_recovering_pending_upload');
$assert(DB::table('photo_objects')->where('id', $asset)
    ->where('state', 'verified')->exists(), 'failed_promoting_asset');
$assert(DB::table('storage_locations')->where('asset_id', $asset)
    ->where('state', 'verified')->exists(), 'failed_promoting_location');
$assert($lifecycle->reconcileStalledUploads(1)
    === ['verified' => 0, 'reset' => 0, 'deferred' => 0, 'errors' => 0],
    'replayed_verification_not_idempotent');

// Inject a separate *unreachable database connection* (not real PG stop).
// Prove a DB outage does not result in a bogus successful cleanup ACK or
// erase a healthy S3 object. Always restore the actual PG connection.
$previous = DB::getDefaultConnection();
config()->set('database.connections.p4_unreachable', [
    'driver' => 'pgsql',
    'host' => '127.0.0.1',
    'port' => '1', // disposable intentionally non-listening local endpoint
    'database' => 'p4_unreachable',
    'username' => 'nobody',
    'password' => 'not-used',
    'charset' => 'utf8',
    'prefix' => '',
    'schema' => 'public',
    'sslmode' => 'prefer',
    'connect_timeout' => 1,
]);
$databaseFailureObserved = false;
try {
    DB::setDefaultConnection('p4_unreachable');
    $lifecycle->cleanup($photo);
} catch (\Throwable) {
    $databaseFailureObserved = true;
} finally {
    DB::setDefaultConnection($previous);
    DB::purge('p4_unreachable');
}
$assert($databaseFailureObserved, 'unreachable_pg_connection_falsely_succeeded');
$assert($disk->exists($key), 'database_outage_erased_s3_object');
$assert(DB::table('photo_records')->where('id', $photo)->exists(),
    'database_outage_changed_live_record');

// Process a real expired synthetic photo through the production Lifecycle.
DB::table('photo_records')->where('id', $photo)->update([
    'expires_at' => now()->subMinute()->getTimestampMs(),
]);
$lifecycle->cleanup($photo);
$assert(!$disk->exists($key), 'expired_photo_ciphertext_still_in_s3');
$assert(!DB::table('photo_records')->where('id', $photo)->exists()
    && !DB::table('photo_objects')->where('id', $asset)->exists()
    && !DB::table('storage_locations')->where('asset_id', $asset)->exists(),
    'expired_photo_db_refs_not_cleared');
$assert(DB::table('photo_tombstones')->where('photo_id', $photo)->exists(),
    'durable_tombstone_lost');
$lifecycle->cleanup($photo); // idempotent duplicate retry.

// Late writes after a completed cleanup cannot resurrect deleted ciphertext,
// even if the prior tombstone sweep already ran once.
for ($attempt = 1; $attempt <= 2; $attempt++) {
    $assert($disk->put($key, random_bytes(48)) !== false,
        'late_write_fixture_failed');
    DB::table('photo_tombstones')->where('photo_id', $photo)->update([
        'cleanup_until' => now()->subSecond(),
    ]);
    $assert($lifecycle->sweepTombstones(1) === 1 && !$disk->exists($key),
        'late_write_resurrected_s3_object');
}
unlink($fixtureFile);
fwrite(STDOUT, "P4 Garage fault matrix RECOVERY PASS: genuine restart and readback, retry idempotency, injected DB fail-closed, TTL/tombstones\n");
