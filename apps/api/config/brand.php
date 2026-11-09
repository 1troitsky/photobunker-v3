<?php

declare(strict_types=1);

// Normative: no historic product-name literal in user-facing UI, PWA, invoices or public shares.
// This file is Laravel config: env() is provided when loaded inside Laravel.
return [
    'name' => env('APP_NAME', 'Example Application'),
    'short_name' => env('APP_SHORT_NAME', 'Example'),
    'slug' => env('APP_SLUG', 'example-app'),
    'mark' => env('APP_MARK', 'app'),
    'public_url' => env('APP_PUBLIC_URL', 'https://example.invalid'),
    'support_url' => env('APP_SUPPORT_URL', ''),
    'legal_name' => env('APP_LEGAL_NAME', ''),
    'copyright_name' => env('APP_COPYRIGHT_NAME', ''),
    'theme_color' => env('APP_THEME_COLOR', '#1ed760'),
    'pwa_icons' => env('APP_PWA_ICONS', ''),
];
