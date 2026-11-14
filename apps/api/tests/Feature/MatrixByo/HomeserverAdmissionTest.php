<?php
declare(strict_types=1);

namespace Tests\Feature\MatrixByo;

use App\Matrix\Byo\HomeserverCapabilities;
use App\Matrix\Byo\HomeserverEndpointGuard;
use PHPUnit\Framework\TestCase;

final class HomeserverAdmissionTest extends TestCase
{
    private const USER = '@alice:team.example.org';
    private const DEVICE = 'PB3_DEVICE_7';

    /** @param callable():mixed $operation */
    private function rejects(callable $operation, string $code): void
    {
        try {
            $operation();
            self::fail('Unsafe BYO admission succeeded: ' . $code);
        } catch (\DomainException $exception) {
            self::assertSame($code, $exception->getMessage());
        }
    }

    public function test_admits_strict_https_origin_public_dns_and_exact_socket_peer(): void
    {
        $pin = (new HomeserverEndpointGuard())->admit(
            'https://Matrix.Team.Example.ORG:443/',
            ['1.1.1.1', '2606:4700:4700::1111', '1.1.1.1']
        );
        self::assertSame('https://matrix.team.example.org', $pin->origin);
        self::assertSame('matrix.team.example.org', $pin->hostname);
        self::assertSame(['1.1.1.1', '2606:4700:4700::1111'], $pin->approvedAddresses);
        $pin->assertPeer('1.1.1.1');
        $pin->assertPeer('2606:4700:4700:0:0:0:0:1111');
        $this->rejects(fn () => $pin->assertPeer('8.8.8.8'), 'matrix.byo_peer_mismatch');
        $this->rejects(fn () => $pin->assertPeer('127.0.0.1'), 'matrix.byo_peer_mismatch');
        $this->rejects(fn () => $pin->assertPeer('not-an-ip'), 'matrix.byo_peer_mismatch');
    }

    public function test_rejects_local_names_credentials_paths_queries_and_non_tls(): void
    {
        foreach ([
            '', 'http://matrix.example.org', 'https://localhost',
            'https://matrix.local', 'https://matrix.example',
            'https://127.0.0.1', 'https://[::1]',
            'https://a..example.org', 'https://-a.example.org',
            'https://a-.example.org', 'https://matrix.example.org:8448',
            'https://user:secret@matrix.example.org',
            'https://matrix.example.org/_matrix/client/versions',
            'https://matrix.example.org/?token=secret',
            'https://matrix.example.org#fragment',
            'https://matrix.example.org\\@metadata.internal',
            'https://matrix.example.org ', "https://matrix.example.org\n",
            'HTTPS://matrix.example.org', 'https://matrix.example.org:99999',
        ] as $unsafe) {
            $this->rejects(
                fn () => (new HomeserverEndpointGuard())->admit($unsafe, ['1.1.1.1']),
                'matrix.byo_origin_invalid'
            );
        }
    }

    public function test_rejects_missing_mixed_private_metadata_and_reserved_dns_records(): void
    {
        foreach ([
            [], ['1.1.1.1', '127.0.0.1'], ['1.1.1.1', '10.0.0.1'],
            ['1.1.1.1', '169.254.169.254'], ['100.64.1.1'],
            ['198.18.0.1'], ['192.0.2.1'], ['198.51.100.1'],
            ['203.0.113.1'], ['0.1.2.3'], ['224.0.0.1'],
            ['::1'], ['::ffff:127.0.0.1'], ['fc00::1'],
            ['fe80::1'], ['2001:db8::1'], ['2002::1'],
            ['not-an-ip'], array_fill(0, 17, '1.1.1.1'),
        ] as $unsafe) {
            $this->rejects(
                fn () => (new HomeserverEndpointGuard())->admit('https://matrix.team.org', $unsafe),
                'matrix.byo_dns_unsafe'
            );
        }
    }

    /** @return array{0:array<string,mixed>,1:array<string,mixed>,2:array<string,mixed>} */
    private function validReplies(): array
    {
        return [
            ['versions' => ['v1.3', 'v1.11']],
            ['capabilities' => [
                'm.room_versions' => ['default' => '10', 'available' => [
                    '10' => 'stable', '11' => 'unstable',
                ]],
            ]],
            ['user_id' => self::USER, 'device_id' => self::DEVICE, 'is_guest' => false],
        ];
    }

    public function test_accepts_only_trusted_unlimited_plus_plan_and_matrix_identity(): void
    {
        [$versions, $capabilities, $whoami] = $this->validReplies();
        $policy = new HomeserverCapabilities();

        self::assertSame([
            'apiVersion' => 'v1.11',
            'defaultRoomVersion' => '10',
            'matrixUserId' => self::USER,
            'matrixDeviceId' => self::DEVICE,
        ], $policy->verify('unlimited_plus', self::USER, self::DEVICE,
            $versions, $capabilities, $whoami));

        foreach (['free', 'go', 'pro', 'unlimited', '', 'UNLIMITED_PLUS'] as $plan) {
            $this->rejects(
                fn () => $policy->verify($plan, self::USER, self::DEVICE,
                    $versions, $capabilities, $whoami),
                'matrix.byo_entitlement_denied'
            );
        }
    }

    public function test_wrong_identity_guest_and_missing_device_are_denied(): void
    {
        [$versions, $capabilities, $whoami] = $this->validReplies();
        $policy = new HomeserverCapabilities();
        foreach ([
            ['user_id' => '@mallory:team.example.org'],
            ['device_id' => 'WRONG'], ['device_id' => null],
            ['user_id' => null], ['is_guest' => true], ['is_guest' => 'false'],
        ] as $mutation) {
            $this->rejects(
                fn () => $policy->verify('unlimited_plus', self::USER, self::DEVICE,
                    $versions, $capabilities, array_replace($whoami, $mutation)),
                'matrix.byo_identity_mismatch'
            );
        }
        $this->rejects(
            fn () => $policy->verify('unlimited_plus', '@invalid', self::DEVICE,
                $versions, $capabilities, $whoami),
            'matrix.byo_identity_mismatch'
        );
    }

    public function test_unsupported_versions_and_unstable_rooms_are_denied(): void
    {
        [$versions, $capabilities, $whoami] = $this->validReplies();
        $policy = new HomeserverCapabilities();

        foreach ([
            [], ['versions' => []], ['versions' => ['r0.6.1']],
            ['versions' => ['v1.0']], ['versions' => ['v1.11', 15]],
            ['versions' => array_fill(0, 65, 'v1.11')],
        ] as $bad) {
            $this->rejects(
                fn () => $policy->verify('unlimited_plus', self::USER, self::DEVICE,
                    $bad, $capabilities, $whoami),
                'matrix.byo_versions_unsupported'
            );
        }

        foreach ([
            [], ['capabilities' => []],
            ['capabilities' => ['m.room_versions' => ['default' => '10']]],
            ['capabilities' => ['m.room_versions' => [
                'default' => '11', 'available' => ['11' => 'unstable'],
            ]]],
            ['capabilities' => ['m.room_versions' => [
                'default' => '10', 'available' => ['10' => true],
            ]]],
        ] as $bad) {
            $this->rejects(
                fn () => $policy->verify('unlimited_plus', self::USER, self::DEVICE,
                    $versions, $bad, $whoami),
                'matrix.byo_capabilities_unsupported'
            );
        }
    }
}
