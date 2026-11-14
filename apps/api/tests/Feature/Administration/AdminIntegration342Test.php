<?php
declare(strict_types=1);

namespace Tests\Feature\Administration;

use App\Administration\AdminPolicy;
use App\Administration\AdminPrincipal;
use DomainException;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\DB;
use Tests\TestCase;

/**
 * P3 #342: integrated audit + internal grant/restriction code must NOT
 * become an HTTP administrative API or accept a DTO as MFA proof.
 */
final class AdminIntegration342Test extends TestCase
{
    use RefreshDatabase;

    public function test_no_admin_activation_routes_can_be_called_from_client(): void
    {
        $this->getJson('/admin/v1/accounts')->assertNotFound();
        $this->postJson('/admin/v1/trials', [
            'role' => 'owner',
            'mfaVerifiedAtMs' => now()->getTimestampMs(),
            'planId' => 'unlimited_plus',
        ])->assertNotFound();
        $this->postJson('/admin/v1/restrictions', [
            'role' => 'owner',
            'reason' => 'policy_violation',
        ])->assertNotFound();
        $this->assertDatabaseCount('admin_audit_records_v1', 0);
        $this->assertDatabaseCount('admin_trial_grant_operations_v1', 0);
        $this->assertDatabaseCount('admin_temporary_restriction_events_v1', 0);
    }

    public function test_admin_principal_without_independently_verified_mfa_fails_closed(): void
    {
        $now = now()->getTimestampMs();
        $principal = new AdminPrincipal(
            '11111111-1111-4111-8111-111111111111',
            'owner',
            $now + 60_000,
            null,
        );
        $this->expectException(DomainException::class);
        $this->expectExceptionMessage('admin.access_denied');
        AdminPolicy::requireAllowed($principal, 'grants.issue', $now);
    }
}
