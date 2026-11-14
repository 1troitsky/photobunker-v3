<?php
declare(strict_types=1);

namespace App\Matrix\Byo;

/**
 * Public Matrix /versions HTTPS probe only. No access token is accepted.
 *
 * The public versions endpoint needs no Matrix login. In contrast, Matrix
 * /capabilities and /whoami require authenticated flows; those are NOT
 * called here until signed PB3 identity + isolated Matrix token lifecycle
 * have been independently accepted.
 *
 * The only network path is libcurl with a concrete approved IP pinned via
 * CURLOPT_RESOLVE; original hostname remains in URL for TLS SNI/certificate
 * verification. No proxy, redirect, URL discovery or unbounded response.
 *
 * @internal Not mounted on any public route or triggered by browser input.
 */
final class HomeserverHttpsTransport
{
    private const MAX_BODY_BYTES = 65536;
    private const MAX_HEADER_BYTES = 16384;

    public function __construct(
        private readonly HomeserverDnsResolver $resolver = new HomeserverDnsResolver(),
        private readonly HomeserverEndpointGuard $guard = new HomeserverEndpointGuard(),
    ) {}

    /**
     * Perform a new, separately DNS-resolved + pinned HTTPS request for each
     * invocation. No unsafe fallback to a generic HTTP client is allowed.
     *
     * @return array{versions:list<string>}
     */
    public function probePublicVersions(string $origin): array
    {
        return $this->readPinnedPublicVersions($this->resolver->resolveSystem($origin));
    }

    /**
     * For future explicit invocations after a trusted DNS lookup.
     * This accepts only the Matrix PUBLIC versions endpoint.
     *
     * @return array{versions:list<string>}
     */
    public function readPinnedPublicVersions(HomeserverPin $pin): array
    {
        // A manually constructed pin cannot bypass origin or IP admission.
        $validated = $this->guard->admit($pin->origin, $pin->approvedAddresses);
        if ($pin->hostname !== $validated->hostname
            || $pin->origin !== $validated->origin
            || $pin->approvedAddresses !== $validated->approvedAddresses) {
            throw new \DomainException('matrix.byo_pin_invalid');
        }

        if (!extension_loaded('curl')) {
            throw new \DomainException('matrix.byo_transport_unavailable');
        }

        // One explicit address per socket. libcurl must not resolve again or
        // fall back to another IP after failure. A later probe will re-resolve.
        $ip = $validated->approvedAddresses[0];
        $url = $validated->origin . '/_matrix/client/versions';
        $resolveEntry = $validated->hostname . ':443:'
            . (str_contains($ip, ':') ? '[' . $ip . ']' : $ip);

        $handle = curl_init($url);
        if ($handle === false) {
            throw new \DomainException('matrix.byo_transport_unavailable');
        }

        $body = '';
        $headerBytes = 0;
        $oversized = false;

        try {
            $options = [
                CURLOPT_RESOLVE => [$resolveEntry],
                CURLOPT_IPRESOLVE => str_contains($ip, ':') ? CURL_IPRESOLVE_V6 : CURL_IPRESOLVE_V4,
                CURLOPT_PROXY => '',
                CURLOPT_NOPROXY => '*',
                CURLOPT_FOLLOWLOCATION => false,
                CURLOPT_MAXREDIRS => 0,
                CURLOPT_PROTOCOLS => CURLPROTO_HTTPS,
                CURLOPT_REDIR_PROTOCOLS => CURLPROTO_HTTPS,
                CURLOPT_SSL_VERIFYPEER => true,
                CURLOPT_SSL_VERIFYHOST => 2,
                CURLOPT_CONNECTTIMEOUT_MS => 2000,
                CURLOPT_TIMEOUT_MS => 5000,
                CURLOPT_DNS_CACHE_TIMEOUT => 0,
                CURLOPT_FRESH_CONNECT => true,
                CURLOPT_FORBID_REUSE => true,
                CURLOPT_HTTPGET => true,
                CURLOPT_NOBODY => false,
                CURLOPT_HEADER => false,
                CURLOPT_RETURNTRANSFER => false,
                CURLOPT_HTTPHEADER => [
                    'Accept: application/json',
                ],
                CURLOPT_WRITEFUNCTION => static function ($handle, string $chunk)
                    use (&$body, &$oversized): int {
                    if (strlen($body) + strlen($chunk) > self::MAX_BODY_BYTES) {
                        $oversized = true;
                        return 0; // CURLE_WRITE_ERROR: abort immediately.
                    }
                    $body .= $chunk;
                    return strlen($chunk);
                },
                CURLOPT_HEADERFUNCTION => static function ($handle, string $header)
                    use (&$headerBytes, &$oversized): int {
                    $headerBytes += strlen($header);
                    if ($headerBytes > self::MAX_HEADER_BYTES) {
                        $oversized = true;
                        return 0;
                    }
                    return strlen($header);
                },
            ];
            if (!curl_setopt_array($handle, $options)) {
                throw new \DomainException('matrix.byo_transport_unavailable');
            }
            $ok = curl_exec($handle);
            $status = curl_getinfo($handle, CURLINFO_RESPONSE_CODE);
            $actualPeer = curl_getinfo($handle, CURLINFO_PRIMARY_IP);

            if ($oversized) {
                throw new \DomainException('matrix.byo_response_too_large');
            }
            if ($ok !== true || $status !== 200 || !is_string($actualPeer)) {
                throw new \DomainException('matrix.byo_transport_unavailable');
            }
            // This is a second, independent check against unexpected
            // socket/connection/proxy behavior after the HTTP exchange.
            $validated->assertPeer($actualPeer);
        } catch (\DomainException $exception) {
            throw $exception;
        } catch (\Throwable) {
            throw new \DomainException('matrix.byo_transport_unavailable');
        } finally {
            curl_close($handle);
        }

        try {
            $json = json_decode($body, true, 12, JSON_THROW_ON_ERROR);
        } catch (\JsonException) {
            throw new \DomainException('matrix.byo_versions_unsupported');
        }
        if (!is_array($json) || array_is_list($json)
            || !isset($json['versions'])
            || !is_array($json['versions']) || !array_is_list($json['versions'])
            || count($json['versions']) < 1 || count($json['versions']) > 64) {
            throw new \DomainException('matrix.byo_versions_unsupported');
        }

        $accepted = false;
        foreach ($json['versions'] as $version) {
            if (!is_string($version) || strlen($version) > 12) {
                throw new \DomainException('matrix.byo_versions_unsupported');
            }
            if (preg_match('/\Av1\.(\d{1,3})\z/', $version, $match) === 1
                && (int) $match[1] >= 1) {
                $accepted = true;
            }
        }
        if (!$accepted) {
            throw new \DomainException('matrix.byo_versions_unsupported');
        }
        return ['versions' => $json['versions']];
    }
}
