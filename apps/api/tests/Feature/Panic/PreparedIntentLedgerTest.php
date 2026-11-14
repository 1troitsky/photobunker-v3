<?php

declare(strict_types=1);

namespace Tests\Feature\Panic;

use App\Identity\Protocol;
use App\Panic\PreparedIntentLedger;
use DomainException;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;
use Tests\TestCase;

/**
 * Server-only #221 security acceptance on real SQLite migrations and OpenSSL.
 * No HTTP routes, outbox flush, session revocations or cloud deletion.
 */
final class PreparedIntentLedgerTest extends TestCase
{
    use RefreshDatabase;

    private const DOMAIN = "photobunker.panic.intent.v1\n";
    private const TABLE = 'panic_preflight_intents_v1';

    /** @return array{key:mixed,spki:string} */
    private function keys(): array
    {
        $key = openssl_pkey_new([
            'private_key_type' => OPENSSL_KEYTYPE_EC,
            'curve_name' => 'prime256v1',
        ]);
        self::assertNotFalse($key);
        $details = openssl_pkey_get_details($key);
        self::assertIsArray($details);
        $body = preg_replace('/-----[^-]+-----|\s+/', '', $details['key']);
        $raw = base64_decode($body, true);
        self::assertNotFalse($raw);
        return ['key' => $key, 'spki' => Protocol::encode($raw)];
    }

    private function signature(string $message, mixed $key): string
    {
        self::assertTrue(openssl_sign($message, $der, $key, OPENSSL_ALGO_SHA256));
        self::assertSame(0x30, ord($der[0]));
        $at = 2;
        $get = static function () use (&$at, $der): string {
            if (ord($der[$at++]) !== 2) {
                throw new \RuntimeException('Unexpected DER integer');
            }
            $len = ord($der[$at++]);
            $n = substr($der, $at, $len);
            $at += $len;
            return str_pad(ltrim($n, "\x00"), 32, "\x00", STR_PAD_LEFT);
        };
        return Protocol::encode($get().$get());
    }

    /** @return array{accountId:string,deviceId:string,keys:array,revision:int} */
    private function identity(): array
    {
        $accountId = (string) Str::uuid();
        $deviceId = (string) Str::uuid();
        $keys = $this->keys();
        DB::table('identity_accounts')->insert([
            'id' => $accountId,
            'operation_id' => (string) Str::uuid(),
            'prepare_hash' => str_repeat('a', 64),
            'status' => 'ready',
            'revision' => 2,
            'reserved_until' => now()->addMinutes(15),
            'created_at' => now(),
            'updated_at' => now(),
        ]);
        DB::table('identity_devices')->insert([
            'id' => $deviceId,
            'account_id' => $accountId,
            'signing_spki' => $keys['spki'],
            'revoked_at' => null,
            'created_at' => now(),
            'updated_at' => now(),
        ]);
        return compact('accountId', 'deviceId', 'keys') + ['revision' => 2];
    }

    /** @param array{accountId:string,deviceId:string,keys:array,revision:int} $identity */
    private function wire(array $identity, array $changes = []): array
    {
        $data = array_replace([
            'version' => 1,
            'purpose' => 'panic.live-delete',
            'operationId' => (string) Str::uuid(),
            'accountId' => $identity['accountId'],
            'deviceId' => $identity['deviceId'],
            'keyRevision' => $identity['revision'],
            'nonce' => Protocol::encode(random_bytes(32)),
            'issuedAt' => gmdate('Y-m-d\TH:i:s').'.000Z',
            'liveScope' => 'all-live-locations',
            'vault' => 'preserve-existing-verified',
        ], $changes);
        ksort($data, SORT_STRING);
        $contract = json_encode($data, JSON_UNESCAPED_SLASHES | JSON_THROW_ON_ERROR);
        return [
            'contract' => $contract,
            'signature' => $this->signature(self::DOMAIN.$contract, $identity['keys']['key']),
        ];
    }

    private function deny(string $message, callable $action): void
    {
        try {
            $action();
            self::fail('Unexpected Panic preflight acceptance');
        } catch (DomainException $error) {
            self::assertSame($message, $error->getMessage());
        }
    }

    public function test_first_valid_device_signing_records_only_inert_preflight_state(): void
    {
        $identity = $this->identity();
        $wire = $this->wire($identity);
        $data = (new PreparedIntentLedger())->prepare($wire, $identity['accountId'], $identity['deviceId']);
        self::assertSame('preflight_only', $data['phase']);
        self::assertFalse($data['replay']);
        self::assertSame(hash('sha256', $wire['contract']), $data['contractHash']);
        self::assertSame(json_decode($wire['contract'], true)['operationId'], $data['operationId']);
        self::assertSame(['phase', 'operationId', 'contractHash', 'replay'], array_keys($data));
        $this->assertDatabaseCount(self::TABLE, 1);
        $this->assertDatabaseHas(self::TABLE, [
            'operation_id' => $data['operationId'],
            'account_id' => $identity['accountId'],
            'device_id' => $identity['deviceId'],
            'key_revision' => 2,
            'contract_json' => $wire['contract'],
            'signature' => $wire['signature'],
            'phase' => 'preflight_only',
        ]);
        $this->assertDatabaseHas('identity_accounts', [
            'id' => $identity['accountId'], 'status' => 'ready',
        ]);
        $this->assertDatabaseHas('identity_devices', [
            'id' => $identity['deviceId'], 'revoked_at' => null,
        ]);
    }

    public function test_same_signed_operation_is_idempotent_with_no_re_sign_or_wipe(): void
    {
        $identity = $this->identity();
        $wire = $this->wire($identity);
        $engine = new PreparedIntentLedger();
        $first = $engine->prepare($wire, $identity['accountId'], $identity['deviceId']);
        $original = DB::table(self::TABLE)->where('operation_id', $first['operationId'])->first();
        $again = $engine->prepare($wire, $identity['accountId'], $identity['deviceId']);
        self::assertTrue($again['replay']);
        self::assertSame($first['contractHash'], $again['contractHash']);
        $this->assertDatabaseCount(self::TABLE, 1);
        $saved = DB::table(self::TABLE)->where('operation_id', $first['operationId'])->first();
        self::assertSame($original->prepared_at, $saved->prepared_at);
        self::assertSame($original->signature, $saved->signature);
        self::assertSame('preflight_only', $saved->phase);
    }

    public function test_same_device_conflicting_operation_must_not_replace_original(): void
    {
        $identity = $this->identity();
        $first = $this->wire($identity);
        $engine = new PreparedIntentLedger();
        $engine->prepare($first, $identity['accountId'], $identity['deviceId']);
        $conflict = $this->wire($identity);
        $this->deny('panic.preflight_conflict', fn () =>
            $engine->prepare($conflict, $identity['accountId'], $identity['deviceId']));
        $this->assertDatabaseCount(self::TABLE, 1);
        $this->assertDatabaseHas(self::TABLE, ['contract_json' => $first['contract']]);
    }

    public function test_global_operation_collision_cannot_be_rebound_to_other_account(): void
    {
        $first = $this->identity();
        $second = $this->identity();
        $op = (string) Str::uuid();
        $w1 = $this->wire($first, ['operationId' => $op]);
        $w2 = $this->wire($second, ['operationId' => $op]);
        $engine = new PreparedIntentLedger();
        $engine->prepare($w1, $first['accountId'], $first['deviceId']);
        $this->deny('panic.preflight_conflict', fn () =>
            $engine->prepare($w2, $second['accountId'], $second['deviceId']));
        $this->assertDatabaseCount(self::TABLE, 1);
        $this->assertDatabaseHas(self::TABLE, [
            'operation_id' => $op, 'account_id' => $first['accountId'],
        ]);
    }

    public function test_account_not_ready_and_foreign_device_cannot_preflight(): void
    {
        $identity = $this->identity();
        $wire = $this->wire($identity);
        DB::table('identity_accounts')->where('id', $identity['accountId'])
            ->update(['status' => 'reserved']);
        $this->deny('panic.account_not_ready', fn () =>
            (new PreparedIntentLedger())->prepare($wire, $identity['accountId'], $identity['deviceId']));
        DB::table('identity_accounts')->where('id', $identity['accountId'])
            ->update(['status' => 'ready']);
        $other = $this->identity();
        $this->deny('panic.device_unavailable', fn () =>
            (new PreparedIntentLedger())->prepare($wire, $identity['accountId'], $other['deviceId']));
        $this->assertDatabaseCount(self::TABLE, 0);
    }

    public function test_revoked_device_is_denied_even_for_identical_preflight_replay(): void
    {
        $identity = $this->identity();
        $wire = $this->wire($identity);
        $engine = new PreparedIntentLedger();
        $engine->prepare($wire, $identity['accountId'], $identity['deviceId']);
        DB::table('identity_devices')->where('id', $identity['deviceId'])
            ->update(['revoked_at' => now()]);
        $this->deny('panic.device_unavailable', fn () =>
            $engine->prepare($wire, $identity['accountId'], $identity['deviceId']));
        $this->assertDatabaseCount(self::TABLE, 1);
    }

    public function test_recovery_revision_change_blocks_old_signed_replay(): void
    {
        $identity = $this->identity();
        $wire = $this->wire($identity);
        $engine = new PreparedIntentLedger();
        $engine->prepare($wire, $identity['accountId'], $identity['deviceId']);
        DB::table('identity_accounts')->where('id', $identity['accountId'])
            ->update(['revision' => 3]);
        $this->deny('panic.invalid_intent', fn () =>
            $engine->prepare($wire, $identity['accountId'], $identity['deviceId']));
        $this->assertDatabaseCount(self::TABLE, 1);
    }

    public function test_validly_signed_recovery_vault_delete_scope_is_rejected_before_db_write(): void
    {
        $identity = $this->identity();
        $wire = $this->wire($identity, ['vault' => 'delete-last-backup']);
        $this->deny('panic.invalid_intent', fn () =>
            (new PreparedIntentLedger())->prepare($wire, $identity['accountId'], $identity['deviceId']));
        $this->assertDatabaseCount(self::TABLE, 0);
    }

    public function test_wrong_signature_is_rejected_before_any_db_write(): void
    {
        $identity = $this->identity();
        $wire = $this->wire($identity);
        $other = $this->keys();
        $wire['signature'] = $this->signature(self::DOMAIN.$wire['contract'], $other['key']);
        $this->deny('panic.invalid_intent', fn () =>
            (new PreparedIntentLedger())->prepare($wire, $identity['accountId'], $identity['deviceId']));
        $this->assertDatabaseCount(self::TABLE, 0);
    }
}
