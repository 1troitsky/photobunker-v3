<?php
declare(strict_types=1);

namespace App\Storage\Byo;

/**
 * An already-validated DNS snapshot, NOT a connection or authorization grant.
 *
 * Consumers MUST connect to an address in this snapshot and preserve the original
 * DNS hostname for TLS SNI/certificate validation and HTTP Host. DNS lookup during
 * connection, automatic redirects or a connection-pool reuse can bypass this pin.
 */
final readonly class ByoS3Pin
{
    /** @param non-empty-list<string> $addresses */
    public function __construct(
        public string $origin,
        public string $hostname,
        public int $port,
        private array $addresses,
    ) {}

    /** @return non-empty-list<string> */
    public function addresses(): array
    {
        return $this->addresses;
    }

    public function assertConnectedPeer(string $peerAddress): void
    {
        $binary = @inet_pton($peerAddress);
        if ($binary === false || !in_array(inet_ntop($binary), $this->addresses, true)) {
            throw new \DomainException('storage.byo_peer_not_pinned');
        }
    }

    public function policyVersion(): string
    {
        return 'BYO_S3_PUBLIC_ENDPOINT_V1';
    }
}
