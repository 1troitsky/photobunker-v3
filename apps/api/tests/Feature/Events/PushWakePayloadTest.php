<?php
declare(strict_types=1);

namespace Tests\Feature\Events;

use App\Events\EventEnvelope;
use App\Events\PushWakePayload;
use InvalidArgumentException;
use PHPUnit\Framework\TestCase;

final class PushWakePayloadTest extends TestCase
{
    public function test_every_event_type_has_exactly_the_same_non_sensitive_wake_body(): void
    {
        $body = PushWakePayload::body();
        self::assertSame('{"v":1,"action":"check-inbox"}', $body);
        self::assertSame(['v'=>1,'action'=>'check-inbox'], PushWakePayload::decode($body));
        self::assertLessThan(64, strlen($body));
        $types = [
            ['DeviceRevoked','device'], ['PanicIntentCreated','panic_intent'],
            ['AssignmentChanged','assignment'], ['MediaExpired','media'],
            ['MediaCommitted','media'], ['BackupVerified','backup'],
        ];
        foreach ($types as [$type,$subjectType]) {
            $event = EventEnvelope::fromArray([
                'schemaVersion'=>1,
                'eventId'=>'44444444-4444-4444-8444-444444444444',
                'eventType'=>$type,
                'accountId'=>'11111111-1111-4111-8111-111111111111',
                'subjectType'=>$subjectType,
                'subjectId'=>'33333333-3333-4333-8333-333333333333',
                'occurredAtMs'=>1800000000000,
                'revision'=>1,
            ]);
            self::assertSame($body, PushWakePayload::body());
            foreach ([
                $event->eventId,$event->accountId,$event->subjectId,
                $event->subjectType,$event->eventType,
                'Recovery Key','filename','gps','targetId','encryptedEnvelope',
            ] as $forbidden) {
                self::assertStringNotContainsString($forbidden, $body);
            }
        }
    }

    /**
     * Source #296 also changed the shared EventEnvelope allowlist. This
     * isolated integration MUST NOT silently widen that contract: future
     * invitation/retention producer types stay fail-closed until separately
     * claimed, audited and accepted with their real server authentication.
     */
    public function test_unintegrated_future_producer_event_types_remain_rejected(): void
    {
        $notYetAuthorized = [
            ['AssignmentInvitationCreated','assignment_invite'],
            ['TeamEpochInvitationCreated','team_invite_v2'],
            ['TeamInitialInvitationCreated','team_invite_v1'],
            ['MediaRetentionExpired','media_retention'],
        ];

        foreach ($notYetAuthorized as [$type, $subjectType]) {
            try {
                EventEnvelope::fromArray([
                    'schemaVersion' => 1,
                    'eventId' => '44444444-4444-4444-8444-444444444444',
                    'eventType' => $type,
                    'accountId' => '11111111-1111-4111-8111-111111111111',
                    'subjectType' => $subjectType,
                    'subjectId' => '33333333-3333-4333-8333-333333333333',
                    'occurredAtMs' => 1800000000000,
                    'revision' => 1,
                ]);
                self::fail('Unintegrated event type was accepted: '.$type);
            } catch (InvalidArgumentException $exception) {
                self::assertSame('events.invalid_envelope', $exception->getMessage());
            }
        }
    }

    public function test_rejects_all_unapproved_payloads_and_extensions(): void
    {
        foreach ([
            '',
            '{}',
            '{"v":1,"action":"open-file"}',
            '{"v":1,"action":"check-inbox","eventId":"private"}',
            '{"action":"check-inbox","v":1}',
            '{"v":2,"action":"check-inbox"}',
            'null',
        ] as $payload) {
            try {
                PushWakePayload::decode($payload);
                self::fail('Unapproved push body was accepted');
            } catch (InvalidArgumentException $exception) {
                self::assertSame('notifications.push.invalid_payload', $exception->getMessage());
            }
        }
    }
}
