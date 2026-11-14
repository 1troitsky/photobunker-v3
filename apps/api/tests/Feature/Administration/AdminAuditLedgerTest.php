<?php
declare(strict_types=1);

namespace Tests\Feature\Administration;

use App\Administration\AdminAuditLedger;
use App\Administration\AdminPrincipal;
use DomainException;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;
use Tests\TestCase;

final class AdminAuditLedgerTest extends TestCase
{
    use RefreshDatabase;

    private const EVENTS = 'admin_audit_records_v1';
    private const HEADS = 'admin_audit_heads_v1';
    private const ZERO = '0000000000000000000000000000000000000000000000000000000000000000';

    private function principal(
        string $role = 'owner',
        ?int $mfaAt = null,
        ?int $expiresAt = null,
        ?string $id = null,
    ): AdminPrincipal {
        $now = (int) now()->getTimestampMs();
        return new AdminPrincipal(
            $id ?? (string) Str::uuid(),
            $role,
            $expiresAt ?? ($now + 3_600_000),
            $mfaAt ?? ($now - 1_000),
        );
    }

    /** @return array{state:string,operationId:string,digest:string,replay:bool} */
    private function record(
        ?AdminPrincipal $actor = null,
        ?string $operationId = null,
        string $action = 'grants.issue',
        ?string $target = null,
        ?int $expiresAt = null,
        string $reason = 'approved_trial',
        string $type = 'account',
    ): array {
        return (new AdminAuditLedger())->record(
            $actor ?? $this->principal(),
            $operationId ?? (string) Str::uuid(),
            $action,
            $type,
            $target ?? (string) Str::uuid(),
            $reason,
            $expiresAt ?? ((int) now()->getTimestampMs() + 86_400_000),
        );
    }

    private function deny(callable $work): void
    {
        try {
            $work();
            self::fail('Admin audit failed open');
        } catch (DomainException $error) {
            self::assertContains($error->getMessage(), [
                'admin.access_denied',
                'admin.audit_denied',
                'admin.audit_inconsistent',
            ]);
        }
    }

    public function test_empty_migrated_ledger_is_consistent_and_has_no_actions(): void
    {
        self::assertSame([
            'state' => 'database_consistent_only',
            'count' => 0,
            'lastDigest' => self::ZERO,
        ], (new AdminAuditLedger())->verifyChain());
        $this->assertDatabaseCount(self::EVENTS, 0);
        $this->assertDatabaseHas(self::HEADS, [
            'id' => 1, 'revision' => 0, 'last_digest' => self::ZERO,
        ]);
    }

    public function test_owner_records_a_versioned_privacy_safe_immutable_proposal_only(): void
    {
        $actor = $this->principal('owner');
        $operation = (string) Str::uuid();
        $target = (string) Str::uuid();
        $deadline = (int) now()->getTimestampMs() + 86_400_000;

        $result = $this->record($actor, $operation, 'grants.issue', $target, $deadline);
        self::assertSame(['state','operationId','digest','replay'], array_keys($result));
        self::assertSame('recorded_only', $result['state']);
        self::assertSame($operation, $result['operationId']);
        self::assertFalse($result['replay']);
        self::assertMatchesRegularExpression('/^[a-f0-9]{64}$/D', $result['digest']);

        $row = DB::table(self::EVENTS)->where('operation_id', $operation)->first();
        self::assertNotNull($row);
        $data = json_decode($row->event_json, true, 16, JSON_THROW_ON_ERROR);
        self::assertSame(1, $data['version']);
        self::assertSame('grants.issue', $data['action']);
        self::assertSame('approved_trial', $data['reasonCode']);
        self::assertSame($target, $data['targetReference']);
        self::assertSame(self::ZERO, $data['previousDigest']);
        self::assertSame($result['digest'], $data['digest']);
        self::assertSame($deadline, $data['expiresAtMs']);
        self::assertArrayNotHasKey('before', $data);
        self::assertArrayNotHasKey('after', $data);
        self::assertArrayNotHasKey('accessToken', $data);
        self::assertArrayNotHasKey('recoveryKey', $data);
        self::assertArrayNotHasKey('deviceSecret', $data);
        self::assertEquals([
            'state' => 'database_consistent_only',
            'count' => 1,
            'lastDigest' => $result['digest'],
        ], (new AdminAuditLedger())->verifyChain());

        $replay = $this->record($actor, $operation, 'grants.issue', $target, $deadline);
        self::assertSame($result + ['replay' => true], $result);
        self::assertSame($result['digest'], $replay['digest']);
        self::assertTrue($replay['replay']);
        $this->assertDatabaseCount(self::EVENTS, 1);
        $this->assertDatabaseHas(self::HEADS, ['id' => 1, 'revision' => 1]);
        self::assertEquals($row, DB::table(self::EVENTS)->where('operation_id', $operation)->first());
    }

    public function test_independent_actors_append_globally_serialized_hash_linked_events(): void
    {
        $one = $this->principal('auditor');
        $two = $this->principal('owner');
        $a = (new AdminAuditLedger())->record(
            $one, (string) Str::uuid(), 'analytics.read', 'system',
            'analytics', 'health_check', null,
        );
        $b = $this->record($two);
        self::assertNotSame($a['digest'], $b['digest']);
        $events = DB::table(self::EVENTS)->orderBy('sequence')->get();
        self::assertCount(2, $events);
        self::assertSame(self::ZERO, $events[0]->previous_digest);
        self::assertSame($a['digest'], $events[1]->previous_digest);
        self::assertSame($b['digest'], $events[1]->digest);
        self::assertSame([
            'state' => 'database_consistent_only',
            'count' => 2,
            'lastDigest' => $b['digest'],
        ], (new AdminAuditLedger())->verifyChain());
    }

    public function test_operation_id_collision_or_changed_replay_never_overwrites_first_event(): void
    {
        $actor = $this->principal('owner');
        $other = $this->principal('owner');
        $op = (string) Str::uuid();
        $target = (string) Str::uuid();
        $deadline = (int) now()->getTimestampMs() + 86_400_000;
        $saved = $this->record($actor, $op, 'grants.issue', $target, $deadline);
        $original = DB::table(self::EVENTS)->first();
        $this->deny(fn() => $this->record($other, $op, 'grants.issue', $target, $deadline));
        $this->deny(fn() => $this->record($actor, $op, 'grants.issue', (string) Str::uuid(), $deadline));
        $this->deny(fn() => $this->record($actor, $op, 'grants.issue', $target, $deadline + 1));
        $this->deny(fn() => $this->record($actor, $op, 'grants.issue', $target, $deadline, 'another_reason'));
        $this->assertDatabaseCount(self::EVENTS, 1);
        self::assertEquals($original, DB::table(self::EVENTS)->first());
        self::assertSame($saved['digest'], (new AdminAuditLedger())->verifyChain()['lastDigest']);
    }

    public function test_invalid_role_mfa_or_expired_grant_is_denied_even_for_replay(): void
    {
        $now = (int) now()->getTimestampMs();
        $auditor = $this->principal('auditor');
        $this->deny(fn() => $this->record($auditor));
        $this->deny(fn() => $this->record($this->principal('owner', $now - 301_000)));
        $this->deny(fn() => $this->record($this->principal('owner', $now + 1_000)));
        $this->deny(fn() => $this->record($this->principal('owner', $now - 1_000, $now - 1)));
        $this->deny(fn() => $this->record($this->principal('operator')));

        $actor = $this->principal('owner');
        $op = (string) Str::uuid();
        $target = (string) Str::uuid();
        $deadline = $now + 86_400_000;
        $this->record($actor, $op, 'grants.issue', $target, $deadline);
        $expiredMfa = $this->principal('owner', $now - 301_000, $now + 3_600_000, $actor->accountId);
        $this->deny(fn() => $this->record($expiredMfa, $op, 'grants.issue', $target, $deadline));
        $this->assertDatabaseCount(self::EVENTS, 1);
    }

    public function test_rejects_arbitrary_secret_bearing_targets_or_unsafe_reason_text(): void
    {
        $actor = $this->principal('owner');
        foreach ([
            ['grants.issue','account','not-a-uuid','safe_request'],
            ['grants.issue','account',(string) Str::uuid(),'PIN 1234 recovery phrase'],
            ['analytics.read','system','private_files','safe_request'],
            ['ip.block','ip_digest','192.168.1.1','safe_request'],
            ['ip.block','ip_digest','x'.repeat(64),'safe_request'],
        ] as [$action,$type,$target,$reason]) {
            $this->deny(fn() => $this->record(
                $actor, (string) Str::uuid(), $action,
                $target, (int) now()->getTimestampMs() + 86_400_000,
                $reason, $type,
            ));
        }
        $this->assertDatabaseCount(self::EVENTS, 0);
    }

    public function test_temporary_action_ttl_limits_are_enforced_by_existing_admin_policy(): void
    {
        $actor = $this->principal('owner');
        $now = (int) now()->getTimestampMs();
        $target = (string) Str::uuid();
        foreach ([$now - 1, $now, $now + 366 * 86_400_000] as $deadline) {
            $this->deny(fn() => $this->record(
                $actor, (string) Str::uuid(), 'grants.issue', $target, $deadline,
            ));
        }
        $this->deny(fn() => $this->record(
            $actor, (string) Str::uuid(), 'accounts.suspend',
            $target, $now + 91 * 86_400_000,
        ));
        $this->assertDatabaseCount(self::EVENTS, 0);
    }

    public function test_corrupt_stored_event_or_digest_denies_consistency_and_further_append(): void
    {
        $this->record();
        $original = (array) DB::table(self::EVENTS)->first();
        foreach ([
            ['event_json' => '{}'],
            ['digest' => str_repeat('f', 64)],
            ['previous_digest' => str_repeat('1', 64)],
            ['reason_code' => 'tampered_reason'],
        ] as $patch) {
            DB::table(self::EVENTS)->update($patch);
            $this->deny(fn() => (new AdminAuditLedger())->verifyChain());
            $this->deny(fn() => $this->record());
            DB::table(self::EVENTS)->update($original);
        }
        self::assertSame(1, (new AdminAuditLedger())->verifyChain()['count']);
        $this->assertDatabaseCount(self::EVENTS, 1);
    }

    public function test_missing_last_record_or_corrupt_head_fails_closed(): void
    {
        $this->record();
        DB::table(self::HEADS)->where('id', 1)->update(['last_digest' => str_repeat('a', 64)]);
        $this->deny(fn() => (new AdminAuditLedger())->verifyChain());
        $this->deny(fn() => $this->record());
        DB::table(self::HEADS)->where('id', 1)->update([
            'last_digest' => DB::table(self::EVENTS)->first()->digest,
        ]);
        DB::table(self::EVENTS)->delete(); // test-only, not a product capability
        $this->deny(fn() => (new AdminAuditLedger())->verifyChain());
        $this->deny(fn() => $this->record());
    }
}
