<?php
declare(strict_types=1);

namespace Tests\Feature\MatrixByo;

use App\Matrix\Byo\HomeserverDnsResolver;
use PHPUnit\Framework\TestCase;

final class HomeserverDnsResolverTest extends TestCase
{
    /** @param callable():mixed $operation */
    private function rejects(callable $operation, string $code = 'matrix.byo_dns_unsafe'): void
    {
        try {
            $operation();
            self::fail('An unsafe Matrix homeserver DNS answer was accepted');
        } catch (\DomainException $e) {
            self::assertSame($code, $e->getMessage());
        }
    }

    public function test_retains_original_tls_hostname_after_one_cname_and_public_a_aaaa(): void
    {
        $queried = [];
        $pin = (new HomeserverDnsResolver())->resolve(
            'https://Matrix.Team.Org/',
            static function (string $host) use (&$queried): array {
                $queried[] = $host;
                return match ($host) {
                    'matrix.team.org' => [
                        ['host' => $host, 'type' => 'CNAME', 'target' => 'edge.team.org.'],
                    ],
                    'edge.team.org' => [
                        ['host' => 'edge.team.org.', 'type' => 'A', 'ip' => '1.1.1.1'],
                        ['host' => $host, 'type' => 'AAAA',
                            'ipv6' => '2606:4700:4700::1111'],
                    ],
                    default => throw new \RuntimeException('unknown lookup'),
                };
            }
        );
        self::assertSame(['matrix.team.org', 'edge.team.org'], $queried);
        self::assertSame('matrix.team.org', $pin->hostname);
        self::assertSame('https://matrix.team.org', $pin->origin);
        self::assertSame(['1.1.1.1', '2606:4700:4700::1111'],
            $pin->approvedAddresses);
    }

    public function test_rejects_invalid_origin_before_any_dns_lookup(): void
    {
        $calls = 0;
        $this->rejects(
            static function () use (&$calls): void {
                (new HomeserverDnsResolver())->resolve(
                    'http://127.0.0.1/',
                    static function () use (&$calls): array {
                        $calls++;
                        return [];
                    }
                );
            },
            'matrix.byo_origin_invalid'
        );
        self::assertSame(0, $calls);
    }

    public function test_rejects_private_cname_target_without_resolving_it(): void
    {
        $queried = [];
        $this->rejects(
            static function () use (&$queried): void {
                (new HomeserverDnsResolver())->resolve(
                    'https://matrix.team.org',
                    static function (string $host) use (&$queried): array {
                        $queried[] = $host;
                        return [['host' => $host, 'type' => 'CNAME',
                            'target' => 'metadata.internal.']];
                    }
                );
            }
        );
        self::assertSame(['matrix.team.org'], $queried);
    }

    public function test_rejects_mixed_cname_and_address_and_multiple_aliases(): void
    {
        foreach ([
            [
                ['host' => 'matrix.team.org', 'type' => 'CNAME',
                    'target' => 'edge.team.org'],
                ['host' => 'matrix.team.org', 'type' => 'A', 'ip' => '1.1.1.1'],
            ],
            [
                ['host' => 'matrix.team.org', 'type' => 'CNAME',
                    'target' => 'edge.team.org'],
                ['host' => 'matrix.team.org', 'type' => 'CNAME',
                    'target' => 'other.team.org'],
            ],
        ] as $bad) {
            $this->rejects(fn () => (new HomeserverDnsResolver())->resolve(
                'https://matrix.team.org', static fn () => $bad
            ));
        }
    }

    public function test_rejects_unknown_records_wrong_owner_incomplete_and_dns_outage(): void
    {
        foreach ([
            [],
            [['host' => 'evil.team.org', 'type' => 'A', 'ip' => '1.1.1.1']],
            [['host' => 'matrix.team.org', 'type' => 'TXT', 'txt' => 'a']],
            [['host' => 'matrix.team.org', 'type' => 'A']],
            [['host' => 'matrix.team.org', 'type' => 'AAAA']],
            [['host' => 'matrix.team.org', 'type' => 'CNAME']],
            array_fill(0, 25, ['host' => 'matrix.team.org',
                'type' => 'A', 'ip' => '1.1.1.1']),
            [['host' => 'matrix.team.org', 'type' => 'A', 'ip' => '1.1.1.1'],
                ['host' => 'matrix.team.org', 'type' => 'A', 'ip' => '10.0.0.2']],
        ] as $bad) {
            $this->rejects(fn () => (new HomeserverDnsResolver())->resolve(
                'https://matrix.team.org', static fn () => $bad
            ));
        }

        $this->rejects(fn () => (new HomeserverDnsResolver())->resolve(
            'https://matrix.team.org',
            static fn () => throw new \RuntimeException('DNS is unavailable')
        ));
    }

    public function test_detects_cname_loop_and_chain_overflow(): void
    {
        $this->rejects(fn () => (new HomeserverDnsResolver())->resolve(
            'https://matrix.team.org',
            static fn (string $host) => [[
                'host' => $host,
                'type' => 'CNAME',
                'target' => $host,
            ]]
        ));

        $this->rejects(fn () => (new HomeserverDnsResolver())->resolve(
            'https://matrix.team.org',
            static function (string $host): array {
                $first = explode('.', $host)[0];
                $index = $first === 'matrix' ? 0 : (int) substr($first, 1);
                return [['host' => $host, 'type' => 'CNAME',
                    'target' => 'h' . ($index + 1) . '.team.org']];
            }
        ));
    }

    public function test_rejects_trailing_dot_special_name_from_cname_chain(): void
    {
        $this->rejects(fn () => (new HomeserverDnsResolver())->resolve(
            'https://matrix.team.org',
            static fn (string $host): array => [
                ['host' => $host, 'type' => 'CNAME', 'target' => 'localhost.'],
            ]
        ));
    }
}
