<?php

declare(strict_types=1);

namespace Tests\Feature\OperationalLimits;

use App\OperationalLimits\BackupAdmission;
use Carbon\CarbonImmutable;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;
use Tests\TestCase;

final class BackupAdmissionTest extends TestCase
{
    use RefreshDatabase;

    private BackupAdmission $admission;
    private string $accountId;

    protected function setUp(): void
    {
        parent::setUp();
        CarbonImmutable::setTestNow('2026-11-12 12:00:00 UTC');
        $this->admission = new BackupAdmission();
        $this->accountId = $this->account();
    }

    protected function tearDown(): void
    {
        CarbonImmutable::setTestNow();
        parent::tearDown();
    }

    private function account(string $status = 'ready'): string
    {
        $id = (string) Str::uuid();
        DB::table('identity_accounts')->insert([
            'id' => $id,
            'operation_id' => (string) Str::uuid(),
            'prepare_hash' => str_repeat('a', 64),
            'status' => $status,
            'reserved_until' => CarbonImmutable::now()->addDay(),
            'created_at' => CarbonImmutable::now(),
            'updated_at' => CarbonImmutable::now(),
        ]);

        return $id;
    }

    private function advance(int $seconds): void
    {
        CarbonImmutable::setTestNow(CarbonImmutable::now()->addSeconds($seconds));
    }

    public function test_reservation_is_idempotent_and_excludes_other_operations(): void
    {
        $a = (string) Str::uuid();
        $first = $this->admission->reserve($this->accountId, $a);
        self::assertTrue($first->allowed);
        self::assertSame(202, $first->httpStatus);
        self::assertSame('backup.reserved', $first->code);
        self::assertNotNull($first->leaseId);
        $again = $this->admission->reserve($this->accountId, $a);
        self::assertTrue($again->idempotent);
        self::assertSame($first->leaseId, $again->leaseId);
        self::assertSame($first->leaseExpiresAt, $again->leaseExpiresAt);

        $blocked = $this->admission->reserve($this->accountId, (string) Str::uuid());
        self::assertSame('backup.active', $blocked->code);
        self::assertSame(409, $blocked->httpStatus);
        self::assertSame(['Retry-After' => '900'], $blocked->headers());
        self::assertFalse($blocked->allowed);
        self::assertSame(1, DB::table('backup_start_operations_v1')
            ->whereIn('state', ['reserved', 'started'])->count());

        $canceled = $this->admission->finish($this->accountId, $a, $first->leaseId, false);
        self::assertSame('backup.canceled', $canceled->code);
        self::assertNull(DB::table('backup_start_operations_v1')
            ->where('operation_id', $a)->value('accepted_at'));
        self::assertTrue($this->admission->reserve($this->accountId, (string) Str::uuid())->allowed);
    }

    public function test_only_confirmed_start_consumes_exact_hour_cooldown(): void
    {
        $id = (string) Str::uuid();
        $reserve = $this->admission->reserve($this->accountId, $id);
        $start = $this->admission->confirmStart($this->accountId, $id, $reserve->leaseId);
        self::assertSame('backup.started', $start->code);
        self::assertSame(200, $start->httpStatus);
        self::assertTrue($this->admission->confirmStart($this->accountId, $id, $reserve->leaseId)->idempotent);
        self::assertSame('backup.completed',
            $this->admission->finish($this->accountId, $id, $reserve->leaseId, true)->code);
        self::assertTrue($this->admission->finish($this->accountId, $id, $reserve->leaseId, true)->idempotent);

        $blocked = $this->admission->reserve($this->accountId, (string) Str::uuid());
        self::assertSame('backup.cooldown', $blocked->code);
        self::assertSame(429, $blocked->httpStatus);
        self::assertSame('3600', $blocked->headers()['Retry-After']);
        $this->advance(3599);
        self::assertSame('1',
            $this->admission->reserve($this->accountId, (string) Str::uuid())->headers()['Retry-After']);
        $this->advance(1);
        self::assertTrue($this->admission->reserve($this->accountId, (string) Str::uuid())->allowed);
    }

    public function test_failed_confirmed_backup_releases_concurrency_not_technical_cooldown(): void
    {
        $id = (string) Str::uuid();
        $reserve = $this->admission->reserve($this->accountId, $id);
        $this->admission->confirmStart($this->accountId, $id, $reserve->leaseId);
        $done = $this->admission->finish($this->accountId, $id, $reserve->leaseId, false);
        self::assertSame('backup.failed', $done->code);
        self::assertSame('backup.cooldown',
            $this->admission->reserve($this->accountId, (string) Str::uuid())->code);
        self::assertSame('backup.operation_final', $this->admission->reserve($this->accountId, $id)->code);
        $this->advance(3600);
        self::assertTrue($this->admission->reserve($this->accountId, (string) Str::uuid())->allowed);
    }

    public function test_abandoned_reservation_expires_without_consuming_cooldown(): void
    {
        $oldId = (string) Str::uuid();
        $old = $this->admission->reserve($this->accountId, $oldId);
        $this->advance(901);
        $newId = (string) Str::uuid();
        $new = $this->admission->reserve($this->accountId, $newId);
        self::assertTrue($new->allowed);
        self::assertSame('expired', DB::table('backup_start_operations_v1')
            ->where('operation_id', $oldId)->value('state'));
        self::assertSame('backup.lease_expired',
            $this->admission->confirmStart($this->accountId, $oldId, $old->leaseId)->code);
        self::assertSame('backup.reserved', $this->admission->reserve($this->accountId, $newId)->code);
        self::assertSame($new->leaseId, $this->admission->reserve($this->accountId, $newId)->leaseId);
    }

    public function test_crashed_worker_expires_but_accepted_start_still_consumes_interval(): void
    {
        $id = (string) Str::uuid();
        $reserved = $this->admission->reserve($this->accountId, $id);
        $this->admission->confirmStart($this->accountId, $id, $reserved->leaseId);
        $this->advance(901);
        self::assertSame('backup.cooldown',
            $this->admission->reserve($this->accountId, (string) Str::uuid())->code);
        self::assertSame('backup.lease_expired',
            $this->admission->heartbeat($this->accountId, $id, $reserved->leaseId)->code);
        $this->advance(2699);
        self::assertTrue($this->admission->reserve($this->accountId, (string) Str::uuid())->allowed);
    }

    public function test_heartbeat_keeps_one_worker_active_and_stale_finish_cannot_release_another(): void
    {
        $id = (string) Str::uuid();
        $reserved = $this->admission->reserve($this->accountId, $id);
        $this->admission->confirmStart($this->accountId, $id, $reserved->leaseId);
        $this->advance(600);
        $extended = $this->admission->heartbeat($this->accountId, $id, $reserved->leaseId);
        self::assertTrue($extended->allowed);
        $this->advance(600);
        self::assertSame('backup.active',
            $this->admission->reserve($this->accountId, (string) Str::uuid())->code);
        self::assertSame('backup.operation_conflict',
            $this->admission->finish($this->accountId, $id, (string) Str::uuid(), true)->code);
        self::assertSame('backup.started',
            $this->admission->reserve($this->accountId, $id)->code);
    }

    public function test_foreign_replay_invalid_ids_and_inactive_accounts_are_denied(): void
    {
        $foreign = $this->account();
        $id = (string) Str::uuid();
        $reservation = $this->admission->reserve($this->accountId, $id);
        self::assertSame('backup.operation_conflict',
            $this->admission->reserve($foreign, $id)->code);
        self::assertSame('backup.operation_conflict',
            $this->admission->confirmStart($foreign, $id, $reservation->leaseId)->code);
        self::assertSame('backup.invalid_operation',
            $this->admission->reserve('bad-account-id', $id)->code);
        self::assertSame('backup.account_unavailable',
            $this->admission->reserve((string) Str::uuid(), (string) Str::uuid())->code);
        $inactive = $this->account('reserved');
        self::assertSame('backup.account_inactive',
            $this->admission->reserve($inactive, (string) Str::uuid())->code);
    }

    public function test_operational_floor_remains_independent_of_product_plan_configuration(): void
    {
        config(['plans' => ['unlimited' => ['backup_limit' => null]],
            'operational_limits.backup.minimum_start_interval_seconds' => 1]);
        $id = (string) Str::uuid();
        $reserved = $this->admission->reserve($this->accountId, $id);
        $this->admission->confirmStart($this->accountId, $id, $reserved->leaseId);
        $this->admission->finish($this->accountId, $id, $reserved->leaseId, true);
        $this->advance(120);
        self::assertSame('3480',
            $this->admission->reserve($this->accountId, (string) Str::uuid())->headers()['Retry-After']);
        config(['operational_limits.backup.minimum_start_interval_seconds' => 7200]);
        self::assertSame('7080',
            $this->admission->reserve($this->accountId, (string) Str::uuid())->headers()['Retry-After']);
    }
}
