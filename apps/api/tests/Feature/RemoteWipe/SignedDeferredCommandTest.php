<?php
declare(strict_types=1);

namespace Tests\Feature\RemoteWipe;

use App\Identity\Protocol as IdentityProtocol;
use App\RemoteWipe\SignedDeferredCommand;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;
use Symfony\Component\HttpKernel\Exception\HttpException;
use Tests\TestCase;

final class SignedDeferredCommandTest extends TestCase
{
    use RefreshDatabase;

    private function key(): array
    {
        $key = openssl_pkey_new(['private_key_type' => OPENSSL_KEYTYPE_EC, 'curve_name' => 'prime256v1']);
        self::assertNotFalse($key);
        $details = openssl_pkey_get_details($key);
        self::assertIsArray($details);
        $body = preg_replace('/-----[^-]+-----|\s+/', '', $details['key']);
        return ['private' => $key, 'spki' => IdentityProtocol::encode(base64_decode($body, true))];
    }

    private function sign(string $message, mixed $private): string
    {
        self::assertTrue(openssl_sign($message, $der, $private, OPENSSL_ALGO_SHA256));
        self::assertSame(0x30, ord($der[0]));
        $offset = 2;
        $decode = static function () use (&$offset, $der): string {
            if (ord($der[$offset++]) !== 0x02) {
                throw new \RuntimeException('Invalid DER integer');
            }
            $length = ord($der[$offset++]);
            $raw = substr($der, $offset, $length);
            $offset += $length;
            $value = ltrim($raw, "\x00");
            if (strlen($value) > 32) {
                throw new \RuntimeException('Invalid P-256 scalar');
            }
            return str_pad($value, 32, "\x00", STR_PAD_LEFT);
        };
        return IdentityProtocol::encode($decode().$decode());
    }

    private function fixture(bool $targetRevoked = true): array
    {
        $accountId = (string) Str::uuid();
        $actorId = (string) Str::uuid();
        $targetId = (string) Str::uuid();
        $otherId = (string) Str::uuid();
        $root = $this->key();
        $actor = $this->key();
        $target = $this->key();
        $other = $this->key();

        DB::table('identity_accounts')->insert([
            'id' => $accountId,
            'operation_id' => (string) Str::uuid(),
            'prepare_hash' => str_repeat('a', 64),
            'status' => 'ready',
            'account_spki' => $root['spki'],
            'revision' => 1,
            'reserved_until' => now()->addHour(),
            'created_at' => now(),
            'updated_at' => now(),
        ]);
        foreach ([
            [$actorId, $actor, null],
            [$targetId, $target, $targetRevoked ? now() : null],
            [$otherId, $other, null],
        ] as [$id, $pair, $revoked]) {
            DB::table('identity_devices')->insert([
                'id' => $id,
                'account_id' => $accountId,
                'signing_spki' => $pair['spki'],
                'revoked_at' => $revoked,
                'created_at' => now(),
                'updated_at' => now(),
            ]);
        }
        return compact('accountId', 'actorId', 'targetId', 'otherId', 'root', 'actor', 'target', 'other');
    }

    private function command(array $fixture): array
    {
        return [
            'version' => 1,
            'operationId' => (string) Str::uuid(),
            'accountId' => $fixture['accountId'],
            'actorDeviceId' => $fixture['actorId'],
            'targetDeviceId' => $fixture['targetId'],
            'accountRevision' => 1,
            'scope' => 'device-local-only',
        ];
    }

    private function signedRegister(array $fixture, array $payload): array
    {
        $message = SignedDeferredCommand::commandMessage($payload);
        return (new SignedDeferredCommand())->register(
            $fixture['accountId'],
            $fixture['actorId'],
            $payload,
            $this->sign($message, $fixture['root']['private']),
            $this->sign($message, $fixture['actor']['private']),
        );
    }

    private function receipt(array $command): array
    {
        return [
            'version' => 1,
            'operationId' => $command['operationId'],
            'accountId' => $command['accountId'],
            'targetDeviceId' => $command['targetDeviceId'],
            'commandSha256' => hash('sha256', SignedDeferredCommand::commandMessage($command)),
            'result' => 'local_wipe_reported',
        ];
    }

    private function assertDenied(int $status, callable $operation): void
    {
        try {
            $operation();
            $this->fail("Expected HTTP {$status}");
        } catch (HttpException $exception) {
            $this->assertSame($status, $exception->getStatusCode());
        }
    }

    public function test_only_previously_revoked_device_can_receive_double_signed_pending_command(): void
    {
        $f = $this->fixture();
        $p = $this->command($f);

        $stored = $this->signedRegister($f, $p);
        $this->assertSame('wipe_pending', $stored['localWipeStatus']);
        $this->assertFalse($stored['localWipeProven']);
        $this->assertFalse($stored['cloudDeleted']);
        $this->assertFalse($stored['backupDeleted']);
        $this->assertFalse($stored['matrixRemoteRevoked']);
        $this->assertTrue($stored['pb3Revoked']);
        $this->assertFalse($stored['unchanged']);
        $this->assertDatabaseCount('remote_wipe_commands', 1);
        $this->assertDatabaseHas('remote_wipe_commands', [
            'account_id' => $f['accountId'],
            'actor_device_id' => $f['actorId'],
            'target_device_id' => $f['targetId'],
            'command_sha256' => hash('sha256', SignedDeferredCommand::commandMessage($p)),
            'target_reported_at' => null,
        ]);
        // The command itself MUST NOT revoke other devices or touch S3/backup.
        foreach ([$f['actorId'], $f['otherId']] as $id) {
            $this->assertDatabaseHas('identity_devices', ['id' => $id, 'revoked_at' => null]);
        }

        $retry = $this->signedRegister($f, $p);
        $this->assertTrue($retry['unchanged']);
        $this->assertSame('wipe_pending', $retry['localWipeStatus']);
        $this->assertDatabaseCount('remote_wipe_commands', 1);

        $another = [...$p, 'operationId' => (string) Str::uuid()];
        $this->assertDenied(409, fn () => $this->signedRegister($f, $another));
    }

    public function test_no_registration_before_authoritative_revoke_and_no_foreign_target(): void
    {
        $f = $this->fixture(false);
        $p = $this->command($f);
        $this->assertDenied(409, fn () => $this->signedRegister($f, $p));
        $this->assertDatabaseCount('remote_wipe_commands', 0);

        DB::table('identity_devices')->where('id', $f['targetId'])->update(['revoked_at' => now()]);
        $foreign = $this->fixture();
        $wrong = [...$p, 'targetDeviceId' => $foreign['targetId']];
        $this->assertDenied(409, fn () => $this->signedRegister($f, $wrong));

        $self = [...$p, 'targetDeviceId' => $f['actorId']];
        $this->assertDenied(422, fn () => $this->signedRegister($f, $self));
        $this->assertDatabaseCount('remote_wipe_commands', 0);
    }

    public function test_rejects_stale_revision_revoked_actor_and_mismatched_authenticated_actor(): void
    {
        $f = $this->fixture();
        $p = $this->command($f);
        $message = SignedDeferredCommand::commandMessage($p);
        $accountProof = $this->sign($message, $f['root']['private']);
        $actorProof = $this->sign($message, $f['actor']['private']);
        $service = new SignedDeferredCommand();

        $this->assertDenied(401, fn () => $service->register(
            $f['accountId'], $f['otherId'], $p, $accountProof, $actorProof,
        ));
        DB::table('identity_accounts')->where('id', $f['accountId'])->update(['revision' => 2]);
        $this->assertDenied(401, fn () => $this->signedRegister($f, $p));
        DB::table('identity_accounts')->where('id', $f['accountId'])->update(['revision' => 1]);
        DB::table('identity_devices')->where('id', $f['actorId'])->update(['revoked_at' => now()]);
        $this->assertDenied(401, fn () => $this->signedRegister($f, $p));
        $this->assertDatabaseCount('remote_wipe_commands', 0);
    }

    public function test_refuses_invalid_signature_cross_operation_replay_and_extra_fields(): void
    {
        $f = $this->fixture();
        $p = $this->command($f);
        $m = SignedDeferredCommand::commandMessage($p);
        $accountProof = $this->sign($m, $f['root']['private']);
        $actorProof = $this->sign($m, $f['actor']['private']);
        $service = new SignedDeferredCommand();

        $this->assertDenied(401, fn () => $service->register(
            $f['accountId'], $f['actorId'], $p,
            $this->sign($m, $f['other']['private']), $actorProof,
        ));
        $this->assertDenied(401, fn () => $service->register(
            $f['accountId'], $f['actorId'], $p,
            $accountProof, $this->sign($m, $f['target']['private']),
        ));
        $this->assertDenied(401, fn () => $service->register(
            $f['accountId'], $f['actorId'],
            [...$p, 'operationId' => (string) Str::uuid()],
            $accountProof, $actorProof,
        ));
        $this->assertDenied(422, fn () => $this->signedRegister($f, [...$p, 'wipeCloud' => true]));
        $this->assertDenied(422, fn () => $this->signedRegister($f, [...$p, 'scope' => 'cloud-all']));
        $this->assertDatabaseCount('remote_wipe_commands', 0);
    }

    public function test_target_receipt_requires_exact_original_command_and_target_signature(): void
    {
        $f = $this->fixture();
        $p = $this->command($f);
        $r = $this->receipt($p);
        $service = new SignedDeferredCommand();
        $targetProof = $this->sign(SignedDeferredCommand::receiptMessage($r), $f['target']['private']);

        $this->assertDenied(404, fn () => $service->receiveTargetReport($r, $targetProof));
        $this->signedRegister($f, $p);
        $this->assertDenied(401, fn () => $service->receiveTargetReport(
            $r, $this->sign(SignedDeferredCommand::receiptMessage($r), $f['actor']['private']),
        ));
        $this->assertDenied(404, fn () => $service->receiveTargetReport(
            [...$r, 'commandSha256' => str_repeat('0', 64)], $targetProof,
        ));
        $this->assertDenied(422, fn () => $service->receiveTargetReport(
            [...$r, 'result' => 'cloud_deleted'], $targetProof,
        ));
        $this->assertDatabaseHas('remote_wipe_commands', [
            'operation_id' => $p['operationId'],
            'target_reported_at' => null,
        ]);

        $reported = $service->receiveTargetReport($r, $targetProof);
        $this->assertSame('target_reported_local_wipe', $reported['localWipeStatus']);
        $this->assertFalse($reported['localWipeProven']);
        $this->assertFalse($reported['cloudDeleted']);
        $this->assertFalse($reported['matrixRemoteRevoked']);
        $this->assertFalse($reported['unchanged']);
        $again = $service->receiveTargetReport($r, $targetProof);
        $this->assertTrue($again['unchanged']);
        $this->assertDatabaseCount('remote_wipe_commands', 1);
        $this->assertSame('target_reported_local_wipe', $this->signedRegister($f, $p)['localWipeStatus']);
        $this->assertNotNull(DB::table('remote_wipe_commands')
            ->where('operation_id', $p['operationId'])->value('target_receipt_signature'));
    }
}
