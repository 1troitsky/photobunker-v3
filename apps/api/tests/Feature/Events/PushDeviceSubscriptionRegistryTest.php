<?php
declare(strict_types=1);

namespace Tests\Feature\Events;

use App\Events\PushDeviceSubscriptionRegistry;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;
use InvalidArgumentException;
use Tests\TestCase;

final class PushDeviceSubscriptionRegistryTest extends TestCase
{
    use RefreshDatabase;

    private PushDeviceSubscriptionRegistry $registry;
    private string $alice;
    private string $deviceA;
    private string $deviceB;
    private string $bob;
    private string $deviceC;

    protected function setUp(): void
    {
        parent::setUp();
        $this->registry = new PushDeviceSubscriptionRegistry();
        [$this->alice, $this->deviceA] = $this->identity();
        $this->deviceB = (string) Str::uuid();
        $this->insertDevice($this->alice, $this->deviceB);
        [$this->bob, $this->deviceC] = $this->identity();
    }

    /** @return array{string,string} */
    private function identity(): array
    {
        $account = (string) Str::uuid();
        $device = (string) Str::uuid();
        DB::table('identity_accounts')->insert([
            'id' => $account,
            'operation_id' => (string) Str::uuid(),
            'prepare_hash' => str_repeat('a', 64),
            'status' => 'ready',
            'reserved_until' => now()->addDay(),
            'created_at' => now(), 'updated_at' => now(),
        ]);
        $this->insertDevice($account, $device);
        return [$account, $device];
    }

    private function insertDevice(string $account, string $device): void
    {
        DB::table('identity_devices')->insert([
            'id' => $device, 'account_id' => $account,
            'signing_spki' => 'test-only',
            'created_at' => now(), 'updated_at' => now(),
        ]);
    }

    /** @return array{endpoint:string,p256dh:string,auth:string} */
    private function subscription(string $path = 'abc123'): array
    {
        $encode = static fn(string $value):string =>
            rtrim(strtr(base64_encode($value), '+/', '-_'), '=');
        return [
            'endpoint' => 'https://fcm.googleapis.com/fcm/send/'.$path,
            'p256dh' => $encode("\x04".str_repeat('p', 64)),
            'auth' => $encode(str_repeat('s', 16)),
        ];
    }

    public function test_device_registration_is_encrypted_and_rotation_is_atomic(): void
    {
        $input = $this->subscription();
        self::assertSame(['registered'=>true,'generation'=>1],
            $this->registry->put($this->alice, $this->deviceA, $input));
        self::assertTrue($this->registry->eligible($this->alice, $this->deviceA));
        self::assertFalse($this->registry->eligible($this->bob, $this->deviceA));
        $row = DB::table('notification_push_subscriptions_v1')->first();
        self::assertNotNull($row);
        self::assertSame(hash('sha256',$input['endpoint']), $row->endpoint_hash);
        foreach ([$input['endpoint'],$input['p256dh'],$input['auth'],
            $this->alice,$this->deviceA] as $private) {
            self::assertStringNotContainsString($private, $row->subscription_ciphertext);
        }
        self::assertSame(['registered'=>true,'generation'=>2],
            $this->registry->put($this->alice,$this->deviceA,$this->subscription('rotated')));
        self::assertDatabaseCount('notification_push_subscriptions_v1',1);
        self::assertDatabaseHas('notification_push_subscriptions_v1',[
            'device_id'=>$this->deviceA,
            'endpoint_hash'=>hash('sha256',$this->subscription('rotated')['endpoint']),
            'generation'=>2,'disabled_at'=>null,
        ]);
        self::assertTrue($this->registry->disable($this->alice,$this->deviceA));
        self::assertFalse($this->registry->disable($this->alice,$this->deviceA));
        self::assertFalse($this->registry->eligible($this->alice,$this->deviceA));
        self::assertSame(['registered'=>true,'generation'=>3],
            $this->registry->put($this->alice,$this->deviceA,$this->subscription('rotated')));
        self::assertTrue($this->registry->eligible($this->alice,$this->deviceA));
    }

    public function test_cross_account_device_claim_and_endpoint_replay_fail_closed(): void
    {
        $sub=$this->subscription();
        $this->registry->put($this->alice,$this->deviceA,$sub);
        $this->expectException(InvalidArgumentException::class);
        $this->expectExceptionMessage('notifications.push.invalid_device');
        $this->registry->put($this->bob,$this->deviceA,$sub);
    }

    public function test_endpoint_is_not_reclaimable_by_another_device_or_tenant(): void
    {
        $sub=$this->subscription();
        $this->registry->put($this->alice,$this->deviceA,$sub);
        try{
            $this->registry->put($this->alice,$this->deviceB,$sub);
            self::fail('Endpoint ownership collision allowed');
        }catch(InvalidArgumentException $e){
            self::assertSame('notifications.push.endpoint_claimed',$e->getMessage());
        }
        try{
            $this->registry->put($this->bob,$this->deviceC,$sub);
            self::fail('Cross-tenant endpoint ownership collision allowed');
        }catch(InvalidArgumentException $e){
            self::assertSame('notifications.push.endpoint_claimed',$e->getMessage());
        }
        self::assertDatabaseCount('notification_push_subscriptions_v1',1);
    }

    public function test_revoked_device_and_disabled_account_cannot_reactivate_or_deliver(): void
    {
        $sub=$this->subscription();
        $this->registry->put($this->alice,$this->deviceA,$sub);
        DB::table('identity_devices')->where('id',$this->deviceA)
            ->update(['revoked_at'=>now()]);
        self::assertFalse($this->registry->eligible($this->alice,$this->deviceA));
        try{
            $this->registry->put($this->alice,$this->deviceA,$sub);
            self::fail('Revoked device reused push subscription');
        }catch(InvalidArgumentException $e){
            self::assertSame('notifications.push.invalid_device',$e->getMessage());
        }
        DB::table('identity_accounts')->where('id',$this->bob)
            ->update(['status'=>'reserved']);
        try{
            $this->registry->put($this->bob,$this->deviceC,$this->subscription('bob'));
            self::fail('Inactive account could register push');
        }catch(InvalidArgumentException $e){
            self::assertSame('notifications.push.invalid_device',$e->getMessage());
        }
    }

    public function test_malformed_subscription_and_ssrf_endpoints_never_write(): void
    {
        $base=$this->subscription();
        foreach ([
            [...$base,'endpoint'=>'http://fcm.googleapis.com/fcm/send/abc'],
            [...$base,'endpoint'=>'https://localhost/push'],
            [...$base,'endpoint'=>'https://127.0.0.1/push'],
            [...$base,'endpoint'=>'https://fcm.googleapis.com.evil.test/send'],
            [...$base,'endpoint'=>'https://user:pass@fcm.googleapis.com/send'],
            [...$base,'endpoint'=>'https://fcm.googleapis.com:444/send'],
            [...$base,'endpoint'=>'https://fcm.googleapis.com/send#secret'],
            [...$base,'p256dh'=>'private'],
            [...$base,'auth'=>'private'],
            [...$base,'deviceId'=>$this->deviceB],
        ] as $bad) {
            try{
                $this->registry->put($this->alice,$this->deviceA,$bad);
                self::fail('Invalid push subscription accepted');
            }catch(InvalidArgumentException $e){
                self::assertSame('notifications.push.invalid_subscription',$e->getMessage());
            }
        }
        self::assertDatabaseCount('notification_push_subscriptions_v1',0);
    }
}
