<?php
declare(strict_types=1);

namespace Tests\Feature;

use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Str;
use PHPUnit\Framework\Attributes\DataProvider;
use Tests\TestCase;

final class AccountScopedOperationalLimitsTest extends TestCase
{
    public static function routes(): array
    {
        return [
            'billing' => ['/billing/v1/plans', 40, 200],
            'sharing' => ['/shares/v1/keys/me', 40, 401],
            'photos' => ['/photos/v1', 120, 401],
        ];
    }

    #[DataProvider('routes')]
    public function test_server_session_accounts_have_separate_bounded_budgets(string $route, int $maximum, int $status): void
    {
        Cache::flush();
        $a = (string) Str::uuid();
        $b = (string) Str::uuid();
        // The PHP fixture sets trusted SERVER session state, never a client
        // account header. Missing device proof still receives controller 401.
        for ($i = 0; $i < $maximum; $i++) {
            $this->withSession(['identity_account' => $a])->getJson($route)->assertStatus($status);
        }
        $this->withSession(['identity_account' => $a])->getJson($route)->assertStatus(429);
        for ($i = 0; $i < $maximum; $i++) {
            $this->withSession(['identity_account' => $b])->getJson($route)->assertStatus($status);
        }
        $this->withSession(['identity_account' => $b])->getJson($route)->assertStatus(429);
        $this->withSession(['identity_account' => null])->getJson($route)->assertStatus($status);
    }

    #[DataProvider('routes')]
    public function test_guest_cannot_split_ip_budget_with_client_ids(string $route, int $maximum, int $status): void
    {
        Cache::flush();
        for ($i = 0; $i < $maximum; $i++) {
            $this->withSession(['identity_account' => $i % 2 ? 'malformed' : null])
                ->withHeader('X-Account-Id', (string) Str::uuid())
                ->getJson($route.'?accountId='.(string) Str::uuid())->assertStatus($status);
        }
        $this->withSession(['identity_account' => null])->getJson($route)->assertStatus(429);
        $this->withSession(['identity_account' => 'malformed'])->getJson($route)->assertStatus(429);
    }
}
