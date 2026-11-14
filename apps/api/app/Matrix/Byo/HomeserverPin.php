<?php
declare(strict_types=1);

namespace App\Matrix\Byo;

/**
 * Admission snapshot, NOT a network client. @internal
 *
 * The future transport must actually CONNECT to a pin, verify socket peer,
 * and validate TLS against $hostname with SNI; redirects must be disabled.
 */
final readonly class HomeserverPin
{
    /** @param non-empty-list<string> $approvedAddresses Canonical A/AAAA IPs. */
    public function __construct(
        public string $origin,
        public string $hostname,
        public array $approvedAddresses,
    ) {}

    public function assertPeer(string $connectedIp): void
    {
        $binary = inet_pton($connectedIp);
        $canonical = $binary === false ? false : inet_ntop($binary);
        if ($canonical === false || !in_array($canonical, $this->approvedAddresses, true)) {
            throw new \DomainException('matrix.byo_peer_mismatch');
        }
    }
}
