<?php
declare(strict_types=1);

namespace Tests\Integration;

use App\Events\EventAdmission;
use App\Events\EventConsumer;
use App\Events\EventEnvelope;
use App\Events\PostgresEventInboxLedger;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\DB;
use PDO;
use RuntimeException;
use Tests\TestCase;

/**
 * P1 #406: only runs on a disposable real PostgreSQL 18 GitHub runner.
 * NEVER migrate, truncate or use a non-test/non-disposable database.
 */
final class PostgresEventInboxLedgerChatAITest extends TestCase
{
    use RefreshDatabase;

    private const A = '11111111-1111-4111-8111-111111111111';
    private const B = '22222222-2222-4222-8222-222222222222';
    private const SUBJECT = '33333333-3333-4333-8333-333333333333';

    protected function setUp(): void
    {
        // Fail before parent::setUp invokes RefreshDatabase migrations.
        foreach ([
            'GITHUB_ACTIONS' => 'true',
            'PB3_EVENT_INBOX_QA' => '1',
            'APP_ENV' => 'testing',
            'DB_CONNECTION' => 'pgsql',
            'DB_HOST' => '127.0.0.1',
            'DB_DATABASE' => 'pb3_ci_p1_events_406',
        ] as $name => $expected) {
            if (getenv($name) !== $expected) {
                throw new RuntimeException('QA406 refuses non-disposable database: '.$name);
            }
        }
        parent::setUp();
        self::assertSame('pgsql', DB::getDriverName());
        self::assertSame('pb3_ci_p1_events_406', DB::getDatabaseName());
        self::assertTrue(DB::getSchemaBuilder()->hasTable('event_inbox_receipts_v1'));
    }

    private static function id(int $n, string $prefix = '40000000'): string
    {
        return sprintf('%s-0000-4000-8000-%012x', $prefix, $n);
    }

    /** @return array<string,int|string> */
    private static function input(int $revision = 1, array $overrides = []): array
    {
        return array_replace([
            'schemaVersion' => 1,
            'eventId' => self::id($revision),
            'eventType' => 'MediaCommitted',
            'accountId' => self::A,
            'subjectType' => 'media',
            'subjectId' => self::SUBJECT,
            'occurredAtMs' => 1800000000000,
            'revision' => $revision,
        ], $overrides);
    }

    private static function event(int $revision = 1, array $overrides = []): EventEnvelope
    {
        return EventEnvelope::fromArray(self::input($revision, $overrides));
    }

    public function test_real_postgres_durable_replay_conflicts_and_tenant_scope(): void
    {
        $consumer = new EventConsumer(new PostgresEventInboxLedger());
        $valid = self::input();
        self::assertSame(EventAdmission::Quarantined, $consumer->ingest($valid, self::B));
        self::assertSame(EventAdmission::Quarantined, $consumer->ingest(
            self::input(1, ['privateGps' => 'SECRET_DO_NOT_PERSIST']), self::A
        ));
        self::assertSame(0, DB::table('event_inbox_receipts_v1')->count());

        self::assertSame(EventAdmission::Accepted, $consumer->ingest($valid, self::A));
        // A fresh service object sees the same persisted receipt; no in-memory ACK.
        $fresh = new EventConsumer(new PostgresEventInboxLedger(DB::connection()));
        self::assertSame(EventAdmission::Duplicate, $fresh->ingest($valid, self::A));
        self::assertSame(EventAdmission::Conflict, $fresh->ingest(
            self::input(1, ['occurredAtMs' => 1800000000001]), self::A
        ));
        self::assertSame(EventAdmission::Conflict, $fresh->ingest(
            self::input(1, ['eventId' => self::id(11)]), self::A
        ));
        self::assertSame(EventAdmission::Conflict, $fresh->ingest(
            self::input(1, [
                'subjectId' => self::id(12),
                'eventId' => self::id(1),
            ]), self::A
        ));

        // Same eventId and subject revision on a DIFFERENT trusted tenant is
        // independent; the database keys are scoped by account_id.
        self::assertSame(EventAdmission::Accepted, $fresh->ingest(
            self::input(1, ['accountId' => self::B]), self::B
        ));
        self::assertSame(2, DB::table('event_inbox_receipts_v1')->count());

        $row = DB::table('event_inbox_receipts_v1')->where('account_id', self::A)->first();
        self::assertNotNull($row);
        self::assertSame(self::event()->fingerprint(), $row->fingerprint);
        self::assertSame('accepted', $row->admission_state);
        self::assertSame(
            ['account_id', 'event_id', 'subject_id', 'subject_type', 'event_type',
             'schema_version', 'revision', 'occurred_at_ms', 'fingerprint',
             'admission_state', 'created_at', 'updated_at'],
            array_keys((array) $row)
        );
        self::assertStringNotContainsString(
            'SECRET_DO_NOT_PERSIST', json_encode((array) $row, JSON_THROW_ON_ERROR)
        );
    }

    public function test_out_of_order_receipts_persist_without_false_ack_until_exact_replay(): void
    {
        $ledger = new PostgresEventInboxLedger();
        self::assertSame(EventAdmission::Deferred, $ledger->admit(self::event(3)));
        self::assertSame(EventAdmission::Deferred, $ledger->admit(self::event(2)));
        self::assertSame(EventAdmission::Deferred, $ledger->admit(self::event(2)));

        $pending = DB::table('event_inbox_receipts_v1')
            ->where('account_id', self::A)->where('admission_state', 'deferred')
            ->count();
        self::assertSame(2, $pending);
        self::assertSame(EventAdmission::Conflict, $ledger->admit(
            self::event(3, ['eventId' => self::id(30)])
        ));

        self::assertSame(EventAdmission::Accepted, $ledger->admit(self::event(1)));
        // No subscriber processing or automatic promotion is claimed here.
        self::assertSame('deferred', DB::table('event_inbox_receipts_v1')
            ->where('event_id', self::id(2))->value('admission_state'));
        self::assertSame(EventAdmission::Deferred, $ledger->admit(self::event(3)));
        self::assertSame(EventAdmission::Accepted, $ledger->admit(self::event(2)));
        self::assertSame(EventAdmission::Accepted, $ledger->admit(self::event(3)));
        self::assertSame(EventAdmission::Duplicate, $ledger->admit(self::event(3)));
        self::assertSame(3, DB::table('event_inbox_receipts_v1')
            ->where('account_id', self::A)->where('admission_state', 'accepted')
            ->count());
        self::assertSame(0, DB::table('event_inbox_receipts_v1')
            ->where('admission_state', 'deferred')->count());
    }

    public function test_bounded_deferred_backlog_is_persistent_and_fail_closed(): void
    {
        $ledger = new PostgresEventInboxLedger();
        self::assertSame(EventAdmission::Quarantined, $ledger->admit(self::event(66)));
        self::assertSame(0, DB::table('event_inbox_receipts_v1')->count());
        // 512 independent subjects, all at revision 2: bounded tenant queue.
        for ($n = 1; $n <= 512; $n++) {
            self::assertSame(EventAdmission::Deferred, $ledger->admit(
                self::event(2, [
                    'eventId' => self::id($n, '50000000'),
                    'subjectId' => self::id($n, '60000000'),
                ])
            ));
        }
        self::assertSame(EventAdmission::Quarantined, $ledger->admit(
            self::event(2, [
                'eventId' => self::id(513, '50000000'),
                'subjectId' => self::id(513, '60000000'),
            ])
        ));
        self::assertSame(512, DB::table('event_inbox_receipts_v1')->count());
        // A missing predecessor can still be admitted, despite a full backlog.
        self::assertSame(EventAdmission::Accepted, $ledger->admit(
            self::event(1, [
                'eventId' => self::id(1024, '50000000'),
                'subjectId' => self::id(1, '60000000'),
            ])
        ));
        self::assertSame(EventAdmission::Accepted, $ledger->admit(
            self::event(2, [
                'eventId' => self::id(1, '50000000'),
                'subjectId' => self::id(1, '60000000'),
            ])
        ));
    }

    public function test_two_real_pg_sessions_contend_on_same_account_but_not_other_accounts(): void
    {
        // PostgreSQL advisory locking is proven on two independent socket
        // connections. No fixture changes to production or fake mutexes.
        $first = DB::connection()->getPdo();
        $second = new PDO(
            'pgsql:host=127.0.0.1;port=5432;dbname=pb3_ci_p1_events_406',
            (string) getenv('DB_USERNAME'), (string) getenv('DB_PASSWORD'),
            [PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION]
        );
        $lockKey = 'pb3.event-inbox.v1.'.self::A;
        $firstStmt = $first->prepare('SELECT pg_advisory_lock(hashtextextended(?, 0))');
        $release = $first->prepare('SELECT pg_advisory_unlock(hashtextextended(?, 0))');
        $try = $second->prepare('SELECT CASE WHEN pg_try_advisory_xact_lock(hashtextextended(?, 0)) THEN 1 ELSE 0 END');
        $firstStmt->execute([$lockKey]);
        try {
            $second->beginTransaction();
            $try->execute([$lockKey]);
            self::assertSame(0, (int) $try->fetchColumn());
            $try->execute(['pb3.event-inbox.v1.'.self::B]);
            self::assertSame(1, (int) $try->fetchColumn());
            $second->rollBack();
        } finally {
            if ($second->inTransaction()) $second->rollBack();
            $release->execute([$lockKey]);
        }

        $ledger = new PostgresEventInboxLedger(DB::connection());
        self::assertSame(EventAdmission::Accepted, $ledger->admit(self::event()));
        self::assertSame(EventAdmission::Duplicate, $ledger->admit(self::event()));
        fwrite(STDOUT, 'PB3_QA_406_REAL_PG18 ' . json_encode([
            'durableAccountReceipts' => true,
            'twoIndependentPgConnections' => true,
            'accountMutexContended' => true,
            'foreignTenantNotLocked' => true,
            'plaintextStored' => false,
            'subscriberDeliveryVerified' => false,
        ], JSON_THROW_ON_ERROR) . PHP_EOL);
    }
}
