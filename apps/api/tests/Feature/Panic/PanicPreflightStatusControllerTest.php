<?php

declare(strict_types=1);

namespace Tests\Feature\Panic;

use App\Identity\Protocol;
use App\Panic\PreparedIntentLedger;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;
use Tests\TestCase;

/**
 * #221 synthetic owner-session end-to-end HTTP READ-ONLY tests.
 *
 * Route definition is deliberately loaded in TEST ONLY: no production mount
 * until foreign #198 routes/web.php and #231 bootstrap/app.php resolve.
 * No DELETE/POST Panic command, server ACK, local wipe, S3 or Matrix action.
 */
final class PanicPreflightStatusControllerTest extends TestCase
{
    use RefreshDatabase;

    private const PATH = '/panic/v1/preflight/';
    private const DOMAIN = "photobunker.panic.intent.v1\n";

    protected function setUp(): void
    {
        parent::setUp();
        require base_path('routes/panic-preflight.php');
    }

    private function identity(): array
    {
        $key = openssl_pkey_new([
            'private_key_type' => OPENSSL_KEYTYPE_EC,
            'curve_name' => 'prime256v1',
        ]);
        self::assertNotFalse($key);
        $details = openssl_pkey_get_details($key);
        self::assertIsArray($details);
        $pem = preg_replace('/-----[^-]+-----|\s+/', '', $details['key']);
        $der = base64_decode($pem, true);
        self::assertNotFalse($der);

        $accountId = (string) Str::uuid();
        $deviceId = (string) Str::uuid();
        DB::table('identity_accounts')->insert([
            'id' => $accountId,
            'operation_id' => (string) Str::uuid(),
            'prepare_hash' => str_repeat('a', 64),
            'status' => 'ready',
            'revision' => 2,
            'reserved_until' => now()->addHour(),
            'created_at' => now(),
            'updated_at' => now(),
        ]);
        DB::table('identity_devices')->insert([
            'id' => $deviceId,
            'account_id' => $accountId,
            'signing_spki' => Protocol::encode($der),
            'revoked_at' => null,
            'created_at' => now(),
            'updated_at' => now(),
        ]);
        return ['accountId' => $accountId, 'deviceId' => $deviceId, 'key' => $key];
    }

    private function signed(array $identity): array
    {
        $intent = [
            'version' => 1,
            'purpose' => 'panic.live-delete',
            'operationId' => (string) Str::uuid(),
            'accountId' => $identity['accountId'],
            'deviceId' => $identity['deviceId'],
            'keyRevision' => 2,
            'nonce' => Protocol::encode(random_bytes(32)),
            'issuedAt' => gmdate('Y-m-d\TH:i:s').'.000Z',
            'liveScope' => 'all-live-locations',
            'vault' => 'preserve-existing-verified',
        ];
        ksort($intent, SORT_STRING);
        $contract = json_encode($intent, JSON_UNESCAPED_SLASHES | JSON_THROW_ON_ERROR);
        self::assertTrue(openssl_sign(self::DOMAIN.$contract, $der, $identity['key'], OPENSSL_ALGO_SHA256));
        $at = 2;
        self::assertSame(0x30, ord($der[0]));
        $read = static function () use (&$at, $der): string {
            if (ord($der[$at++]) !== 2) {
                throw new \RuntimeException('Invalid P-256 DER integer');
            }
            $length = ord($der[$at++]);
            $number = substr($der, $at, $length);
            $at += $length;
            return str_pad(ltrim($number, "\x00"), 32, "\x00", STR_PAD_LEFT);
        };
        return ['contract' => $contract, 'signature' => Protocol::encode($read().$read())];
    }

    private function prepared(array $identity): array
    {
        $wire = $this->signed($identity);
        $saved = (new PreparedIntentLedger())->prepare(
            $wire, $identity['accountId'], $identity['deviceId'],
        );
        return ['wire' => $wire, 'operationId' => $saved['operationId']];
    }

    private function asDevice(array $identity, ?int $issued = null): static
    {
        return $this->withSession([
            'identity_account' => $identity['accountId'],
            'identity_device' => $identity['deviceId'],
            'identity_issued' => $issued ?? time(),
        ]);
    }

    public function test_owner_device_can_query_only_preflight_and_never_a_delete_ack(): void
    {
        $identity = $this->identity();
        $prepared = $this->prepared($identity);
        $old = DB::table('panic_preflight_intents_v1')->first();
        $response = $this->asDevice($identity)
            ->getJson(self::PATH.$prepared['operationId'])
            ->assertOk()
            ->assertHeader('Cache-Control', 'no-store, private')
            ->assertHeader('X-Content-Type-Options', 'nosniff')
            ->assertHeader('Vary', 'Cookie')
            ->assertJsonPath('phase', 'preflight_only')
            ->assertJsonPath('operationId', $prepared['operationId']);

        $payload = $response->json();
        self::assertSame(
            ['phase', 'operationId', 'contractHash', 'recordedAt'],
            array_keys($payload),
        );
        self::assertSame(hash('sha256', $prepared['wire']['contract']), $payload['contractHash']);
        self::assertArrayNotHasKey('receipt', $payload);
        self::assertArrayNotHasKey('cloud_deleted', $payload);
        self::assertArrayNotHasKey('backup_preserved', $payload);
        self::assertStringNotContainsString($prepared['wire']['signature'], $response->getContent());
        self::assertStringNotContainsString($prepared['wire']['contract'], $response->getContent());

        $this->assertDatabaseCount('panic_preflight_intents_v1', 1);
        self::assertEquals($old, DB::table('panic_preflight_intents_v1')->first());
        $this->assertDatabaseHas('identity_devices', [
            'id' => $identity['deviceId'], 'revoked_at' => null,
        ]);
    }

    public function test_no_session_never_exposes_a_record_even_if_operation_id_known(): void
    {
        $identity = $this->identity();
        $prepared = $this->prepared($identity);
        $this->getJson(self::PATH.$prepared['operationId'])
            ->assertUnauthorized();
    }

    public function test_expired_or_wrong_account_device_session_denied_or_not_found(): void
    {
        $identity = $this->identity();
        $prepared = $this->prepared($identity);
        $this->asDevice($identity, time() - 86401)
            ->getJson(self::PATH.$prepared['operationId'])
            ->assertUnauthorized();

        $foreign = $this->identity();
        $this->asDevice($foreign)
            ->getJson(self::PATH.$prepared['operationId'])
            ->assertNotFound();

        $this->withSession([
            'identity_account' => $identity['accountId'],
            'identity_device' => $foreign['deviceId'],
            'identity_issued' => time(),
        ])->getJson(self::PATH.$prepared['operationId'])
          ->assertUnauthorized();
    }

    public function test_missing_record_and_wrong_id_are_not_delete_success(): void
    {
        $identity = $this->identity();
        $this->asDevice($identity)
            ->getJson(self::PATH.(string) Str::uuid())
            ->assertNotFound();
        $this->asDevice($identity)
            ->getJson(self::PATH.'not-a-uuid')
            ->assertNotFound();
        $this->assertDatabaseCount('panic_preflight_intents_v1', 0);
    }

    public function test_revoked_device_or_retired_account_cannot_read_existing_status(): void
    {
        $identity = $this->identity();
        $prepared = $this->prepared($identity);
        DB::table('identity_devices')->where('id', $identity['deviceId'])
            ->update(['revoked_at' => now()]);
        $this->asDevice($identity)
            ->getJson(self::PATH.$prepared['operationId'])
            ->assertUnauthorized();

        DB::table('identity_devices')->where('id', $identity['deviceId'])
            ->update(['revoked_at' => null]);
        DB::table('identity_accounts')->where('id', $identity['accountId'])
            ->update(['status' => 'retired']);
        $this->asDevice($identity)
            ->getJson(self::PATH.$prepared['operationId'])
            ->assertUnauthorized();
        $this->assertDatabaseCount('panic_preflight_intents_v1', 1);
    }

    public function test_stale_key_revision_and_unregistered_signer_never_return_preflight(): void
    {
        $identity = $this->identity();
        $prepared = $this->prepared($identity);
        DB::table('identity_accounts')->where('id', $identity['accountId'])
            ->update(['revision' => 3]);
        $this->asDevice($identity)
            ->getJson(self::PATH.$prepared['operationId'])
            ->assertNotFound();

        DB::table('identity_accounts')->where('id', $identity['accountId'])
            ->update(['revision' => 2]);
        DB::table('identity_devices')->where('id', $identity['deviceId'])
            ->update(['signing_spki' => Protocol::encode(random_bytes(65))]);
        $this->asDevice($identity)
            ->getJson(self::PATH.$prepared['operationId'])
            ->assertNotFound();
        $this->assertDatabaseCount('panic_preflight_intents_v1', 1);
    }

    public function test_forged_completed_server_state_or_stored_signature_must_not_be_returned(): void
    {
        $identity = $this->identity();
        $prepared = $this->prepared($identity);
        $operationId = $prepared['operationId'];
        foreach ([
            ['phase' => 'cloud_deleted'],
            ['phase' => 'server_revoked'],
            ['phase' => 'cloud_delete_pending'],
            ['contract_hash' => str_repeat('0', 64)],
            ['signature' => 'AA'],
            ['contract_json' => '{}'],
        ] as $patch) {
            $row = (array) DB::table('panic_preflight_intents_v1')
                ->where('operation_id', $operationId)->first();
            DB::table('panic_preflight_intents_v1')
                ->where('operation_id', $operationId)->update($patch);
            $this->asDevice($identity)
                ->getJson(self::PATH.$operationId)
                ->assertNotFound();
            DB::table('panic_preflight_intents_v1')
                ->where('operation_id', $operationId)->update($row);
        }
        $this->asDevice($identity)->getJson(self::PATH.$operationId)->assertOk();
        $this->assertDatabaseCount('panic_preflight_intents_v1', 1);
    }

    public function test_no_query_scoping_leaks_no_post_write_and_no_delete_methods(): void
    {
        $identity = $this->identity();
        $prepared = $this->prepared($identity);
        $url = self::PATH.$prepared['operationId'];
        $this->asDevice($identity)->getJson($url.'?deviceId='.$identity['deviceId'])
            ->assertUnprocessable();
        $this->asDevice($identity)->postJson($url, ['phase' => 'cloud_deleted'])
            ->assertStatus(405);
        $this->asDevice($identity)->deleteJson($url)->assertStatus(405);
        $this->assertDatabaseCount('panic_preflight_intents_v1', 1);
        $this->assertDatabaseHas('panic_preflight_intents_v1', [
            'operation_id' => $prepared['operationId'], 'phase' => 'preflight_only',
        ]);
    }
}
