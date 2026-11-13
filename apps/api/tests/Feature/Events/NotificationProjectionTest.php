<?php
declare(strict_types=1);

namespace Tests\Feature\Events;

use App\Events\EventEnvelope;
use App\Events\NotificationProjection;
use PHPUnit\Framework\TestCase;
use RuntimeException;

final class NotificationProjectionTest extends TestCase
{
    private const ACCOUNT = '11111111-1111-4111-8111-111111111111';
    private const OTHER = '22222222-2222-4222-8222-222222222222';
    private const SUBJECT = '33333333-3333-4333-8333-333333333333';
    private const EVENT = '44444444-4444-4444-8444-444444444444';

    private function event(string $type, string $subjectType): EventEnvelope
    {
        return EventEnvelope::fromArray([
            'schemaVersion' => 1, 'eventId' => self::EVENT,
            'eventType' => $type, 'accountId' => self::ACCOUNT,
            'subjectType' => $subjectType, 'subjectId' => self::SUBJECT,
            'occurredAtMs' => 1800000000000, 'revision' => 1,
        ]);
    }

    public function test_rejects_cross_account_without_calling_acl(): void
    {
        $calls = 0;
        $result = NotificationProjection::project(
            $this->event('MediaCommitted', 'media'), self::OTHER,
            static function () use (&$calls): bool { $calls++; return true; },
        );
        self::assertNull($result);
        self::assertSame(0, $calls);
    }

    public function test_media_notification_requires_fresh_current_acl(): void
    {
        $event = $this->event('MediaCommitted', 'media');
        $calls = [];
        $acl = static function (string $account, string $type, string $id) use (&$calls): bool {
            $calls[] = [$account, $type, $id];
            return true;
        };
        self::assertSame([
            'id' => self::EVENT, 'kind' => 'new-file',
            'targetId' => self::SUBJECT, 'occurredAt' => 1800000000000,
        ], NotificationProjection::project($event, self::ACCOUNT, $acl));
        self::assertSame([[self::ACCOUNT, 'media', self::SUBJECT]], $calls);
        self::assertNull(NotificationProjection::project(
            $event, self::ACCOUNT, static fn (): bool => false,
        ));
        self::assertNull(NotificationProjection::project(
            $event, self::ACCOUNT,
            static function (): never { throw new RuntimeException('ACL unavailable'); },
        ));
    }

    public function test_expiry_also_requires_acl_and_never_exposes_private_content(): void
    {
        $value = NotificationProjection::project(
            $this->event('MediaExpired', 'media'), self::ACCOUNT,
            static fn (): bool => true,
        );
        self::assertSame('file-expiry', $value['kind']);
        self::assertSame(self::SUBJECT, $value['targetId']);
        self::assertSame(['id', 'kind', 'targetId', 'occurredAt'], array_keys($value));
        self::assertNull(NotificationProjection::project(
            $this->event('MediaExpired', 'media'), self::ACCOUNT,
            static fn (): bool => false,
        ));
    }

    public function test_non_navigable_security_backup_and_subscription_are_generic(): void
    {
        foreach ([
            ['DeviceRevoked', 'device', 'security'],
            ['GrantRevoked', 'grant', 'security'],
            ['PanicIntentCreated', 'panic_intent', 'security'],
            ['BackupVerified', 'backup', 'backup'],
            ['SubscriptionEntitlementChanged', 'entitlement', 'subscription'],
        ] as [$type, $subjectType, $kind]) {
            $candidate = NotificationProjection::project(
                $this->event($type, $subjectType), self::ACCOUNT,
                static function (): never { throw new RuntimeException('not called'); },
            );
            self::assertSame($kind, $candidate['kind']);
            self::assertNull($candidate['targetId']);
            self::assertSame(self::EVENT, $candidate['id']);
        }
    }

    public function test_generic_assignment_change_cannot_forge_invite_or_deadline(): void
    {
        self::assertNull(NotificationProjection::project(
            $this->event('AssignmentChanged', 'assignment'), self::ACCOUNT,
            static fn (): bool => true,
        ));
    }
}
