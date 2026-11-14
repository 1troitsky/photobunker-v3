<?php
declare(strict_types=1);

namespace App\Matrix\Byo;

/**
 * Bounded, fail-closed CNAME -> A/AAAA resolution for a Matrix BYO origin.
 *
 * The lookup must return the complete DNS A/AAAA/CNAME RRset for the
 * requested host or indicate failure. This parser never treats one
 * convenient public address as proof when any other record is unsafe.
 * No HTTP call is made here; callers must use the resulting pin with a
 * TLS hostname-verifying, proxy-free, redirect-disabled transport.
 */
final class HomeserverDnsResolver
{
    private const MAX_CNAME_HOPS = 8;
    private const MAX_RR_PER_LOOKUP = 24;
    private const MAX_RR_TOTAL = 64;

    public function __construct(
        private readonly HomeserverEndpointGuard $guard = new HomeserverEndpointGuard(),
    ) {}

    /**
     * @param callable(string):array<int,array<string,mixed>> $lookup
     *    Complete RRset for one hostname; DNS/network errors must throw.
     */
    public function resolve(string $origin, callable $lookup): HomeserverPin
    {
        $host = $this->guard->hostname($origin); // No lookup before URL check.
        $visited = [];
        $totalRecords = 0;

        for ($hop = 0; $hop <= self::MAX_CNAME_HOPS; $hop++) {
            if (isset($visited[$host])) {
                throw new \DomainException('matrix.byo_dns_unsafe');
            }
            $visited[$host] = true;

            try {
                $records = $lookup($host);
            } catch (\Throwable) {
                throw new \DomainException('matrix.byo_dns_unsafe');
            }
            if (!is_array($records) || !array_is_list($records)
                || count($records) < 1 || count($records) > self::MAX_RR_PER_LOOKUP) {
                throw new \DomainException('matrix.byo_dns_unsafe');
            }

            $totalRecords += count($records);
            if ($totalRecords > self::MAX_RR_TOTAL) {
                throw new \DomainException('matrix.byo_dns_unsafe');
            }

            $addresses = [];
            $aliases = [];

            foreach ($records as $record) {
                if (!is_array($record)
                    || !isset($record['host'], $record['type'])
                    || !is_string($record['host'])
                    || !is_string($record['type'])
                    || $this->normalizeName($record['host']) !== $host) {
                    throw new \DomainException('matrix.byo_dns_unsafe');
                }

                switch ($record['type']) {
                    case 'A':
                        if (!isset($record['ip']) || !is_string($record['ip'])) {
                            throw new \DomainException('matrix.byo_dns_unsafe');
                        }
                        $addresses[] = $record['ip'];
                        break;
                    case 'AAAA':
                        if (!isset($record['ipv6']) || !is_string($record['ipv6'])) {
                            throw new \DomainException('matrix.byo_dns_unsafe');
                        }
                        $addresses[] = $record['ipv6'];
                        break;
                    case 'CNAME':
                        if (!isset($record['target']) || !is_string($record['target'])) {
                            throw new \DomainException('matrix.byo_dns_unsafe');
                        }
                        $aliases[] = $this->normalizeName($record['target']);
                        break;
                    default:
                        throw new \DomainException('matrix.byo_dns_unsafe');
                }
            }

            if ($aliases !== []) {
                // CNAME cannot coexist with address records or other CNAMEs.
                if (count($aliases) !== 1 || $addresses !== []
                    || $hop === self::MAX_CNAME_HOPS) {
                    throw new \DomainException('matrix.byo_dns_unsafe');
                }
                try {
                    // Reject special-use alias names BEFORE the next lookup.
                    $host = $this->guard->hostname('https://' . $aliases[0]);
                } catch (\DomainException) {
                    throw new \DomainException('matrix.byo_dns_unsafe');
                }
                continue;
            }

            if ($addresses === []) {
                throw new \DomainException('matrix.byo_dns_unsafe');
            }
            // Validate ALL returned public addresses, then retain the
            // ORIGINAL requested hostname for TLS certificate validation.
            return $this->guard->admit($origin, $addresses);
        }

        throw new \DomainException('matrix.byo_dns_unsafe');
    }

    /**
     * Host-controlled DNS resolver. Still requires pinning on the actual
     * socket; this is NOT DNSSEC validation or an authenticated DNS oracle.
     */
    public function resolveSystem(string $origin): HomeserverPin
    {
        return $this->resolve($origin, static function (string $hostname): array {
            $records = dns_get_record($hostname, DNS_A | DNS_AAAA | DNS_CNAME);
            if (!is_array($records)) {
                throw new \RuntimeException('matrix.byo_dns_unavailable');
            }
            return $records;
        });
    }

    private function normalizeName(string $name): string
    {
        if ($name !== '' && str_ends_with($name, '.')) {
            $name = substr($name, 0, -1);
        }
        return strtolower($name);
    }
}
