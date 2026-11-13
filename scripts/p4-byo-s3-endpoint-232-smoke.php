<?php
declare(strict_types=1);

require_once __DIR__ . '/../apps/api/app/Storage/Byo/ByoS3Pin.php';
require_once __DIR__ . '/../apps/api/app/Storage/Byo/ByoS3EndpointGuard.php';
require_once __DIR__ . '/../apps/api/app/Storage/Byo/ByoS3DnsResolver.php';

use App\Storage\Byo\ByoS3EndpointGuard;
use App\Storage\Byo\ByoS3DnsResolver;

$version = PHP_VERSION_ID;
if (!(($version >= 80427 && $version < 80500) || ($version >= 80512 && $version < 80600))) {
    fwrite(STDERR, "PB3 security floor rejected PHP " . PHP_VERSION . "\n");
    exit(1);
}

$guard = new ByoS3EndpointGuard();
$count = 0;
$check = static function (bool $condition, string $name) use (&$count): void {
    if (!$condition) {
        throw new RuntimeException('FAIL ' . $name);
    }
    $count++;
};
$deny = static function (Closure $operation, string $reason) use (&$count): void {
    try {
        $operation();
    } catch (DomainException $exception) {
        if ($exception->getMessage() === $reason) {
            $count++;
            return;
        }
        throw new RuntimeException('Unexpected rejection: ' . $exception->getMessage());
    }
    throw new RuntimeException('Unsafe BYO S3 candidate accepted: ' . $reason);
};

$pin = $guard->admit('https://S3.Example.COM/', ['8.8.8.8', '1.1.1.1']);
$check($pin->origin === 'https://s3.example.com', 'safe HTTPS origin');
$check($pin->addresses() === ['8.8.8.8', '1.1.1.1'], 'all DNS addresses pinned');
$pin->assertConnectedPeer('8.8.8.8');
$count++;
$deny(static fn () => $pin->assertConnectedPeer('9.9.9.9'), 'storage.byo_peer_not_pinned');
foreach ([
    'http://s3.example.com',
    'https://token:secret@s3.example.com',
    'https://s3.example.com/bucket',
    'https://s3.example.com?redirect=https://127.0.0.1',
    'https://s3.internal',
    'https://127.0.0.1',
    'https://[::1]',
    'https://s3.example.com:99999',
    'https://s3..example.com',
] as $badEndpoint) {
    $deny(static fn () => $guard->admit($badEndpoint, ['8.8.8.8']), 'storage.byo_endpoint_invalid');
}
foreach ([
    '127.0.0.1', '10.0.0.1', '169.254.169.254',
    '100.64.0.1', '192.168.1.5', '198.18.0.1',
    '::1', 'fe80::1', 'fd00::1', '::ffff:127.0.0.1',
    '2001:db8::1', '2002:a00:1::', '64:ff9b::a00:1',
] as $badAddress) {
    $deny(static fn () => $guard->admit('https://s3.example.com', [$badAddress]), 'storage.byo_dns_unsafe');
}
$deny(static fn () => $guard->admit('https://s3.example.com', ['8.8.8.8', '10.0.0.1']), 'storage.byo_dns_unsafe');
$deny(static fn () => $guard->admit('https://s3.example.com', []), 'storage.byo_dns_unsafe');
$deny(static fn () => $guard->admit('https://s3.example.com:9443', ['8.8.8.8']), 'storage.byo_port_denied');
$alt = $guard->admit('https://s3.example.com:9443', ['8.8.8.8'], [443, 9443]);
$check($alt->port === 9443, 'server-approved alternate TLS port');
$v6 = $guard->admit('https://s3.example.com', ['2001:4860:4860::8888']);
$v6->assertConnectedPeer('2001:4860:4860:0:0:0:0:8888');
$count++;
$deny(static fn () => $v6->assertConnectedPeer('2001:4860:4860::8844'), 'storage.byo_peer_not_pinned');


$dns = new ByoS3DnsResolver($guard);
$queries = [];
$rrs = [
    's3.example.com' => [['host' => 's3.example.com', 'type' => 'CNAME', 'target' => 'edge.example.net.']],
    'edge.example.net' => [
        ['host' => 'edge.example.net.', 'type' => 'A', 'ip' => '8.8.8.8'],
        ['host' => 'edge.example.net.', 'type' => 'AAAA', 'ipv6' => '2001:4860:4860::8888'],
    ],
];
$lookup = static function (string $host) use ($rrs, &$queries): array {
    $queries[] = $host;
    return $rrs[$host] ?? [];
};
$resolved = $dns->resolve('https://S3.Example.Com/', $lookup);
$check($resolved->hostname === 's3.example.com', 'DNS CNAME preserves original HTTPS hostname');
$check($resolved->addresses() === ['8.8.8.8', '2001:4860:4860::8888'], 'all final A/AAAA pinned');
$check($queries === ['s3.example.com', 'edge.example.net'], 'DNS walks only validated alias chain');
$deny(static fn () => $resolved->assertConnectedPeer('10.0.0.1'), 'storage.byo_peer_not_pinned');
$deny(
    static fn () => $dns->resolve('https://s3.example.com',
        static fn (string $h): array => [['host'=>$h,'type'=>'A','ip'=>'127.0.0.1']]),
    'storage.byo_dns_unsafe',
);
$deny(
    static fn () => $dns->resolve('https://s3.example.com',
        static fn (string $h): array => [
            ['host'=>$h,'type'=>'A','ip'=>'8.8.8.8'],
            ['host'=>$h,'type'=>'AAAA','ipv6'=>'fd00::1'],
        ]),
    'storage.byo_dns_unsafe',
);
$deny(
    static fn () => $dns->resolve('https://s3.example.com',
        static fn (string $h): array => [['host'=>$h,'type'=>'CNAME','target'=>$h]]),
    'storage.byo_dns_unsafe',
);
$deny(
    static fn () => $dns->resolve('https://s3.example.com',
        static fn (string $h): array => [
            ['host'=>$h,'type'=>'CNAME','target'=>'edge.example.net'],
            ['host'=>$h,'type'=>'A','ip'=>'8.8.8.8'],
        ]),
    'storage.byo_dns_unsafe',
);
$deny(
    static fn () => $dns->resolve('https://s3.example.com',
        static fn (string $h): array => [['host'=>$h,'type'=>'CNAME','target'=>'metadata.google.internal']]),
    'storage.byo_dns_unsafe',
);
$deny(
    static fn () => $dns->resolve('https://s3.example.com',
        static fn (string $h): array => [['host'=>'elsewhere.example.net','type'=>'A','ip'=>'8.8.8.8']]),
    'storage.byo_dns_unsafe',
);
$deny(
    static fn () => $dns->resolve('https://s3.example.com', static fn (string $h): array => []),
    'storage.byo_dns_unsafe',
);
$deny(
    static fn () => $dns->resolve('https://s3.example.com', static function (string $h): never {
        throw new RuntimeException('upstream DNS exception suppressed');
    }),
    'storage.byo_dns_unsafe',
);
$before = count($queries);
$deny(
    static fn () => $dns->resolve('http://s3.example.com', $lookup),
    'storage.byo_endpoint_invalid',
);
$check(count($queries) === $before, 'invalid origin causes no DNS IO');

fwrite(STDOUT, "BYO S3 endpoint offline contract PASS: {$count} checks, PHP " . PHP_VERSION . "; no network, credentials or S3 I/O\n");
