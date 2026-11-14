<?php
declare(strict_types=1);

// Test-only namespace-scoped libcurl shim: capture the exact options used by
// the production transport without making any network request. PHP resolves
// namespace functions before the global ext-curl functions. These functions
// are defined ONLY in this PHPUnit test file, never in production autoload.
namespace App\Matrix\Byo {
    final class MatrixCurlFake
    {
        /** @var array<int,mixed> */
        public static array $options = [];
        public static string $url = '';
        public static string $body = '';
        public static int $status = 200;
        public static string $peer = '1.1.1.1';
        public static bool $fail = false;
        public static bool $closed = false;

        public static function reset(): void
        {
            self::$options = [];
            self::$url = '';
            self::$body = '{"versions":["v1.3","v1.11"]}';
            self::$status = 200;
            self::$peer = '1.1.1.1';
            self::$fail = false;
            self::$closed = false;
        }
    }

    function curl_init(string $url): object
    {
        MatrixCurlFake::$url = $url;
        return new \stdClass();
    }

    /** @param array<int,mixed> $options */
    function curl_setopt_array(object $handle, array $options): bool
    {
        MatrixCurlFake::$options = $options;
        return true;
    }

    function curl_exec(object $handle): bool
    {
        if (MatrixCurlFake::$fail) {
            return false;
        }
        $headers = MatrixCurlFake::$options[\CURLOPT_HEADERFUNCTION];
        foreach ([
            'HTTP/1.1 ' . MatrixCurlFake::$status . " RESPONSE\r\n",
            "Content-Type: application/json\r\n",
            "\r\n",
        ] as $line) {
            if ($headers($handle, $line) !== strlen($line)) {
                return false;
            }
        }
        $write = MatrixCurlFake::$options[\CURLOPT_WRITEFUNCTION];
        return $write($handle, MatrixCurlFake::$body) === strlen(MatrixCurlFake::$body);
    }

    function curl_getinfo(object $handle, int $option): int|string
    {
        return match ($option) {
            \CURLINFO_RESPONSE_CODE => MatrixCurlFake::$status,
            \CURLINFO_PRIMARY_IP => MatrixCurlFake::$peer,
            default => throw new \RuntimeException('unexpected curl_getinfo'),
        };
    }

    function curl_close(object $handle): void
    {
        MatrixCurlFake::$closed = true;
    }
}

namespace Tests\Feature\MatrixByo {
    use App\Matrix\Byo\HomeserverHttpsTransport;
    use App\Matrix\Byo\HomeserverPin;
    use App\Matrix\Byo\MatrixCurlFake;
    use PHPUnit\Framework\TestCase;

    final class HomeserverHttpsTransportTest extends TestCase
    {
        protected function setUp(): void
        {
            parent::setUp();
            MatrixCurlFake::reset();
        }

        /** @param callable():mixed $operation */
        private function rejects(callable $operation, string $code): void
        {
            try {
                $operation();
                self::fail('Unsafe cURL Matrix transport result accepted: ' . $code);
            } catch (\DomainException $e) {
                self::assertSame($code, $e->getMessage());
            }
        }

        private function pin(array $ips = ['1.1.1.1']): HomeserverPin
        {
            return new HomeserverPin(
                'https://matrix.team.org', 'matrix.team.org', $ips
            );
        }

        public function test_only_public_versions_endpoint_with_pinned_tls_no_proxy_or_redirect(): void
        {
            self::assertSame(
                ['versions' => ['v1.3', 'v1.11']],
                (new HomeserverHttpsTransport())->readPinnedPublicVersions($this->pin())
            );
            self::assertSame(
                'https://matrix.team.org/_matrix/client/versions',
                MatrixCurlFake::$url
            );

            $options = MatrixCurlFake::$options;
            self::assertSame(['matrix.team.org:443:1.1.1.1'],
                $options[\CURLOPT_RESOLVE]);
            self::assertSame(\CURL_IPRESOLVE_V4, $options[\CURLOPT_IPRESOLVE]);
            self::assertSame('', $options[\CURLOPT_PROXY]);
            self::assertSame('*', $options[\CURLOPT_NOPROXY]);
            self::assertFalse($options[\CURLOPT_FOLLOWLOCATION]);
            self::assertSame(0, $options[\CURLOPT_MAXREDIRS]);
            self::assertSame(\CURLPROTO_HTTPS, $options[\CURLOPT_PROTOCOLS]);
            self::assertSame(\CURLPROTO_HTTPS, $options[\CURLOPT_REDIR_PROTOCOLS]);
            self::assertTrue($options[\CURLOPT_SSL_VERIFYPEER]);
            self::assertSame(2, $options[\CURLOPT_SSL_VERIFYHOST]);
            self::assertTrue($options[\CURLOPT_FRESH_CONNECT]);
            self::assertTrue($options[\CURLOPT_FORBID_REUSE]);
            self::assertSame(0, $options[\CURLOPT_DNS_CACHE_TIMEOUT]);
            self::assertSame(2000, $options[\CURLOPT_CONNECTTIMEOUT_MS]);
            self::assertSame(5000, $options[\CURLOPT_TIMEOUT_MS]);
            self::assertSame(['Accept: application/json'], $options[\CURLOPT_HTTPHEADER]);
            self::assertTrue(MatrixCurlFake::$closed);
        }

        public function test_ipv6_pin_is_bracketed_and_peer_normalized(): void
        {
            MatrixCurlFake::$peer = '2606:4700:4700:0:0:0:0:1111';
            self::assertSame(
                ['versions' => ['v1.3', 'v1.11']],
                (new HomeserverHttpsTransport())->readPinnedPublicVersions(
                    $this->pin(['2606:4700:4700::1111'])
                )
            );
            self::assertSame(
                ['matrix.team.org:443:[2606:4700:4700::1111]'],
                MatrixCurlFake::$options[\CURLOPT_RESOLVE]
            );
            self::assertSame(\CURL_IPRESOLVE_V6,
                MatrixCurlFake::$options[\CURLOPT_IPRESOLVE]);
        }

        public function test_unexpected_actual_peer_and_3xx_and_curl_errors_denied(): void
        {
            MatrixCurlFake::$peer = '8.8.8.8';
            $this->rejects(
                fn () => (new HomeserverHttpsTransport())->readPinnedPublicVersions($this->pin()),
                'matrix.byo_peer_mismatch'
            );

            MatrixCurlFake::reset();
            MatrixCurlFake::$status = 302;
            $this->rejects(
                fn () => (new HomeserverHttpsTransport())->readPinnedPublicVersions($this->pin()),
                'matrix.byo_transport_unavailable'
            );

            MatrixCurlFake::reset();
            MatrixCurlFake::$fail = true;
            $this->rejects(
                fn () => (new HomeserverHttpsTransport())->readPinnedPublicVersions($this->pin()),
                'matrix.byo_transport_unavailable'
            );
        }

        public function test_response_body_and_headers_are_bounded(): void
        {
            MatrixCurlFake::$body = str_repeat('X', 65537);
            $this->rejects(
                fn () => (new HomeserverHttpsTransport())->readPinnedPublicVersions($this->pin()),
                'matrix.byo_response_too_large'
            );
        }

        public function test_untrusted_json_or_unsupported_version_is_denied(): void
        {
            foreach ([
                '{invalid', '{"versions":[]}', '{"versions":["v1.0"]}',
                '{"versions":[123]}', '{"versions":["r0.6.1"]}',
                '{"versions":"v1.11"}', '[]',
            ] as $bad) {
                MatrixCurlFake::reset();
                MatrixCurlFake::$body = $bad;
                $this->rejects(
                    fn () => (new HomeserverHttpsTransport())->readPinnedPublicVersions($this->pin()),
                    'matrix.byo_versions_unsupported'
                );
            }
        }

        public function test_malformed_or_private_pin_rejected_before_opening_socket(): void
        {
            foreach ([
                new HomeserverPin('http://matrix.team.org', 'matrix.team.org', ['1.1.1.1']),
                new HomeserverPin('https://matrix.team.org', 'matrix.team.org', ['127.0.0.1']),
                new HomeserverPin('https://matrix.team.org', 'evil.team.org', ['1.1.1.1']),
                new HomeserverPin('https://matrix.team.org:443', 'matrix.team.org', ['1.1.1.1']),
            ] as $pin) {
                MatrixCurlFake::reset();
                try {
                    (new HomeserverHttpsTransport())->readPinnedPublicVersions($pin);
                    self::fail('Invalid pin was allowed');
                } catch (\DomainException $e) {
                    self::assertContains($e->getMessage(), [
                        'matrix.byo_origin_invalid',
                        'matrix.byo_dns_unsafe',
                        'matrix.byo_pin_invalid',
                    ]);
                    self::assertSame('', MatrixCurlFake::$url);
                }
            }
        }

        public function test_invalid_origin_is_rejected_before_system_dns_or_curl(): void
        {
            $this->rejects(
                fn () => (new HomeserverHttpsTransport())->probePublicVersions(
                    'http://localhost'
                ),
                'matrix.byo_origin_invalid'
            );
            self::assertSame('', MatrixCurlFake::$url);
        }
    }
}
