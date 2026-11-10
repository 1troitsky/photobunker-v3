<?php
declare(strict_types=1);

namespace Tests\Feature;
use Tests\TestCase;

final class HealthTest extends TestCase
{
    public function test_health_remains_unauthenticated():void
    {
        $this->getJson('/api/healthz')->assertOk()->assertExactJson(['status'=>'ok']);
    }

    public function test_private_routes_require_identity_and_origin():void
    {
        $this->getJson('/identity/v2/me')->assertUnauthorized();
        $this->withHeader('Origin','https://localhost')
             ->postJson('/photos/v1/reserve',[])->assertUnauthorized();
    }

    public function test_pairing_and_account_reset_are_not_exposed():void
    {
        $this->postJson('/identity/v2/pairings',[])->assertNotFound();
        $this->postJson('/identity/v2/reset',[])->assertNotFound();
    }
}
