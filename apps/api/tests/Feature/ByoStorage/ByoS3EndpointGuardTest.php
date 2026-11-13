<?php
declare(strict_types=1);

namespace Tests\Feature\ByoStorage;

use App\Storage\Byo\ByoS3EndpointGuard;
use App\Storage\Byo\ByoS3Pin;
use DomainException;
use PHPUnit\Framework\Attributes\DataProvider;
use PHPUnit\Framework\TestCase;

final class ByoS3EndpointGuardTest extends TestCase
{
    private ByoS3EndpointGuard $guard;

    protected function setUp(): void
    {
        parent::setUp();
        $this->guard = new ByoS3EndpointGuard();
    }

    private function reject(callable $operation, string $reason): void
    {
        try {
            $operation();
            self::fail('Unsafe BYO S3 candidate unexpectedly accepted: ' . $reason);
        } catch (DomainException $exception) {
            self::assertSame($reason, $exception->getMessage());
        }
    }

    public function test_public_https_origin_with_all_public_dns_answers_returns_immutable_pin(): void
    {
        $pin = $this->guard->admit('https://S3.Example.COM/', ['8.8.8.8', '1.1.1.1', '8.8.8.8']);

        self::assertInstanceOf(ByoS3Pin::class, $pin);
        self::assertSame('BYO_S3_PUBLIC_ENDPOINT_V1', $pin->policyVersion());
        self::assertSame('https://s3.example.com', $pin->origin);
        self::assertSame('s3.example.com', $pin->hostname);
        self::assertSame(443, $pin->port);
        self::assertSame(['8.8.8.8', '1.1.1.1'], $pin->addresses());
        $pin->assertConnectedPeer('1.1.1.1');
        $this->reject(
            static fn () => $pin->assertConnectedPeer('9.9.9.9'),
            'storage.byo_peer_not_pinned',
        );
    }

    public function test_trusted_server_port_policy_allows_explicit_tls_port_only(): void
    {
        $this->reject(
            fn () => $this->guard->admit('https://s3.example.com:9443', ['8.8.8.8']),
            'storage.byo_port_denied',
        );
        $pin = $this->guard->admit('https://s3.example.com:9443', ['8.8.8.8'], [443, 9443]);
        self::assertSame('https://s3.example.com:9443', $pin->origin);
        self::assertSame(9443, $pin->port);
    }

    public function test_explicit_default_port_is_canonicalized(): void
    {
        $pin = $this->guard->admit('https://s3.example.com:443/', ['8.8.8.8']);
        self::assertSame('https://s3.example.com', $pin->origin);
    }

    /** @return iterable<string,array{string}> */
    public static function badOrigins(): iterable
    {
        yield 'http plaintext' => ['http://s3.example.com'];
        yield 'other URL scheme' => ['ftp://s3.example.com'];
        yield 'userinfo token' => ['https://mykey:secret@s3.example.com'];
        yield 'query string' => ['https://s3.example.com/?token=secret'];
        yield 'fragment' => ['https://s3.example.com/#p'];
        yield 'bucket path' => ['https://s3.example.com/bucket'];
        yield 'backslash' => ['https://s3.example.com\@127.0.0.1'];
        yield 'trailing dot' => ['https://s3.example.com.'];
        yield 'double dot' => ['https://s3..example.com'];
        yield 'single label' => ['https://localhost'];
        yield 'internal name' => ['https://metadata.google.internal'];
        yield 'local TLD' => ['https://s3.home.local'];
        yield 'onion TLD' => ['https://s3.onion'];
        yield 'reserved docs TLD' => ['https://s3.test'];
        yield 'underscore label' => ['https://s3_bucket.example.com'];
        yield 'hyphen first' => ['https://-s3.example.com'];
        yield 'hyphen last' => ['https://s3-.example.com'];
        yield 'IP literal IPv4' => ['https://127.0.0.1'];
        yield 'IP literal IPv6' => ['https://[2001:4860:4860::8888]'];
        yield 'encoded host' => ['https://s3%2eexample.com'];
        yield 'numeric TLD' => ['https://0x7f.0.0.1'];
        yield 'uppercase scheme' => ['HTTPS://s3.example.com'];
        yield 'leading whitespace' => [" https://s3.example.com"];
        yield 'embedded newline' => ["https://s3.example.com\n"];
        yield 'empty' => [''];
    }

    #[DataProvider('badOrigins')]
    public function test_rejects_untrusted_url_syntax(string $endpoint): void
    {
        $this->reject(
            fn () => $this->guard->admit($endpoint, ['8.8.8.8']),
            'storage.byo_endpoint_invalid',
        );
    }

    /** @return iterable<string,array{string}> */
    public static function unsafeIpAddresses(): iterable
    {
        yield 'loopback ipv4' => ['127.0.0.1'];
        yield 'RFC1918 10' => ['10.0.0.1'];
        yield 'RFC1918 172' => ['172.16.0.1'];
        yield 'RFC1918 192' => ['192.168.1.1'];
        yield 'cloud metadata' => ['169.254.169.254'];
        yield 'CGNAT' => ['100.64.0.1'];
        yield 'IANA special' => ['192.0.0.8'];
        yield 'benchmarking' => ['198.18.0.1'];
        yield 'multicast' => ['224.0.0.1'];
        yield 'reserved high' => ['240.0.0.1'];
        yield 'unspecified' => ['0.0.0.0'];
        yield 'broadcast' => ['255.255.255.255'];
        yield 'ipv6 loopback' => ['::1'];
        yield 'ipv4 mapped' => ['::ffff:127.0.0.1'];
        yield 'ipv6 unique local' => ['fd00::1'];
        yield 'ipv6 link local' => ['fe80::1'];
        yield 'ipv6 docs' => ['2001:db8::1'];
        yield 'ipv6 6to4 private tunnel' => ['2002:a00:1::'];
        yield 'ipv6 Teredo' => ['2001::1'];
        yield 'ipv6 NAT64' => ['64:ff9b::a00:1'];
        yield 'malformed' => ['not-an-address'];
        yield 'zone id' => ['fe80::1%eth0'];
    }

    #[DataProvider('unsafeIpAddresses')]
    public function test_rejects_reserved_dns_records_and_ip_embedding(string $address): void
    {
        $this->reject(
            fn () => $this->guard->admit('https://s3.example.com', [$address]),
            'storage.byo_dns_unsafe',
        );
    }

    public function test_mixed_public_and_private_rrset_fails_closed_in_any_order(): void
    {
        foreach ([['8.8.8.8', '192.168.0.10'], ['192.168.0.10', '8.8.8.8']] as $records) {
            $this->reject(
                fn () => $this->guard->admit('https://s3.example.com', $records),
                'storage.byo_dns_unsafe',
            );
        }
    }

    public function test_dns_results_must_be_bounded_and_complete(): void
    {
        foreach ([[], array_fill(0, 17, '8.8.8.8'), ['8.8.8.8', '']] as $records) {
            $this->reject(
                fn () => $this->guard->admit('https://s3.example.com', $records),
                'storage.byo_dns_unsafe',
            );
        }
    }

    public function test_global_ipv6_is_allowed_but_peer_must_still_be_pinned(): void
    {
        $pin = $this->guard->admit('https://storage.example.com', ['2001:4860:4860::8888']);
        self::assertSame(['2001:4860:4860::8888'], $pin->addresses());
        $pin->assertConnectedPeer('2001:4860:4860:0:0:0:0:8888');
        $this->reject(
            static fn () => $pin->assertConnectedPeer('2001:4860:4860::8844'),
            'storage.byo_peer_not_pinned',
        );
    }

    public function test_missing_credentials_and_no_network_side_effects_are_contract_only(): void
    {
        $pin = $this->guard->admit('https://s3.example.com', ['8.8.8.8']);
        self::assertSame('https://s3.example.com', $pin->origin);
        self::assertFalse(property_exists($pin, 'accessKey'));
        self::assertFalse(property_exists($pin, 'secretKey'));
    }
}
