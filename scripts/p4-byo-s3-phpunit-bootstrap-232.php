<?php
declare(strict_types=1);

// Standalone PHPUnit 12 bootstrap for security-floor PHP only.
// Does NOT load Laravel, its vulnerable pre-#297 vendor tree, the application
// container, production settings, database, S3/network, or any credentials.
if (!((PHP_VERSION_ID >= 80427 && PHP_VERSION_ID < 80500)
    || (PHP_VERSION_ID >= 80512 && PHP_VERSION_ID < 80600))) {
    fwrite(STDERR, 'PB3 unsupported PHP security patch: ' . PHP_VERSION . PHP_EOL);
    exit(1);
}

require_once __DIR__ . '/../apps/api/app/Storage/Byo/ByoS3Pin.php';
require_once __DIR__ . '/../apps/api/app/Storage/Byo/ByoS3EndpointGuard.php';
require_once __DIR__ . '/../apps/api/app/Storage/Byo/ByoS3DnsResolver.php';
