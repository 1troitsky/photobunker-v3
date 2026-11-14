<?php
declare(strict_types=1);

namespace App\Matrix\Byo;

/**
 * Admission-only preflight for a user-proposed Matrix homeserver.
 * NO network, DNS, token or credential I/O. The A/AAAA RRset MUST be from
 * complete, trusted DNS resolution immediately before a pinned TLS connect.
 * Future transport MUST dial a pinned IP, confirm actual peer and TLS cert
 * for original hostname/SNI, disable redirects, and re-resolve on reconnect.
 * This guard is NOT sufficient SSRF protection for an ordinary HTTP client.
 */
final class HomeserverEndpointGuard
{
    private const MAX_ORIGIN_BYTES = 2048;
    private const MAX_DNS_ADDRESSES = 16;

    /** @param list<string> $resolvedAddresses Complete trusted DNS A/AAAA RRset. */
    public function admit(string $origin, array $resolvedAddresses): HomeserverPin
    {
        $host = $this->hostname($origin);
        if (!array_is_list($resolvedAddresses)
            || count($resolvedAddresses) < 1
            || count($resolvedAddresses) > self::MAX_DNS_ADDRESSES) {
            throw new \DomainException('matrix.byo_dns_unsafe');
        }

        $approved = [];
        foreach ($resolvedAddresses as $address) {
            if (!is_string($address) || !$this->isPublicIp($address)) {
                throw new \DomainException('matrix.byo_dns_unsafe');
            }
            $binary = inet_pton($address);
            $canonical = $binary === false ? false : inet_ntop($binary);
            if ($canonical === false) {
                throw new \DomainException('matrix.byo_dns_unsafe');
            }
            if (!in_array($canonical, $approved, true)) {
                $approved[] = $canonical;
            }
        }
        return new HomeserverPin('https://' . $host, $host, $approved);
    }

    /** Validate origin BEFORE DNS. Only HTTPS port 443 without suffixes. */
    public function hostname(string $origin): string
    {
        if ($origin === '' || strlen($origin) > self::MAX_ORIGIN_BYTES
            || trim($origin) !== $origin
            || preg_match('/[^\x21-\x7e]/', $origin) === 1
            || str_contains($origin, '\\')
            || !str_starts_with($origin, 'https://')) {
            throw new \DomainException('matrix.byo_origin_invalid');
        }

        try {
            $url = parse_url($origin);
        } catch (\ValueError) {
            throw new \DomainException('matrix.byo_origin_invalid');
        }
        if (!is_array($url)
            || array_diff(array_keys($url), ['scheme', 'host', 'port', 'path']) !== []
            || ($url['scheme'] ?? null) !== 'https'
            || !isset($url['host'])
            || !in_array($url['path'] ?? '', ['', '/'], true)
            || ($url['port'] ?? 443) !== 443) {
            throw new \DomainException('matrix.byo_origin_invalid');
        }

        $host = strtolower($url['host']);
        if (strlen($host) < 4 || strlen($host) > 253
            || !str_contains($host, '.') || str_contains($host, '..')
            || preg_match('/\A[a-z0-9.-]+\z/', $host) !== 1
            || filter_var($host, FILTER_VALIDATE_IP) !== false) {
            throw new \DomainException('matrix.byo_origin_invalid');
        }
        $labels = explode('.', $host);
        foreach ($labels as $label) {
            if (strlen($label) === 0 || strlen($label) > 63
                || preg_match('/\A[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\z/', $label) !== 1) {
                throw new \DomainException('matrix.byo_origin_invalid');
            }
        }
        $tld = end($labels);
        if (preg_match('/\A(?:[a-z]{2,63}|xn--[a-z0-9-]{2,59})\z/', $tld) !== 1
            || in_array($tld, [
                'local', 'localhost', 'internal', 'test', 'invalid', 'example',
                'home', 'lan', 'onion', 'arpa',
            ], true)) {
            throw new \DomainException('matrix.byo_origin_invalid');
        }
        return $host;
    }

    private function isPublicIp(string $address): bool
    {
        if (filter_var(
            $address, FILTER_VALIDATE_IP,
            FILTER_FLAG_NO_PRIV_RANGE | FILTER_FLAG_NO_RES_RANGE
        ) === false) {
            return false;
        }
        $bytes = inet_pton($address);
        if ($bytes === false) {
            return false;
        }
        if (strlen($bytes) === 4) {
            [$a, $b, $c] = array_values(unpack('C3', substr($bytes, 0, 3)));
            return !($a === 0 || $a >= 224
                || ($a === 100 && $b >= 64 && $b <= 127)
                || ($a === 169 && $b === 254)
                || ($a === 192 && $b === 0 && $c === 0)
                || ($a === 192 && $b === 88 && $c === 99)
                || ($a === 198 && ($b === 18 || $b === 19))
                || ($a === 192 && $b === 0 && $c === 2)
                || ($a === 198 && $b === 51 && $c === 100)
                || ($a === 203 && $b === 0 && $c === 113));
        }
        if (strlen($bytes) !== 16) {
            return false;
        }
        $a = ord($bytes[0]); $b = ord($bytes[1]);
        $c = ord($bytes[2]); $d = ord($bytes[3]);
        return ($a & 0xe0) === 0x20
            && !($a === 0x20 && $b === 0x01 && $c === 0x00 && $d === 0x00)
            && !($a === 0x20 && $b === 0x01 && $c === 0x0d && $d === 0xb8)
            && !($a === 0x20 && $b === 0x02);
    }
}
