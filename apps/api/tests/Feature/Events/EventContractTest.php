<?php
declare(strict_types=1);

namespace Tests\Feature\Events;

use App\Events\EventAdmission;
use App\Events\EventConsumer;
use App\Events\EventEnvelope;
use App\Events\EventInboxLedger;
use InvalidArgumentException;
use PHPUnit\Framework\TestCase;

/**
 * In-memory fake represents a SERIALIZABLE transaction of a production ledger.
 * It deliberately does not claim persistence, cross-worker atomicity or an ACK
 * for any external effect.
 */
final class ContractLedger implements EventInboxLedger
{
    /** @var array<string,string> */
    private array $byEventId = [];
    /** @var array<string,int> */
    private array $lastRevision = [];
    /** @var array<string,string> */
    private array $byRevision = [];
    public int $calls = 0;

    public function admit(EventEnvelope $event): EventAdmission
    {
        $this->calls++;
        $eventKey = $event->accountId . ':' . $event->eventId;
        $digest = $event->fingerprint();
        if (isset($this->byEventId[$eventKey])) {
            return hash_equals($this->byEventId[$eventKey], $digest)
                ? EventAdmission::Duplicate : EventAdmission::Conflict;
        }
        $stream = $event->streamKey();
        $revisionKey = $stream . ':' . $event->revision;
        if (isset($this->byRevision[$revisionKey])) {
            return EventAdmission::Conflict;
        }
        $previous = $this->lastRevision[$stream] ?? 0;
        if ($event->revision <= $previous) {
            return EventAdmission::Conflict;
        }
        if ($event->revision !== $previous + 1) {
            return EventAdmission::Deferred; // Retried by caller after gaps resolve.
        }
        $this->byEventId[$eventKey] = $digest;
        $this->byRevision[$revisionKey] = $digest;
        $this->lastRevision[$stream] = $event->revision;
        return EventAdmission::Accepted;
    }
}

final class EventContractTest extends TestCase
{
    private const ACCOUNT_A = '11111111-1111-4111-8111-111111111111';
    private const ACCOUNT_B = '22222222-2222-4222-8222-222222222222';
    private const SUBJECT = '33333333-3333-4333-8333-333333333333';
    private const EVENT = '44444444-4444-4444-8444-444444444444';

    /** @return array<string,int|string> */
    private function valid(array $overrides = []): array
    {
        return array_replace([
            'schemaVersion' => 1,
            'eventId' => self::EVENT,
            'eventType' => 'MediaCommitted',
            'accountId' => self::ACCOUNT_A,
            'subjectType' => 'media',
            'subjectId' => self::SUBJECT,
            'occurredAtMs' => 1800000000000,
            'revision' => 1,
        ], $overrides);
    }

    public function test_strict_allowlist_accepts_exactly_supported_subject_types(): void
    {
        $types = [
            'AccountCreated' => 'account',
            'DeviceRevoked' => 'device',
            'AssignmentChanged' => 'assignment',
            'MediaCommitted' => 'media',
            'MediaExpired' => 'media',
            'GrantRevoked' => 'grant',
            'BackupVerified' => 'backup',
            'PanicIntentCreated' => 'panic_intent',
            'SubscriptionEntitlementChanged' => 'entitlement',
        ];
        foreach ($types as $type => $subject) {
            $input = $this->valid([
                'eventType' => $type,
                'subjectType' => $subject,
                'subjectId' => $type === 'AccountCreated'
                    ? self::ACCOUNT_A : self::SUBJECT,
            ]);
            $envelope = EventEnvelope::fromArray($input);
            self::assertSame($type, $envelope->eventType);
            self::assertSame($input, $envelope->jsonSerialize());
            self::assertMatchesRegularExpression('/^[a-f0-9]{64}$/D', $envelope->fingerprint());
        }
    }

    public function test_serialization_is_canonical_and_contains_no_secret_payload(): void
    {
        $event = EventEnvelope::fromArray($this->valid());
        $serialized = json_encode($event, JSON_THROW_ON_ERROR);
        $decoded = json_decode($serialized, true, 512, JSON_THROW_ON_ERROR);
        self::assertSame($this->valid(), $decoded);
        self::assertSame($event->fingerprint(), EventEnvelope::fromArray(
            array_reverse($this->valid(), true),
        )->fingerprint());
        foreach (['filename', 'gps', 'pin', 'RecoveryKey', 'ciphertext',
            'privateMetadata', 'payload', 'mediaBytes'] as $sensitive) {
            self::assertStringNotContainsString($sensitive, $serialized);
        }
        self::assertSame(
            self::ACCOUNT_A . ':media:' . self::SUBJECT,
            $event->streamKey(),
        );
    }

    public function test_rejects_extra_secret_fields_unknown_types_and_wrong_subject_kinds(): void
    {
        $bad = [
            ['filename' => 'private.jpg'],
            ['gps' => ['lat' => 42.2]],
            ['RecoveryKey' => 'secret'],
            ['payload' => ['message' => 'private']],
            ['mediaBytes' => 300],
            ['eventType' => 'UntrustedCustomEvent'],
            ['eventType' => 'MediaCaptured'], // not yet in v1 allowlist
            ['subjectType' => 'device'],
            ['schemaVersion' => 2],
            ['schemaVersion' => '1'],
            ['revision' => '1'],
            ['revision' => 0],
            ['revision' => PHP_INT_MAX],
            ['occurredAtMs' => '1800000000000'],
            ['occurredAtMs' => -1],
            ['occurredAtMs' => PHP_INT_MAX],
            ['eventId' => strtoupper('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa')],
            ['eventId' => 'not-a-uuid'],
            ['accountId' => 15],
            ['subjectId' => 'not-a-uuid'],
            ['eventType' => 'AccountCreated', 'subjectType' => 'account'],
        ];
        foreach ($bad as $mutation) {
            try {
                EventEnvelope::fromArray(array_replace($this->valid(), $mutation));
                self::fail('Unsafe event mutation was accepted: ' . json_encode(array_keys($mutation)));
            } catch (InvalidArgumentException $e) {
                self::assertSame('events.invalid_envelope', $e->getMessage());
            }
        }
        $missing = $this->valid();
        unset($missing['revision']);
        $this->expectExceptionMessage('events.invalid_envelope');
        EventEnvelope::fromArray($missing);
    }

    public function test_rejects_wrong_tenant_before_ledger_and_never_echoes_input(): void
    {
        $ledger = new ContractLedger();
        $consumer = new EventConsumer($ledger);
        self::assertSame(
            EventAdmission::Quarantined,
            $consumer->ingest($this->valid(), self::ACCOUNT_B),
        );
        self::assertSame(
            EventAdmission::Quarantined,
            $consumer->ingest($this->valid(['RecoveryKey' => 'SECRET']), self::ACCOUNT_A),
        );
        self::assertSame(EventAdmission::Quarantined, $consumer->ingest('PRIVATE', self::ACCOUNT_A));
        self::assertSame(EventAdmission::Quarantined, $consumer->ingest($this->valid(), 'bad'));
        self::assertSame(0, $ledger->calls);
        self::assertSame('quarantined', EventAdmission::Quarantined->value);
    }

    public function test_exact_replay_is_duplicate_but_mutated_event_id_is_conflict(): void
    {
        $ledger = new ContractLedger();
        $consumer = new EventConsumer($ledger);
        $input = $this->valid();
        self::assertSame(EventAdmission::Accepted, $consumer->ingest($input, self::ACCOUNT_A));
        self::assertSame(EventAdmission::Duplicate, $consumer->ingest($input, self::ACCOUNT_A));
        self::assertSame(EventAdmission::Conflict, $consumer->ingest(
            $this->valid(['occurredAtMs' => 1800000000001]),
            self::ACCOUNT_A,
        ));
        self::assertSame(EventAdmission::Conflict, $consumer->ingest(
            $this->valid(['eventId' => '55555555-5555-4555-8555-555555555555']),
            self::ACCOUNT_A,
        )); // different eventId, same tenant/subject/revision
    }

    public function test_out_of_order_events_defer_until_gap_is_filled(): void
    {
        $consumer = new EventConsumer(new ContractLedger());
        $second = $this->valid([
            'eventId' => '55555555-5555-4555-8555-555555555555', 'revision' => 2,
        ]);
        $third = $this->valid([
            'eventId' => '66666666-6666-4666-8666-666666666666', 'revision' => 3,
        ]);
        self::assertSame(EventAdmission::Deferred, $consumer->ingest($third, self::ACCOUNT_A));
        self::assertSame(EventAdmission::Deferred, $consumer->ingest($second, self::ACCOUNT_A));
        self::assertSame(EventAdmission::Accepted, $consumer->ingest($this->valid(), self::ACCOUNT_A));
        self::assertSame(EventAdmission::Accepted, $consumer->ingest($second, self::ACCOUNT_A));
        self::assertSame(EventAdmission::Accepted, $consumer->ingest($third, self::ACCOUNT_A));
        self::assertSame(EventAdmission::Duplicate, $consumer->ingest($third, self::ACCOUNT_A));
    }

    public function test_subject_and_tenant_streams_are_independent(): void
    {
        $consumer = new EventConsumer(new ContractLedger());
        $other = $this->valid([
            'accountId' => self::ACCOUNT_B,
            'eventId' => self::EVENT,
        ]);
        $otherSubject = $this->valid([
            'eventId' => '55555555-5555-4555-8555-555555555555',
            'subjectId' => '77777777-7777-4777-8777-777777777777',
        ]);
        self::assertSame(EventAdmission::Accepted, $consumer->ingest(
            $this->valid(), self::ACCOUNT_A,
        ));
        self::assertSame(EventAdmission::Accepted, $consumer->ingest(
            $other, self::ACCOUNT_B,
        ));
        self::assertSame(EventAdmission::Accepted, $consumer->ingest(
            $otherSubject, self::ACCOUNT_A,
        ));
    }

    public function test_no_dependency_on_plan_configuration_or_client_privileges(): void
    {
        $consumer = new EventConsumer(new ContractLedger());
        self::assertSame(
            EventAdmission::Accepted,
            $consumer->ingest($this->valid(), self::ACCOUNT_A),
        );
        // Plan IDs, operators, file scopes and prices are NOT accepted schema
        // extensions: there is no hidden entitlement or ACL bypass.
        foreach (['planId' => 'unlimited+', 'isAdmin' => true, 'scope' => 'original'] as $key => $value) {
            self::assertSame(
                EventAdmission::Quarantined,
                $consumer->ingest($this->valid([$key => $value]), self::ACCOUNT_A),
            );
        }
    }
}
