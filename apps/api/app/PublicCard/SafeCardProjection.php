<?php

declare(strict_types=1);

namespace App\PublicCard;

use InvalidArgumentException;

/**
 * Pure display-data minimizer for a future Public Card.
 *
 * NOT a publication authorization check. Callers must independently verify
 * the owner's signature, media hashes, live ACL/TTL and revocation, and a
 * public-scope grant before making anything available to anonymous clients.
 * This class never returns an original reference, GPS, encrypted key or URL.
 */
final class SafeCardProjection
{
    private const FIELDS = [
        'description', 'capturedAt', 'updatedAt', 'tags',
        'authorTeam', 'gps', 'metadata',
    ];

    /**
     * @param array<string,mixed> $safeAsset
     * @param array<string,mixed> $verifiedCeiling A verified policy, NOT proof of publication.
     * @return array{mimeType:string,description:?string,capturedAt:?string,expiresAt:int}
     */
    public static function preview(array $safeAsset, array $verifiedCeiling, int $nowMs): array
    {
        self::exact($safeAsset, [
            'mimeType', 'description', 'capturedAt', 'expiresAt',
        ]);
        self::exact($verifiedCeiling, [
            'publication', 'expiresAt', 'fields', 'actions',
        ]);

        // All existing signed preview policies are explicitly non-public.
        // Never silently turn one into a grant or anonymous response.
        self::require($verifiedCeiling['publication'] === 'disabled');

        self::require($safeAsset['mimeType'] === 'image/jpeg');

        foreach ([$nowMs, $safeAsset['expiresAt'], $verifiedCeiling['expiresAt']] as $timestamp) {
            self::require(is_int($timestamp) && $timestamp > 0);
        }

        $expiresAt = min($safeAsset['expiresAt'], $verifiedCeiling['expiresAt']);
        self::require($nowMs < $expiresAt);

        $fields = $verifiedCeiling['fields'];
        self::require(is_array($fields) && !array_is_list($fields));
        self::exact($fields, self::FIELDS);
        foreach (self::FIELDS as $key) {
            self::require(is_bool($fields[$key]));
        }
        // A Public Card cannot display GPS or arbitrary/private metadata.
        self::require($fields['gps'] === false && $fields['metadata'] === false
            && $fields['tags'] === false && $fields['authorTeam'] === false
            && $fields['updatedAt'] === false);

        $actions = $verifiedCeiling['actions'];
        self::require(is_array($actions) && !array_is_list($actions));
        self::exact($actions, ['view', 'copy', 'download', 'share']);
        foreach ($actions as $enabled) {
            self::require($enabled === false);
        }

        $description = self::displayText($safeAsset['description'], 500);
        $capturedAt = self::displayText($safeAsset['capturedAt'], 40);
        if (!$fields['description']) {
            self::require($description === null);
        }
        if (!$fields['capturedAt']) {
            self::require($capturedAt === null);
        }

        // No URL, asset ID, source media, original, recovery key, GPS, DEK,
        // signed policy body, storage bucket or ciphertext reference.
        return [
            'mimeType' => 'image/jpeg',
            'description' => $description,
            'capturedAt' => $capturedAt,
            'expiresAt' => $expiresAt,
        ];
    }

    /** @param array<string,mixed> $value @param list<string> $keys */
    private static function exact(array $value, array $keys): void
    {
        $actual = array_keys($value);
        sort($actual, SORT_STRING);
        sort($keys, SORT_STRING);
        self::require($actual === $keys);
    }

    private static function displayText(mixed $value, int $maxBytes): ?string
    {
        if ($value === null) {
            return null;
        }
        self::require(is_string($value) && strlen($value) <= $maxBytes
            && mb_check_encoding($value, 'UTF-8')
            && preg_match('/[\\x00-\\x1f\\x7f<>]/u', $value) === 0);
        return $value;
    }

    private static function require(bool $condition): void
    {
        if (!$condition) {
            throw new InvalidArgumentException('Invalid safe preview projection');
        }
    }
}
