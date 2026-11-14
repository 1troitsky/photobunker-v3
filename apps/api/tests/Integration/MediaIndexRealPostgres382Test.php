<?php
declare(strict_types=1);

namespace Tests\Integration;

use App\Photo\PhotoSync;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;
use Tests\TestCase;

/**
 * #382: REAL PostgreSQL 18 + Laravel HTTP MediaFile index; NOT synthetic
 * client pagination, NOT 10k encrypted S3 objects, NOT a signed cursor.
 * The dedicated workflow uses a fresh disposable PG18 instance.
 */
final class MediaIndexRealPostgres382Test extends TestCase
{
    use RefreshDatabase;

    private string $owner;
    private string $ownerDevice;
    private string $outsider;
    private string $outsiderDevice;
    private int $future;

    protected function setUp(): void
    {
        // BEFORE Laravel RefreshDatabase can migrate/drop anything.
        foreach ([
            'GITHUB_ACTIONS' => 'true',
            'PB3_PG_INDEX_STRESS' => '1',
            'APP_ENV' => 'testing',
            'DB_CONNECTION' => 'pgsql',
            'DB_HOST' => '127.0.0.1',
            'DB_DATABASE' => 'pb3_ci_p2_382',
        ] as $name => $expected) {
            if (getenv($name) !== $expected) {
                throw new \RuntimeException('QA382 refuses non-disposable database: '.$name);
            }
        }
        parent::setUp();
        self::assertSame('pgsql', DB::getDriverName());
        self::assertSame('pb3_ci_p2_382', DB::getDatabaseName());
        self::assertTrue(DB::getSchemaBuilder()->hasTable('media_files_v1'));
        self::assertTrue(DB::getSchemaBuilder()->hasTable('browser_archive_entries_v1'));

        [$this->owner, $this->ownerDevice] = $this->actor();
        [$this->outsider, $this->outsiderDevice] = $this->actor();
        $this->future = PhotoSync::nowMs() + 7 * 86_400_000;
    }

    private function actor(): array
    {
        $account = (string) Str::uuid();
        $device = (string) Str::uuid();
        $now = now();
        DB::table('identity_accounts')->insert([
            'id' => $account,
            'operation_id' => (string) Str::uuid(),
            'prepare_hash' => str_repeat('a', 64),
            'status' => 'ready',
            'reserved_until' => $now->copy()->addDay(),
            'created_at' => $now, 'updated_at' => $now,
        ]);
        DB::table('identity_devices')->insert([
            'id' => $device, 'account_id' => $account,
            // Index-only fixture: never used for cryptographic signing.
            'signing_spki' => 'qa382-not-a-cryptographic-key',
            'created_at' => $now, 'updated_at' => $now,
        ]);
        return [$account, $device];
    }

    private function login(string $account, string $device): void
    {
        $this->withSession([
            'identity_account' => $account,
            'identity_device' => $device,
            'identity_issued' => time(),
        ])->withHeader('Origin', 'https://localhost');
    }

    private static function id(int $number, string $variant = '8000'): string
    {
        return '00000000-0000-4000-'.$variant.'-'.
            str_pad(dechex($number), 12, '0', STR_PAD_LEFT);
    }

    private function row(
        string $id, string $account, string $device,
        string $state = 'active', ?int $expiry = null
    ): array {
        $now = now();
        return [
            'id' => $id, 'account_id' => $account, 'device_id' => $device,
            'operation_id' => (string) Str::uuid(),
            'media_type' => 'video', 'state' => $state,
            'expires_at' => $expiry ?? $this->future,
            'plain_bytes' => 8192, 'cipher_bytes' => 8208,
            'contract_hash' => str_repeat('d', 64),
            // Explicitly NOT production E2EE fixtures; index must never
            // include these private-like strings in its JSON response.
            'contract_json' => '{"fileName":"QA382_PRIVATE_NEVER_SEND","gps":"QA382_SECRET_GPS"}',
            'signature' => 'qa382-synthetic-not-signed',
            'created_at' => $now, 'updated_at' => $now,
        ];
    }

    private function archived(int $number, string $state): void
    {
        DB::table('browser_archive_entries_v1')->insert([
            'id' => (string) Str::uuid(),
            'account_id' => $this->owner, 'kind' => 'media',
            'asset_id' => self::id($number),
            'revision' => 1, 'state' => $state,
            'asset_expires_at_ms' => $this->future,
            'archive_until_ms' => null, 'media_type' => 'video',
            'plain_bytes' => 8192,
            'last_operation_id' => (string) Str::uuid(),
            'created_at' => now(), 'updated_at' => now(),
        ]);
    }

    /** Bounded SQL batches: the fixture is on real PostgreSQL, not memory mocks. */
    private function seed(): void
    {
        $batch = [];
        for ($n = 1; $n <= 10_055; $n++) {
            $batch[] = $this->row(self::id($n), $this->owner, $this->ownerDevice);
            if (count($batch) === 250) {
                DB::table('media_files_v1')->insert($batch);
                $batch = [];
            }
        }
        if ($batch !== []) DB::table('media_files_v1')->insert($batch);
        for ($n = 1; $n <= 77; $n++) {
            $batch[] = $this->row(
                self::id($n, '9000'), $this->outsider, $this->outsiderDevice
            );
        }
        DB::table('media_files_v1')->insert($batch);
        DB::table('media_files_v1')->insert([
            $this->row(self::id(10_056), $this->owner, $this->ownerDevice, 'pending'),
            $this->row(self::id(10_057), $this->owner, $this->ownerDevice,
                'active', PhotoSync::nowMs() - 1000),
        ]);
        foreach ([111, 7200] as $n) $this->archived($n, 'archived');
        foreach ([300, 9000] as $n) $this->archived($n, 'deleting');
    }

    public function test_real_pg18_large_owner_index_and_interpage_mutations(): void
    {
        $this->seed();
        self::assertSame(10_134, DB::table('media_files_v1')->count());
        $this->login($this->owner, $this->ownerDevice);

        $start = microtime(true);
        $seen = [];
        $cursor = null;
        $pages = 0;
        while (true) {
            $url = '/media/v1'.($cursor === null ? '' : '?after='.rawurlencode($cursor));
            $response = $this->getJson($url)->assertOk();
            $payload = $response->json();
            self::assertIsArray($payload);
            self::assertArrayHasKey('items', $payload);
            self::assertArrayHasKey('nextCursor', $payload);
            $items = $payload['items'];
            self::assertIsArray($items);
            self::assertNotEmpty($items);
            self::assertLessThanOrEqual(50, count($items));
            self::assertStringNotContainsString(
                'QA382_PRIVATE_NEVER_SEND', $response->getContent()
            );
            self::assertStringNotContainsString(
                'QA382_SECRET_GPS', $response->getContent()
            );

            $last = $cursor;
            foreach ($items as $item) {
                self::assertSame('video', $item['mediaType']);
                $id = $item['mediaId'];
                self::assertMatchesRegularExpression(
                    '/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/',
                    $id
                );
                if ($last !== null) self::assertGreaterThan($last, $id);
                self::assertArrayNotHasKey($id, $seen, 'Duplicate MediaFile');
                $seen[$id] = true;
                $last = $id;
            }
            $pages++;
            $next = $payload['nextCursor'];
            if ($next !== null) {
                self::assertCount(50, $items);
                self::assertSame($last, $next);
                self::assertNotSame($cursor, $next, 'Cursor must advance');
            }

            if ($pages === 2) {
                // Changes occur BETWEEN genuine HTTP pages: neither a
                // transaction-wide snapshot nor cross-account mutation.
                // Ahead-of-frontier expired/archived rows must disappear.
                DB::table('media_files_v1')->where('id', self::id(6200))
                    ->update(['expires_at' => PhotoSync::nowMs() - 1000]);
                $this->archived(6000, 'archived');

                // Above cursor: keyset traversal must see both new rows.
                DB::table('media_files_v1')->insert([
                    $this->row(self::id(12_000), $this->owner, $this->ownerDevice),
                    $this->row(self::id(12_001), $this->owner, $this->ownerDevice),
                ]);
                // Below the already-visited cursor: cannot enter a
                // forward-only scan; this is documented keyset behavior.
                DB::table('media_files_v1')->insert(
                    $this->row(self::id(0), $this->owner, $this->ownerDevice)
                );
            }
            if ($next === null) break;
            self::assertLessThan(250, $pages, 'Cursor failed to terminate');
            $cursor = $next;
        }

        $excluded = array_fill_keys([111, 300, 6000, 6200, 7200, 9000], true);
        $expected = [];
        for ($n = 1; $n <= 10_055; $n++) {
            if (!isset($excluded[$n])) $expected[] = self::id($n);
        }
        $expected[] = self::id(12_000);
        $expected[] = self::id(12_001);
        self::assertCount(10_051, $expected);
        self::assertSame($expected, array_keys($seen), 'Lost/replayed/reordered rows');
        self::assertSame(202, $pages, 'Must traverse >200 REAL PG pages');

        $this->getJson('/media/v1?after=not-a-uuid')->assertStatus(422);
        // A second live authenticated account cannot see owner rows.
        $this->login($this->outsider, $this->outsiderDevice);
        $first = $this->getJson('/media/v1')->assertOk()->json();
        self::assertCount(50, $first['items']);
        self::assertSame(
            self::id(50, '9000'), $first['nextCursor']
        );
        foreach ($first['items'] as $item) {
            self::assertStringStartsWith('00000000-0000-4000-9000-', $item['mediaId']);
        }
        $second = $this->getJson(
            '/media/v1?after='.rawurlencode($first['nextCursor'])
        )->assertOk()->json();
        self::assertCount(27, $second['items']);
        self::assertNull($second['nextCursor']);
        foreach ($second['items'] as $item) {
            self::assertStringStartsWith('00000000-0000-4000-9000-', $item['mediaId']);
        }

        $elapsedMs = (int) round((microtime(true) - $start) * 1000);
        fwrite(STDOUT, 'PB3_QA_382_REAL_PG18 ' . json_encode([
            'realSeededRows' => 10_134,
            'ownerEnumeratedRows' => count($seen),
            'ownerPages' => $pages,
            'outsiderRows' => 77,
            'interPageExpiredAndArchived' => 2,
            'aheadInsertions' => 2,
            'behindFrontierInsertionNotEnumerated' => true,
            'privateIndexLeak' => false,
            'elapsedMs' => $elapsedMs,
        ], JSON_THROW_ON_ERROR) . PHP_EOL);
    }
}
