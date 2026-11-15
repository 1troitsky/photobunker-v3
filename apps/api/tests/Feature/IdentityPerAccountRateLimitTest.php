<?php
declare(strict_types=1);

namespace Tests\Feature;

use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Str;
use Tests\TestCase;

/**
 * Genuine Laravel web-session throttle. No mutable browser account header
 * may change this key: anonymous callers still share one IP budget.
 */
final class IdentityPerAccountRateLimitTest extends TestCase
{
    protected function setUp(): void
    {
        parent::setUp();
        Cache::flush();
    }

    public function test_authenticated_accounts_on_one_ip_have_independent_but_bounded_budgets(): void
    {
        $a = (string) Str::uuid();
        $b = (string) Str::uuid();

        for ($n = 0; $n < 40; $n++) {
            $this->withSession(['identity_account' => $a])
                ->getJson('/identity/v2/csrf')->assertOk();
        }
        $this->withSession(['identity_account' => $a])
            ->getJson('/identity/v2/csrf')->assertStatus(429);

        // Same physical IP; account B's server-side signed session is a
        // separate limiter key and is not throttled by A's activity.
        $this->withSession(['identity_account' => $b])
            ->getJson('/identity/v2/csrf')->assertOk();

        // An unregistered visitor behind that NAT still has an IP budget.
        $this->withSession(['identity_account' => null])
            ->getJson('/identity/v2/csrf')->assertOk();
    }

    public function test_guest_and_malformed_account_are_ip_limited(): void
    {
        for ($n = 0; $n < 40; $n++) {
            // Malformed session metadata must not create its own bucket.
            $this->withSession(['identity_account' => $n % 2 ? 'x' : null])
                ->getJson('/identity/v2/csrf')->assertOk();
        }
        $this->withSession(['identity_account' => null])
            ->getJson('/identity/v2/csrf')->assertStatus(429);
        $this->withSession(['identity_account' => 'not-a-uuid'])
            ->getJson('/identity/v2/csrf')->assertStatus(429);
    }
}
