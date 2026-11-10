<?php
declare(strict_types=1);

// Platform-owned Matrix homeserver; clients must never choose a server URL.
// Empty by default: no token validation, no Matrix binding, no pretend delivery.
return [
    'homeserver_url' => env('PB3_MATRIX_HOMESERVER_URL', ''),
];
