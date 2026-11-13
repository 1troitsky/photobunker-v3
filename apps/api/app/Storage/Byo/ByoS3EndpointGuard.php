<?php
declare(strict_types=1);

namespace App\Storage\Byo;

/**
 * Admission-only guard for a proposed BYO S3 origin and a caller-resolved A/AAAA set.
 *
 * Does no network I/O, opens no sockets, reads no secrets, and grants no storage
 * access. A future connector must resolve all addresses immediately before dialing,
 * pin the selected address for the entire request, verify the connected peer,
 * keep the original hostname for TLS SNI/certificate validation, and disable ALL
 * redirects. Calling this class without that transport guarantee is insufficient
 * to mitigate DNS rebinding / server-side request forgery.
 */
final class ByoS3EndpointGuard
{
    private const MAX_ENDPOINT_BYTES = 2048;
    private const MAX_DNS_ADDRESSES = 16;

    /**
     * $allowedPorts is server-side trusted policy, NEVER a browser-supplied value.
     *
     * @param list<string> $resolvedAddresses All final DNS A and AAAA answers,
     *                                       with CNAME chains resolved by caller.
     * @param non-empty-list<int> $allowedPorts
     */
    public function admit(
        string $endpoint,
        array $resolvedAddresses,
        array $allowedPorts = [443],
    ): ByoS3Pin {
        $validated = $this->parseOrigin($endpoint, $allowedPorts);
        $host = $validated['hostname'];
        $port = $validated['port'];

        if (
            !array_is_list($resolvedAddresses)
            || count($resolvedAddresses) < 1
            || count($resolvedAddresses) > self::MAX_DNS_ADDRESSES
        ) {
            throw new \DomainException('storage.byo_dns_unsafe');
        }

        $approved = [];
        foreach ($resolvedAddresses as $address) {
            if (!is_string($address) || !$this->isPublicGlobalIp($address)) {
                // All records must be public; a mixed public/private RR set fails.
                throw new \DomainException('storage.byo_dns_unsafe');
            }
            $binary = inet_pton($address);
            if ($binary === false) {
                throw new \DomainException('storage.byo_dns_unsafe');
            }
            $canonical = inet_ntop($binary);
            if (!in_array($canonical, $approved, true)) {
                $approved[] = $canonical;
            }
        }

        return new ByoS3Pin(
            'https://' . $host . ($port === 443 ? '' : ':' . $port),
            $host,
            $port,
            $approved,
        );
    }

    /**
     * Validate the origin BEFORE any DNS I/O to avoid querying attacker-supplied
     * local/invalid hostnames. Server policy owns the allowed port list.
     *
     * @param non-empty-list<int> $allowedPorts
     * @return array{hostname: string, port: int}
     */
    public function parseOrigin(string $endpoint, array $allowedPorts = [443]): array
    {
        if (
            $endpoint === ''
            || strlen($endpoint) > self::MAX_ENDPOINT_BYTES
            || trim($endpoint) !== $endpoint
            || preg_match('/[^\x21-\x7e]/', $endpoint) === 1
            || str_contains($endpoint, '\\')
            || !str_starts_with($endpoint, 'https://')
        ) {
            throw new \DomainException('storage.byo_endpoint_invalid');
        }

        try {
            $url = parse_url($endpoint);
        } catch (\ValueError) {
            throw new \DomainException('storage.byo_endpoint_invalid');
        }
        if (
            !is_array($url)
            || array_diff(array_keys($url), ['scheme', 'host', 'port', 'path']) !== []
            || ($url['scheme'] ?? '') !== 'https'
            || !isset($url['host'])
            || !in_array($url['path'] ?? '', ['', '/'], true)
        ) {
            throw new \DomainException('storage.byo_endpoint_invalid');
        }

        $host = strtolower($url['host']);
        if (!$this->validPublicHostname($host)) {
            throw new \DomainException('storage.byo_endpoint_invalid');
        }

        $port = $url['port'] ?? 443;
        if (
            !is_int($port)
            || !in_array($port, $allowedPorts, true)
            || $port < 1 || $port > 65535
        ) {
            throw new \DomainException('storage.byo_port_denied');
        }

        return ['hostname' => $host, 'port' => $port];
    }

    private function validPublicHostname(string $host): bool
    {
        if (
            strlen($host) < 4 || strlen($host) > 253
            || preg_match('/\A[a-z0-9.-]+\z/D', $host) !== 1
            || str_contains($host, '..') || !str_contains($host, '.')
            || filter_var($host, FILTER_VALIDATE_IP) !== false
        ) {
            return false;
        }

        $labels = explode('.', $host);
        foreach ($labels as $label) {
            if (
                strlen($label) < 1 || strlen($label) > 63
                || preg_match('/\A[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\z/D', $label) !== 1
            ) {
                return false;
            }
        }

        $tld = end($labels);
        if (
            preg_match('/\A(?:[a-z]{2,63}|xn--[a-z0-9-]{2,59})\z/D', $tld) !== 1
            || in_array($tld, [
                'local', 'localhost', 'internal', 'test', 'invalid', 'example',
                'home', 'lan', 'onion', 'arpa',
            ], true)
        ) {
            return false;
        }

        return true;
    }

    private function isPublicGlobalIp(string $address): bool
    {
        if (
            filter_var(
                $address,
                FILTER_VALIDATE_IP,
                FILTER_FLAG_NO_PRIV_RANGE | FILTER_FLAG_NO_RES_RANGE,
            ) === false
        ) {
            return false;
        }
        $binary = inet_pton($address);
        if ($binary === false) {
            return false;
        }

        if (strlen($binary) === 4) {
            $octets = array_values(unpack('C4', $binary));
            [$a, $b, $c] = $octets;
            // Defense in depth for ranges whose PHP "reserved" treatment varies.
            return !(
                $a === 0 || $a >= 224
                || ($a === 100 && $b >= 64 && $b <= 127) // CGNAT
                || ($a === 169 && $b === 254)             // link-local / metadata
                || ($a === 192 && $b === 0 && $c === 0)   // IANA protocol
                || ($a === 192 && $b === 88 && $c === 99) // deprecated relay
                || ($a === 198 && in_array($b, [18, 19], true)) // benchmark
            );
        }

        if (strlen($binary) !== 16) {
            return false;
        }
        $a = ord($binary[0]);
        $b = ord($binary[1]);
        $c = ord($binary[2]);
        $d = ord($binary[3]);

        // Only genuine global unicast 2000::/3. Excludes ULA, loopback, mapped,
        // link-local, multicast and NAT64 IPv4-embedded addresses.
        if (($a & 0xe0) !== 0x20) {
            return false;
        }

        // Reject tunnel/embedded IPv4 and documentation ranges even if a
        // particular PHP patch release treats them as public.
        return !(($a === 0x20 && $b === 0x01 && $c === 0x00 && $d === 0x00)
            || ($a === 0x20 && $b === 0x01 && $c === 0x0d && $d === 0xb8)
            || ($a === 0x20 && $b === 0x02)
            || ($a === 0x3f && $b === 0xff && ($c & 0xf0) === 0));
    }
}
