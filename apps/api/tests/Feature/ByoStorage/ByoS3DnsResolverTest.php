<?php
declare(strict_types=1);

namespace Tests\Feature\ByoStorage;

use App\Storage\Byo\ByoS3DnsResolver;
use DomainException;
use PHPUnit\Framework\Attributes\DataProvider;
use PHPUnit\Framework\TestCase;

final class ByoS3DnsResolverTest extends TestCase
{
    private ByoS3DnsResolver $resolver;

    protected function setUp(): void
    {
        parent::setUp();
        $this->resolver = new ByoS3DnsResolver();
    }

    private function rejects(callable $action, string $code = 'storage.byo_dns_unsafe'): void
    {
        try {
            $action();
            self::fail('Untrusted DNS record was accepted');
        } catch (DomainException $e) {
            self::assertSame($code, $e->getMessage());
        }
    }

    /** @return array<string,mixed> */
    private static function a(string $host, string $ip): array
    {
        return ['host' => $host, 'type' => 'A', 'ip' => $ip];
    }

    /** @return array<string,mixed> */
    private static function aaaa(string $host, string $ip): array
    {
        return ['host' => $host, 'type' => 'AAAA', 'ipv6' => $ip];
    }

    /** @return array<string,mixed> */
    private static function cname(string $host, string $target): array
    {
        return ['host' => $host, 'type' => 'CNAME', 'target' => $target];
    }

    public function test_all_public_ipv4_and_ipv6_are_pinned_to_original_tls_hostname(): void
    {
        $asked = [];
        $lookup = static function (string $host) use (&$asked): array {
            $asked[] = $host;
            return [
                self::a('s3.example.com.', '8.8.8.8'),
                self::aaaa('S3.Example.Com.', '2001:4860:4860::8888'),
            ];
        };

        $pin = $this->resolver->resolve('https://S3.Example.COM/', $lookup);
        self::assertSame(['s3.example.com'], $asked);
        self::assertSame('s3.example.com', $pin->hostname);
        self::assertSame('https://s3.example.com', $pin->origin);
        self::assertSame(['8.8.8.8', '2001:4860:4860::8888'], $pin->addresses());
        $pin->assertConnectedPeer('2001:4860:4860:0:0:0:0:8888');
        $this->rejects(
            static fn () => $pin->assertConnectedPeer('9.9.9.9'),
            'storage.byo_peer_not_pinned',
        );
    }

    public function test_verified_cname_chain_ends_in_public_address_without_changing_tls_hostname(): void
    {
        $asked = [];
        $rr = [
            's3.example.com' => [self::cname('s3.example.com', 'route.storage.example.net.')],
            'route.storage.example.net' => [self::cname('route.storage.example.net', 'edge.storage.example.org')],
            'edge.storage.example.org' => [self::a('edge.storage.example.org', '1.1.1.1')],
        ];
        $lookup = static function (string $host) use ($rr, &$asked): array {
            $asked[] = $host;
            return $rr[$host] ?? [];
        };
        $pin = $this->resolver->resolve('https://s3.example.com', $lookup);
        self::assertSame(['s3.example.com', 'route.storage.example.net', 'edge.storage.example.org'], $asked);
        self::assertSame('s3.example.com', $pin->hostname);
        self::assertSame(['1.1.1.1'], $pin->addresses());
    }

    public function test_origin_rejected_before_any_dns_request(): void
    {
        $calls = 0;
        $lookup = static function (string $name) use (&$calls): array {
            $calls++;
            return [self::a($name, '8.8.8.8')];
        };
        foreach (['https://127.0.0.1', 'http://s3.example.com', 'https://metadata.google.internal', 'https://foo.example.com/bucket'] as $bad) {
            $this->rejects(
                fn () => $this->resolver->resolve($bad, $lookup),
                'storage.byo_endpoint_invalid',
            );
        }
        self::assertSame(0, $calls);
    }

    public function test_private_cname_target_is_rejected_without_dns_query_for_target(): void
    {
        $asked = [];
        $lookup = static function (string $host) use (&$asked): array {
            $asked[] = $host;
            return [self::cname($host, 'metadata.google.internal.')];
        };
        $this->rejects(fn () => $this->resolver->resolve('https://s3.example.com', $lookup));
        self::assertSame(['s3.example.com'], $asked);
    }

    public function test_cname_loop_and_self_reference_are_rejected(): void
    {
        foreach ([
            ['s3.example.com' => [self::cname('s3.example.com', 's3.example.com')]],
            [
                's3.example.com' => [self::cname('s3.example.com', 'alias.example.net')],
                'alias.example.net' => [self::cname('alias.example.net', 's3.example.com')],
            ],
        ] as $responses) {
            $lookup = static fn (string $host): array => $responses[$host] ?? [];
            $this->rejects(fn () => $this->resolver->resolve('https://s3.example.com', $lookup));
        }
    }

    public function test_cname_hop_cap_rejects_long_chain(): void
    {
        $lookups = 0;
        $lookup = static function (string $host) use (&$lookups): array {
            $lookups++;
            return [self::cname($host, 'node' . $lookups . '.example.com')];
        };
        $this->rejects(fn () => $this->resolver->resolve('https://s3.example.com', $lookup));
        self::assertSame(9, $lookups);
    }

    public function test_mixed_cname_with_a_or_aaaa_is_rejected(): void
    {
        $lookup = static fn (string $host): array => [
            self::cname($host, 'edge.example.com'),
            self::a($host, '8.8.8.8'),
        ];
        $this->rejects(fn () => $this->resolver->resolve('https://s3.example.com', $lookup));
    }

    public function test_multiple_cnames_with_same_owner_are_rejected(): void
    {
        $lookup = static fn (string $host): array => [
            self::cname($host, 'edge1.example.com'),
            self::cname($host, 'edge2.example.com'),
        ];
        $this->rejects(fn () => $this->resolver->resolve('https://s3.example.com', $lookup));
    }

    public function test_private_address_hidden_in_final_public_dns_set_rejects_entire_resolution(): void
    {
        $lookup = static fn (string $host): array => [
            self::a($host, '8.8.8.8'),
            self::a($host, '169.254.169.254'),
        ];
        $this->rejects(fn () => $this->resolver->resolve('https://s3.example.com', $lookup));
    }

    public function test_cname_target_resolving_to_loopback_denies_entire_resolution(): void
    {
        $lookup = static fn (string $host): array => $host === 's3.example.com'
            ? [self::cname($host, 'edge.example.net')]
            : [self::a($host, '127.0.0.1')];
        $this->rejects(fn () => $this->resolver->resolve('https://s3.example.com', $lookup));
    }

    /** @return iterable<string,array{array<mixed>}> */
    public static function malformedDnsResponses(): iterable
    {
        yield 'no records' => [[]];
        yield 'array not a list' => [[1 => self::a('s3.example.com', '8.8.8.8')]];
        yield 'too many records' => [array_fill(0, 25, self::a('s3.example.com', '8.8.8.8'))];
        yield 'missing owner' => [[['type' => 'A', 'ip' => '8.8.8.8']]];
        yield 'wrong owner' => [[self::a('other.example.com', '8.8.8.8')]];
        yield 'missing type' => [[['host' => 's3.example.com', 'ip' => '8.8.8.8']]];
        yield 'TXT response' => [[['host' => 's3.example.com', 'type' => 'TXT', 'txt' => 'ignored']]];
        yield 'A missing IP' => [[['host' => 's3.example.com', 'type' => 'A']]];
        yield 'AAAA missing address' => [[['host' => 's3.example.com', 'type' => 'AAAA']]];
        yield 'CNAME missing target' => [[['host' => 's3.example.com', 'type' => 'CNAME']]];
        yield 'malformed IP' => [[self::a('s3.example.com', 'not_an_ip')]];
        yield 'IPv6 tunnel' => [[self::aaaa('s3.example.com', '2002:a00:1::')]];
        yield 'duplicate root DNS owner' => [[self::a('s3.example.com..', '8.8.8.8')]];
    }

    #[DataProvider('malformedDnsResponses')]
    public function test_invalid_responses_are_fail_closed(array $response): void
    {
        $this->rejects(fn () => $this->resolver->resolve('https://s3.example.com', static fn () => $response));
    }

    public function test_dns_lookup_exception_is_denied_without_leaking_exception(): void
    {
        $lookup = static function (): never {
            throw new \RuntimeException('upstream-secret-never-expose');
        };
        $this->rejects(fn () => $this->resolver->resolve('https://s3.example.com', $lookup));
    }

    public function test_no_response_after_valid_cname_denies_resolution(): void
    {
        $lookup = static fn (string $host): array => $host === 's3.example.com'
            ? [self::cname($host, 'edge.example.net')]
            : [];
        $this->rejects(fn () => $this->resolver->resolve('https://s3.example.com', $lookup));
    }

    public function test_unapproved_origin_port_is_denied_before_dns_io(): void
    {
        $calls = 0;
        $lookup = static function (string $host) use (&$calls): array {
            $calls++;
            return [self::a($host, '8.8.8.8')];
        };
        $this->rejects(
            fn () => $this->resolver->resolve('https://s3.example.com:9443', $lookup),
            'storage.byo_port_denied',
        );
        self::assertSame(0, $calls);
        $pin = $this->resolver->resolve('https://s3.example.com:9443', $lookup, [443, 9443]);
        self::assertSame(9443, $pin->port);
        self::assertSame(1, $calls);
    }
}
