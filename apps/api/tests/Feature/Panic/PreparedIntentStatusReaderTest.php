<?php

declare(strict_types=1);

namespace Tests\Feature\Panic;

use App\Identity\Protocol;
use App\Panic\PreparedIntentLedger;
use App\Panic\PreparedIntentStatusReader;
use DomainException;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;
use Tests\TestCase;

/**
 * #221 internal and inert server status only.
 * Real Laravel DB and OpenSSL, no HTTP route, ACK, revocation writes or GC.
 */
final class PreparedIntentStatusReaderTest extends TestCase
{
    use RefreshDatabase;

    private const TABLE = 'panic_preflight_intents_v1';
    private const DOMAIN = "photobunker.panic.intent.v1\n";

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
        $encoded = preg_replace('/-----[^-]+-----|\s+/', '', $details['key']);
        $spki = base64_decode($encoded, true);
        self::assertNotFalse($spki);
        return ['key' => $key, 'spki' => Protocol::encode($spki)];
    }

    private function sign(string $message, mixed $key): string
    {
        self::assertTrue(openssl_sign($message, $der, $key, OPENSSL_ALGO_SHA256));
        self::assertSame(0x30, ord($der[0]));
        $offset = 2;
        $integer = static function () use (&$offset, $der): string {
            if (ord($der[$offset++]) !== 2) {
                throw new \RuntimeException('Unexpected DER integer');
            }
            $len = ord($der[$offset++]);
            $value = substr($der, $offset, $len);
            $offset += $len;
            return str_pad(ltrim($value, "\x00"), 32, "\x00", STR_PAD_LEFT);
        };
        return Protocol::encode($integer().$integer());
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
            'reserved_until' => now()->addHour(),
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

    private function wire(array $identity, array $changes = []): array
    {
        $payload = array_replace([
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
        ksort($payload, SORT_STRING);
        $contract = json_encode($payload, JSON_UNESCAPED_SLASHES | JSON_THROW_ON_ERROR);
        return [
            'contract' => $contract,
            'signature' => $this->sign(self::DOMAIN.$contract, $identity['keys']['key']),
        ];
    }

    private function deny(callable $action): void
    {
        try {
            $action();
            self::fail('Untrusted Panic preflight was exposed as stored');
        } catch (DomainException $exception) {
            self::assertSame('panic.preflight_unavailable', $exception->getMessage());
        }
    }

    public function test_missing_operation_cannot_invent_a_server_receipt(): void
    {
        $identity = $this->identity();
        $wire = $this->wire($identity);
        $this->deny(fn () => (new PreparedIntentStatusReader())->read(
            $wire, $identity['accountId'], $identity['deviceId'],
        ));
        $this->assertDatabaseCount(self::TABLE, 0);
    }

    public function test_signed_persisted_preflight_can_be_read_after_new_service_instance_without_mutation(): void
    {
        $identity = $this->identity();
        $wire = $this->wire($identity);
        $prepared = (new PreparedIntentLedger())->prepare(
            $wire, $identity['accountId'], $identity['deviceId'],
        );
        $original = DB::table(self::TABLE)->first();
        $result = (new PreparedIntentStatusReader())->read(
            $wire, $identity['accountId'], $identity['deviceId'],
        );
        self::assertSame(
            ['phase', 'operationId', 'contractHash', 'recordedAt'],
            array_keys($result),
        );
        self::assertSame('preflight_only', $result['phase']);
        self::assertSame($prepared['operationId'], $result['operationId']);
        self::assertSame($prepared['contractHash'], $result['contractHash']);
        self::assertMatchesRegularExpression(
            '/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/D',
            $result['recordedAt'],
        );
        self::assertArrayNotHasKey('ack', $result);
        self::assertArrayNotHasKey('deleted', $result);
        self::assertArrayNotHasKey('serverRevoked', $result);
        self::assertArrayNotHasKey('signedServerEvidence', $result);

        $other = (new PreparedIntentStatusReader())->read(
            $wire, $identity['accountId'], $identity['deviceId'],
        );
        self::assertSame($result, $other);
        $this->assertDatabaseCount(self::TABLE, 1);
        self::assertEquals($original, DB::table(self::TABLE)->first());
    }

    public function test_cross_account_or_unregistered_device_cannot_read_a_stored_preflight(): void
    {
        $identity = $this->identity();
        $wire = $this->wire($identity);
        (new PreparedIntentLedger())->prepare($wire, $identity['accountId'], $identity['deviceId']);
        $other = $this->identity();
        foreach ([
            [$other['accountId'], $identity['deviceId']],
            [$identity['accountId'], $other['deviceId']],
            [$other['accountId'], $other['deviceId']],
            ['bad-account', $identity['deviceId']],
            [$identity['accountId'], 'bad-device'],
        ] as [$accountId, $deviceId]) {
            $this->deny(fn () => (new PreparedIntentStatusReader())->read(
                $wire, $accountId, $deviceId,
            ));
        }
        $this->assertDatabaseCount(self::TABLE, 1);
    }

    public function test_revoke_denies_read_including_original_byte_identical_request(): void
    {
        $identity = $this->identity();
        $wire = $this->wire($identity);
        (new PreparedIntentLedger())->prepare($wire, $identity['accountId'], $identity['deviceId']);
        DB::table('identity_devices')->where('id', $identity['deviceId'])
            ->update(['revoked_at' => now()]);
        $this->deny(fn () => (new PreparedIntentStatusReader())->read(
            $wire, $identity['accountId'], $identity['deviceId'],
        ));
        $this->assertDatabaseHas(self::TABLE, [
            'device_id' => $identity['deviceId'], 'phase' => 'preflight_only',
        ]);
    }

    public function test_recovery_key_revision_change_blocks_read_of_old_signed_intent(): void
    {
        $identity = $this->identity();
        $wire = $this->wire($identity);
        (new PreparedIntentLedger())->prepare($wire, $identity['accountId'], $identity['deviceId']);
        DB::table('identity_accounts')->where('id', $identity['accountId'])
            ->update(['revision' => 3]);
        $this->deny(fn () => (new PreparedIntentStatusReader())->read(
            $wire, $identity['accountId'], $identity['deviceId'],
        ));
        $this->assertDatabaseCount(self::TABLE, 1);
    }

    public function test_account_must_remain_ready_and_registered_key_must_match(): void
    {
        $identity = $this->identity();
        $wire = $this->wire($identity);
        (new PreparedIntentLedger())->prepare($wire, $identity['accountId'], $identity['deviceId']);
        DB::table('identity_accounts')->where('id', $identity['accountId'])
            ->update(['status' => 'retired']);
        $this->deny(fn () => (new PreparedIntentStatusReader())->read(
            $wire, $identity['accountId'], $identity['deviceId'],
        ));
        DB::table('identity_accounts')->where('id', $identity['accountId'])
            ->update(['status' => 'ready']);
        $other = $this->keys();
        DB::table('identity_devices')->where('id', $identity['deviceId'])
            ->update(['signing_spki' => $other['spki']]);
        $this->deny(fn () => (new PreparedIntentStatusReader())->read(
            $wire, $identity['accountId'], $identity['deviceId'],
        ));
        $this->assertDatabaseCount(self::TABLE, 1);
    }

    public function test_tampered_signature_new_signed_command_and_vault_widening_cannot_read(): void
    {
        $identity = $this->identity();
        $original = $this->wire($identity);
        (new PreparedIntentLedger())->prepare(
            $original, $identity['accountId'], $identity['deviceId'],
        );
        $forgery = $original;
        $other = $this->keys();
        $forgery['signature'] = $this->sign(self::DOMAIN.$original['contract'], $other['key']);
        $this->deny(fn () => (new PreparedIntentStatusReader())->read(
            $forgery, $identity['accountId'], $identity['deviceId'],
        ));
        $replacement = $this->wire($identity);
        $this->deny(fn () => (new PreparedIntentStatusReader())->read(
            $replacement, $identity['accountId'], $identity['deviceId'],
        ));
        $vault = $this->wire($identity, ['vault' => 'delete-last-recovery-backup']);
        $this->deny(fn () => (new PreparedIntentStatusReader())->read(
            $vault, $identity['accountId'], $identity['deviceId'],
        ));
        $this->assertDatabaseCount(self::TABLE, 1);
    }

    public function test_corrupt_stored_phase_hash_bytes_or_signature_cannot_launder_completed_status(): void
    {
        $identity = $this->identity();
        $wire = $this->wire($identity);
        $operationId = (new PreparedIntentLedger())->prepare(
            $wire, $identity['accountId'], $identity['deviceId'],
        )['operationId'];
        $record = (array) DB::table(self::TABLE)->where('operation_id', $operationId)->first();
        foreach ([
            ['phase' => 'cloud_deleted'],
            ['phase' => 'server_revoked'],
            ['contract_hash' => str_repeat('b', 64)],
            ['contract_json' => '{}'],
            ['signature' => 'AAAA'],
            ['key_revision' => 99],
        ] as $patch) {
            DB::table(self::TABLE)->where('operation_id', $operationId)->update($patch);
            $this->deny(fn () => (new PreparedIntentStatusReader())->read(
                $wire, $identity['accountId'], $identity['deviceId'],
            ));
            DB::table(self::TABLE)->where('operation_id', $operationId)->update($record);
        }
        self::assertSame('preflight_only', (new PreparedIntentStatusReader())->read(
            $wire, $identity['accountId'], $identity['deviceId'],
        )['phase']);
        $this->assertDatabaseCount(self::TABLE, 1);
    }

    public function test_signed_wire_cannot_borrow_another_account_operation_id(): void
    {
        $first = $this->identity();
        $second = $this->identity();
        $wire = $this->wire($first);
        $operationId = (new PreparedIntentLedger())->prepare(
            $wire, $first['accountId'], $first['deviceId'],
        )['operationId'];
        $different = $this->wire($second, ['operationId' => $operationId]);
        $this->deny(fn () => (new PreparedIntentStatusReader())->read(
            $different, $second['accountId'], $second['deviceId'],
        ));
        $this->assertDatabaseHas(self::TABLE, [
            'account_id' => $first['accountId'], 'operation_id' => $operationId,
        ]);
        $this->assertDatabaseCount(self::TABLE, 1);
    }
}
