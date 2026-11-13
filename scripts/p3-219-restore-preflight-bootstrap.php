<?php
declare(strict_types=1);

// Isolated contract suite only. Does NOT bootstrap Laravel or load the
// pre-#297 vulnerable Composer vendor tree. No backup producer, network,
// StorageManager, S3, actual account session, or live restore runs here.
if (!((PHP_VERSION_ID >= 80427 && PHP_VERSION_ID < 80500)
    || (PHP_VERSION_ID >= 80512 && PHP_VERSION_ID < 80600))) {
    fwrite(STDERR, "PB3 PHP security floor rejected: ".PHP_VERSION.PHP_EOL);
    exit(1);
}
require_once __DIR__ . '/../apps/api/app/Recovery/RestoreManifestPreflight.php';
