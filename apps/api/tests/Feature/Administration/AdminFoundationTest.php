<?php
declare(strict_types=1);

namespace Tests\Feature\Administration;

use App\Administration\AdminAuditEntry;
use App\Administration\AdminPolicy;
use App\Administration\AdminPrincipal;
use PHPUnit\Framework\TestCase;

final class AdminFoundationTest extends TestCase
{
    private const OWNER = '11111111-1111-4111-8111-111111111111';
    private const TARGET = '22222222-2222-4222-8222-222222222222';
    private const OP = '33333333-3333-4333-8333-333333333333';
    private const NOW = 1800000000000;

    private function actor(string $role='owner', ?int $mfa=self::NOW, int $expires=self::NOW+60000):AdminPrincipal
    {
        return new AdminPrincipal(self::OWNER, $role, $expires, $mfa);
    }

    public function test_allows_only_explicit_role_permissions_and_authenticated_mfa():void
    {
        AdminPolicy::requireAllowed($this->actor('auditor'), 'analytics.read', self::NOW);
        AdminPolicy::requireAllowed($this->actor('operator'), 'accounts.suspend', self::NOW);
        AdminPolicy::requireAllowed($this->actor('operator'), 'devices.revoke', self::NOW);
        AdminPolicy::requireAllowed($this->actor('owner'), 'roles.change', self::NOW);

        foreach ([
            [null, 'analytics.read'],
            [$this->actor('auditor'), 'accounts.suspend'],
            [$this->actor('operator'), 'roles.change'],
            [$this->actor('operator'), 'grants.issue'],
            [$this->actor('owner'), 'crypto.decrypt'],
            [$this->actor('owner'), 'accounts.read_plaintext'],
        ] as [$actor,$permission]) {
            try {
                AdminPolicy::requireAllowed($actor, $permission, self::NOW);
                self::fail('Unknown or unauthorized permission was granted: '.$permission);
            } catch (\DomainException $e) {
                self::assertSame('admin.access_denied', $e->getMessage());
            }
        }
    }

    public function test_rejects_expired_missing_stale_and_future_mfa():void
    {
        foreach ([
            $this->actor('owner',null),
            $this->actor('owner',self::NOW-300001),
            $this->actor('owner',self::NOW+1),
            $this->actor('owner',self::NOW,self::NOW),
        ] as $actor) {
            try {
                AdminPolicy::requireAllowed($actor, 'grants.issue', self::NOW);
                self::fail('Invalid MFA or expired session was accepted');
            } catch (\DomainException $e) {
                self::assertSame('admin.access_denied', $e->getMessage());
            }
        }
        AdminPolicy::requireAllowed($this->actor('owner', self::NOW-300000),
            'grants.issue', self::NOW);
    }

    public function test_rejects_unknown_roles_and_invalid_principals():void
    {
        $this->expectException(\InvalidArgumentException::class);
        new AdminPrincipal(self::OWNER, 'superuser', self::NOW+1, self::NOW);
    }

    public function test_drafts_strict_safe_audit_with_stable_digest():void
    {
        $entry=AdminAuditEntry::draft($this->actor(), self::OP,
            'accounts.suspend', 'account', self::TARGET, 'abuse_report',
            self::NOW, self::NOW+60000, str_repeat('0',64));
        $other=AdminAuditEntry::draft($this->actor(), self::OP,
            'accounts.suspend', 'account', self::TARGET, 'abuse_report',
            self::NOW, self::NOW+60000, str_repeat('0',64));

        self::assertMatchesRegularExpression('/^[a-f0-9]{64}$/D', $entry->digest);
        self::assertSame($entry->digest,$other->digest);
        self::assertSame(self::OP,$entry->operationId);
        $serialized=json_encode($entry,JSON_THROW_ON_ERROR);
        self::assertStringNotContainsString('password',$serialized);
        self::assertStringNotContainsString('gps',$serialized);
        self::assertStringNotContainsString('recoveryKey',$serialized);
        self::assertStringContainsString('abuse_report',$serialized);
        self::assertCount(11,$entry->jsonSerialize());
        self::assertNotSame($entry->digest,AdminAuditEntry::draft($this->actor(),self::OP,
            'accounts.suspend','account',self::TARGET,'abuse_report',
            self::NOW,self::NOW+60000,str_repeat('a',64))->digest);
    }

    public function test_ip_audit_uses_only_digest_not_plain_ip():void
    {
        $entry=AdminAuditEntry::draft($this->actor('operator'),self::OP,
            'ip.block','ip_digest',hash('sha256','192.0.2.4'),'abuse_report',
            self::NOW,self::NOW+60000,str_repeat('0',64));
        self::assertSame('ip_digest',$entry->targetType);
        self::assertStringNotContainsString('192.0.2.4',
            json_encode($entry,JSON_THROW_ON_ERROR));
    }

    public function test_rejects_invalid_target_plain_ip_freeform_reason_and_expiry():void
    {
        $base=[$this->actor(),self::OP,'accounts.suspend','account',
            self::TARGET,'abuse_report',self::NOW,self::NOW+60000,str_repeat('0',64)];
        $bad=[
            [3,'file'],
            [4,'/photos/private/name.jpg'],
            [5,'Private user reason with GPS 192.0.2.4'],
            [6,-1],
            [7,null],
            [7,self::NOW+91*24*60*60*1000],
            [1,'not-a-uuid'],
        ];
        foreach($bad as [$index,$value]){
            $args=$base;
            $args[$index]=$value;
            try {
                AdminAuditEntry::draft(...$args);
                self::fail('Unsafe audit input accepted at '.$index);
            } catch (\InvalidArgumentException $e) {
                self::assertContains($e->getMessage(),
                    ['admin.invalid_audit','admin.invalid_expiry']);
            } catch (\TypeError $e) {
                self::assertSame(6,$index);
            }
        }
    }

    public function test_cannot_draft_privileged_audit_without_admin_role():void
    {
        $this->expectExceptionMessage('admin.access_denied');
        AdminAuditEntry::draft($this->actor('auditor'),self::OP,
            'grants.issue','account',self::TARGET,'temporary_grant',
            self::NOW,self::NOW+60000,str_repeat('0',64));
    }

    public function test_no_expiry_for_permanent_actions_and_expiry_required_for_grants():void
    {
        $roleChange=AdminAuditEntry::draft($this->actor(),self::OP,
            'roles.change','account',self::TARGET,'staff_change',
            self::NOW,null,str_repeat('0',64));
        self::assertNull($roleChange->expiresAtMs);

        $this->expectExceptionMessage('admin.invalid_expiry');
        AdminAuditEntry::draft($this->actor(),self::OP,
            'grants.issue','account',self::TARGET,'trial_access',
            self::NOW,null,str_repeat('0',64));
    }
}
