<?php
declare(strict_types=1);
namespace Tests\Feature;
use Tests\TestCase;
final class HealthTest extends TestCase {
 public function test_health_is_instant_and_requires_no_session():void {
    $this->getJson('/api/healthz')->assertOk()->assertExactJson(['status'=>'ok']);
 }
 public function test_business_routes_are_not_exposed_before_security_implementation():void {
    $this->getJson('/identity/v2/recovery/private')->assertNotFound();
    $this->postJson('/photos/v1/reserve')->assertNotFound();
 }
}
