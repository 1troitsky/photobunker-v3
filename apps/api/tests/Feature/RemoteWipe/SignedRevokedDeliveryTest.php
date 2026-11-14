<?php
declare(strict_types=1);

namespace Tests\Feature\RemoteWipe;

use App\Identity\Protocol;
use App\RemoteWipe\SignedDeferredCommand;
use App\RemoteWipe\SignedRevokedDelivery;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;
use Symfony\Component\HttpKernel\Exception\HttpException;
use Tests\TestCase;

final class SignedRevokedDeliveryTest extends TestCase
{
    use RefreshDatabase;

    private function key(): array
    {
        $private = openssl_pkey_new(['private_key_type' => OPENSSL_KEYTYPE_EC, 'curve_name' => 'prime256v1']);
        self::assertNotFalse($private);
        $detail = openssl_pkey_get_details($private);
        self::assertIsArray($detail);
        $body = preg_replace('/-----[^-]+-----|\s+/', '', $detail['key']);
        return [
            'private' => $private,
            'spki' => Protocol::encode(base64_decode($body, true)),
        ];
    }

    private function sign(string $message, mixed $private): string
    {
        self::assertTrue(openssl_sign($message, $der, $private, OPENSSL_ALGO_SHA256));
        self::assertSame(0x30, ord($der[0]));
        $offset = 2;
        $parse = static function () use ($der, &$offset): string {
            if (ord($der[$offset++]) !== 2) {
                throw new \RuntimeException('not ECDSA integer');
            }
            $length = ord($der[$offset++]);
            $scalar = ltrim(substr($der, $offset, $length), "\x00");
            $offset += $length;
            if (strlen($scalar) > 32) {
                throw new \RuntimeException('scalar overflow');
            }
            return str_pad($scalar, 32, "\x00", STR_PAD_LEFT);
        };
        return Protocol::encode($parse().$parse());
    }

    private function fixture(bool $targetRevoked = true): array
    {
        $accountId = (string) Str::uuid();
        $actorId = (string) Str::uuid();
        $targetId = (string) Str::uuid();
        $root = $this->key();
        $actor = $this->key();
        $target = $this->key();
        DB::table('identity_accounts')->insert([
            'id' => $accountId,
            'operation_id' => (string) Str::uuid(),
            'prepare_hash' => str_repeat('c', 64),
            'status' => 'ready',
            'account_spki' => $root['spki'],
            'revision' => 1,
            'reserved_until' => now()->addHour(),
            'created_at' => now(),
            'updated_at' => now(),
        ]);
        foreach ([
            [$actorId, $actor['spki'], null],
            [$targetId, $target['spki'], $targetRevoked ? now()->subMinute() : null],
        ] as [$deviceId, $spki, $revokedAt]) {
            DB::table('identity_devices')->insert([
                'id' => $deviceId,
                'account_id' => $accountId,
                'signing_spki' => $spki,
                'revoked_at' => $revokedAt,
                'created_at' => now(),
                'updated_at' => now(),
            ]);
        }
        return compact('accountId', 'actorId', 'targetId', 'root', 'actor', 'target');
    }

    private function register(array $fixture): array
    {
        $command = [
            'version' => 1,
            'operationId' => (string) Str::uuid(),
            'accountId' => $fixture['accountId'],
            'actorDeviceId' => $fixture['actorId'],
            'targetDeviceId' => $fixture['targetId'],
            'accountRevision' => 1,
            'scope' => 'device-local-only',
        ];
        $message = SignedDeferredCommand::commandMessage($command);
        $status = app(SignedDeferredCommand::class)->register(
            $fixture['accountId'], $fixture['actorId'], $command,
            $this->sign($message, $fixture['root']['private']),
            $this->sign($message, $fixture['actor']['private']),
        );
        $this->assertSame('wipe_pending', $status['localWipeStatus']);
        return $command;
    }

    private function request(array $fixture): array
    {
        return [
            'version' => 1,
            'requestId' => (string) Str::uuid(),
            'accountId' => $fixture['accountId'],
            'targetDeviceId' => $fixture['targetId'],
            'nonce' => Protocol::encode(random_bytes(32)),
            'issuedAt' => time(),
        ];
    }

    private function poll(array $request, mixed $private): array
    {
        $message = SignedRevokedDelivery::requestMessage($request);
        return app(SignedRevokedDelivery::class)->poll(
            $request, $this->sign($message, $private)
        );
    }

    private function denied(int $status, callable $operation): void
    {
        try {
            $operation();
            $this->fail('Expected HTTP '.$status);
        } catch (HttpException $error) {
            $this->assertSame($status, $error->getStatusCode());
        }
    }

    public function test_only_original_revoked_target_signer_gets_its_own_committed_command(): void
    {
        $f = $this->fixture();
        $cmd = $this->register($f);
        $r = $this->request($f);
        $out = $this->poll($r, $f['target']['private']);

        $this->assertSame($cmd['operationId'], $out['operationId']);
        $this->assertSame($f['targetId'], $out['targetDeviceId']);
        $this->assertSame('wipe_pending', $out['localWipeStatus']);
        foreach (['sessionGranted', 'localWipeProven', 'cloudDeleted', 'backupDeleted', 'matrixRemoteRevoked'] as $flag) {
            $this->assertFalse($out[$flag]);
        }
        $this->assertArrayNotHasKey('accountSession', $out);
        $this->assertArrayNotHasKey('accountSpki', $out);
        $this->assertArrayNotHasKey('media', $out);
        $this->assertSame(
            hash('sha256', "pb3.remote-wipe-command.v1\n".$out['commandPayload']),
            $out['commandSha256']
        );
        $signed = "pb3.remote-wipe-command.v1\n".$out['commandPayload'];
        $this->assertTrue(Protocol::verify($f['root']['spki'], $signed, $out['accountSignature']));
        $this->assertTrue(Protocol::verify($f['actor']['spki'], $signed, $out['actorSignature']));
        $this->assertSame($cmd, json_decode($out['commandPayload'], true));
        $this->assertDatabaseHas('remote_wipe_delivery_proofs', [
            'request_id' => $r['requestId'],
            'account_id' => $f['accountId'],
            'target_device_id' => $f['targetId'],
            'operation_id' => $cmd['operationId'],
            'proof_sha256' => hash('sha256', SignedRevokedDelivery::requestMessage($r)),
        ]);
        $this->assertDatabaseHas('remote_wipe_commands', [
            'operation_id' => $cmd['operationId'],
            'target_reported_at' => null,
        ]);
        $this->assertDatabaseHas('identity_devices', [
            'id' => $f['actorId'], 'revoked_at' => null,
        ]);
    }

    public function test_no_pending_no_revoke_no_foreign_or_forged_key_can_read_a_command(): void
    {
        $f = $this->fixture();
        $r = $this->request($f);
        $this->denied(404, fn () => $this->poll($r, $f['target']['private']));
        $this->assertDatabaseCount('remote_wipe_delivery_proofs', 0);

        $this->register($f);
        $other = $this->fixture();
        $this->denied(401, fn () => $this->poll($r, $f['actor']['private']));
        $this->denied(401, fn () => $this->poll($r, $other['target']['private']));
        $this->denied(404, fn () => $this->poll(
            [...$r, 'accountId' => $other['accountId']], $f['target']['private']
        ));
        $this->denied(404, fn () => $this->poll(
            [...$r, 'targetDeviceId' => $other['targetId']], $f['target']['private']
        ));
        $this->assertDatabaseCount('remote_wipe_delivery_proofs', 0);

        DB::table('identity_devices')->where('id', $f['targetId'])->update(['revoked_at' => null]);
        $this->denied(404, fn () => $this->poll($r, $f['target']['private']));
        $this->assertDatabaseCount('remote_wipe_delivery_proofs', 0);
    }

    public function test_canonical_short_lived_proof_rejects_bad_nonce_extra_fields_stale_clock(): void
    {
        $f = $this->fixture();
        $this->register($f);
        $r = $this->request($f);
        $this->denied(422, fn () => $this->poll(
            [...$r, 'scope' => 'all-cloud'], $f['target']['private']
        ));
        $this->denied(422, fn () => $this->poll(
            [...$r, 'nonce' => 'bad'], $f['target']['private']
        ));
        $this->denied(422, fn () => $this->poll(
            [...$r, 'issuedAt' => (string) time()], $f['target']['private']
        ));
        $this->denied(401, fn () => $this->poll(
            [...$r, 'issuedAt' => time() - 120], $f['target']['private']
        ));
        $this->denied(401, fn () => $this->poll(
            [...$r, 'issuedAt' => time() + 120], $f['target']['private']
        ));
        $this->assertDatabaseCount('remote_wipe_delivery_proofs', 0);
    }

    public function test_first_proof_is_one_time_and_throttles_even_new_signed_poll_ids(): void
    {
        $f = $this->fixture();
        $this->register($f);
        $r = $this->request($f);
        $this->poll($r, $f['target']['private']);
        $this->denied(409, fn () => $this->poll($r, $f['target']['private']));

        $next = $this->request($f);
        $this->denied(429, fn () => $this->poll($next, $f['target']['private']));
        $this->assertDatabaseCount('remote_wipe_delivery_proofs', 1);

        DB::table('remote_wipe_delivery_proofs')
            ->where('request_id', $r['requestId'])
            ->update(['created_at' => now()->subSeconds(17)]);
        $delivered = $this->poll($next, $f['target']['private']);
        $this->assertSame('wipe_pending', $delivered['localWipeStatus']);
        $this->assertDatabaseCount('remote_wipe_delivery_proofs', 2);
        $this->assertDatabaseCount('remote_wipe_commands', 1);
    }

    public function test_tampered_command_payload_cannot_be_delivered_or_acknowledged(): void
    {
        $f = $this->fixture();
        $cmd = $this->register($f);
        $r = $this->request($f);
        DB::table('remote_wipe_commands')->where('operation_id', $cmd['operationId'])
            ->update(['command_payload' => '{"scope":"cloud-delete"}']);
        $this->denied(409, fn () => $this->poll($r, $f['target']['private']));
        $this->assertDatabaseCount('remote_wipe_delivery_proofs', 0);
        $this->assertDatabaseHas('remote_wipe_commands', [
            'operation_id' => $cmd['operationId'], 'target_reported_at' => null,
        ]);
    }

    public function test_past_signed_command_remains_deliverable_after_account_revision_changes(): void
    {
        $f = $this->fixture();
        $cmd = $this->register($f);
        DB::table('identity_accounts')->where('id', $f['accountId'])
            ->update(['revision' => 2, 'account_spki' => $this->key()['spki']]);
        $out = $this->poll($this->request($f), $f['target']['private']);
        $this->assertSame($cmd['operationId'], $out['operationId']);
        $this->assertTrue(Protocol::verify($f['root']['spki'],
            "pb3.remote-wipe-command.v1\n".$out['commandPayload'], $out['accountSignature']));
        // The delivery intentionally never substitutes the rotated root key;
        // client must verify against previously trusted issuer key itself.
        $this->assertFalse($out['localWipeProven']);
    }

    public function test_no_delivery_after_target_reports_prior_signed_command(): void
    {
        $f = $this->fixture();
        $cmd = $this->register($f);
        $receipt = [
            'version' => 1,
            'operationId' => $cmd['operationId'],
            'accountId' => $cmd['accountId'],
            'targetDeviceId' => $cmd['targetDeviceId'],
            'commandSha256' => hash('sha256', SignedDeferredCommand::commandMessage($cmd)),
            'result' => 'local_wipe_reported',
        ];
        $msg = SignedDeferredCommand::receiptMessage($receipt);
        app(SignedDeferredCommand::class)->receiveTargetReport(
            $receipt, $this->sign($msg, $f['target']['private'])
        );
        $this->denied(404, fn () => $this->poll(
            $this->request($f), $f['target']['private']
        ));
        $this->assertDatabaseCount('remote_wipe_delivery_proofs', 0);
        $this->assertDatabaseHas('remote_wipe_commands', [
            'operation_id' => $cmd['operationId'],
            'target_receipt_sha256' => hash('sha256', $msg),
        ]);
    }
}
