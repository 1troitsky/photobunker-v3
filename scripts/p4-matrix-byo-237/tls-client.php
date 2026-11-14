<?php
declare(strict_types=1);

/**
 * CI-only executable live-TLS proof for the ACTUAL production transport.
 *
 * The runner must first route 1.1.1.1 to its own loopback and start the
 * disposable TLS server. This script does no DNS and sends no credentials.
 * It NEVER runs as an application route.
 */
require dirname(__DIR__, 2) . '/apps/api/vendor/autoload.php';

use App\Matrix\Byo\HomeserverEndpointGuard;
use App\Matrix\Byo\HomeserverHttpsTransport;

$mode = $argv[1] ?? '';
if (!in_array($mode, [
    'success', 'redirect', 'oversize', 'malformed', 'wrong_hostname',
], true)) {
    fwrite(STDERR, "Unsupported CI case\n");
    exit(2);
}

$hostname = $mode === 'wrong_hostname'
    ? 'mismatch.team.org'
    : 'matrix.team.org';

try {
    $pin = (new HomeserverEndpointGuard())->admit(
        'https://' . $hostname,
        ['1.1.1.1']
    );
    $response = (new HomeserverHttpsTransport())->readPinnedPublicVersions($pin);
    if ($mode !== 'success'
        || $response !== ['versions' => ['v1.3', 'v1.11']]) {
        throw new \RuntimeException('Unexpected TLS admission or response');
    }
    fwrite(STDOUT, "PASS real TLS pinned public /versions\n");
    exit(0);
} catch (\DomainException $exception) {
    $expected = match ($mode) {
        'wrong_hostname', 'redirect' => 'matrix.byo_transport_unavailable',
        'oversize' => 'matrix.byo_response_too_large',
        'malformed' => 'matrix.byo_versions_unsupported',
        default => '',
    };
    if ($exception->getMessage() !== $expected) {
        fwrite(STDERR, "FAIL unexpected error " . $exception->getMessage() . "\n");
        exit(1);
    }
    fwrite(STDOUT, "PASS denied real TLS case: " . $mode . "\n");
    exit(0);
} catch (\Throwable $exception) {
    fwrite(STDERR, "FAIL unexpected test error: " . get_class($exception) . "\n");
    exit(1);
}
