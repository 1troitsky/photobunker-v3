<?php

declare(strict_types=1);

// Never boot the application on a PHP patch level below the approved security floor.
$id = PHP_VERSION_ID;
$allowed = ($id >= 80427 && $id < 80500)
    || ($id >= 80512 && $id < 80600);

if (!$allowed) {
    fwrite(STDERR, sprintf(
        "REJECTED PHP %s (ID %d). PB3 requires PHP >=8.4.27 <8.5 or >=8.5.12 <8.6.\n",
        PHP_VERSION,
        $id,
    ));
    exit(1);
}

fwrite(STDOUT, sprintf("PHP security floor verified: %s\n", PHP_VERSION));
