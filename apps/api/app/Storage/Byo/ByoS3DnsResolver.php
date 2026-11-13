<?php
declare(strict_types=1);

namespace App\Storage\Byo;

/**
 * Fail-closed interpretation of a bounded DNS CNAME -> A/AAAA chain.
 *
 * The injected lookup MUST return the complete A/AAAA/CNAME RRset for exactly
 * the requested hostname from a bounded, trusted DNS resolver. This class
 * performs no network I/O; no S3 transport, request or credentials are enabled.
 *
 * Even after resolution the caller MUST connect to one of the returned pin's
 * addresses, verify the actual peer IP and TLS certificate for the original
 * hostname/SNI, disable redirects, and re-resolve on subsequent connections.
 */
final class ByoS3DnsResolver
{
    private const MAX_CNAME_HOPS = 8;
    private const MAX_RR_PER_LOOKUP = 24;
    private const MAX_RR_TOTAL = 64;

    public function __construct(
        private readonly ByoS3EndpointGuard $guard = new ByoS3EndpointGuard(),
    ) {}

    /**
     * @param callable(string):array<int,array<string,mixed>> $lookup Returns
     *     all A/AAAA/CNAME records for ONE hostname, including owner name (host).
     *     Throws/returns invalid or partial/error responses on outage.
     * @param non-empty-list<int> $allowedPorts Trusted SERVER policy, not user input.
     */
    public function resolve(string $endpoint, callable $lookup, array $allowedPorts = [443]): ByoS3Pin
    {
        // Reject invalid/localhost/IP-literal endpoints BEFORE consulting DNS.
        $validated = $this->guard->parseOrigin($endpoint, $allowedPorts);
        $host = $validated['hostname'];
        $visited = [];
        $count = 0;

        for ($hop = 0; $hop <= self::MAX_CNAME_HOPS; $hop++) {
            if (isset($visited[$host])) {
                throw new \DomainException('storage.byo_dns_unsafe');
            }
            $visited[$host] = true;

            try {
                $records = $lookup($host);
            } catch (\Throwable) {
                throw new \DomainException('storage.byo_dns_unsafe');
            }

            if (!is_array($records) || !array_is_list($records)
                || count($records) === 0 || count($records) > self::MAX_RR_PER_LOOKUP) {
                throw new \DomainException('storage.byo_dns_unsafe');
            }

            $count += count($records);
            if ($count > self::MAX_RR_TOTAL) {
                throw new \DomainException('storage.byo_dns_unsafe');
            }

            $addresses = [];
            $aliases = [];

            foreach ($records as $record) {
                if (!is_array($record) || !isset($record['host'], $record['type'])
                    || !is_string($record['host']) || !is_string($record['type'])
                    || $this->normalizeName($record['host']) !== $host) {
                    throw new \DomainException('storage.byo_dns_unsafe');
                }

                switch ($record['type']) {
                    case 'A':
                        if (!isset($record['ip']) || !is_string($record['ip'])) {
                            throw new \DomainException('storage.byo_dns_unsafe');
                        }
                        $addresses[] = $record['ip'];
                        break;
                    case 'AAAA':
                        if (!isset($record['ipv6']) || !is_string($record['ipv6'])) {
                            throw new \DomainException('storage.byo_dns_unsafe');
                        }
                        $addresses[] = $record['ipv6'];
                        break;
                    case 'CNAME':
                        if (!isset($record['target']) || !is_string($record['target'])) {
                            throw new \DomainException('storage.byo_dns_unsafe');
                        }
                        $aliases[] = $this->normalizeName($record['target']);
                        break;
                    default:
                        throw new \DomainException('storage.byo_dns_unsafe');
                }
            }

            if ($aliases !== []) {
                // A legal CNAME cannot share its owner with an A or AAAA RR,
                // and multiple CNAMEs make the next hop ambiguous.
                if (count($aliases) !== 1 || $addresses !== [] || $hop === self::MAX_CNAME_HOPS) {
                    throw new \DomainException('storage.byo_dns_unsafe');
                }

                // A CNAME into localhost/internal/unknown names must never be
                // looked up, even if its final address might appear public.
                try {
                    $next = $this->guard->parseOrigin('https://' . $aliases[0]);
                } catch (\DomainException) {
                    throw new \DomainException('storage.byo_dns_unsafe');
                }
                $host = $next['hostname'];
                continue;
            }

            if ($addresses === []) {
                throw new \DomainException('storage.byo_dns_unsafe');
            }

            // All final A/AAAA records must be individually globally routable;
            // mixed private/public answers fail together; no "first good IP" pick.
            return $this->guard->admit($endpoint, $addresses, $allowedPorts);
        }

        throw new \DomainException('storage.byo_dns_unsafe');
    }

    private function normalizeName(string $name): string
    {
        if ($name !== '' && str_ends_with($name, '.')) {
            $name = substr($name, 0, -1);
        }

        return strtolower($name);
    }
}
