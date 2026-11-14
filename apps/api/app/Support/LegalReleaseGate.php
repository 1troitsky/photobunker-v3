<?php
declare(strict_types=1);

namespace App\Support;

use DateTimeImmutable;
use DateTimeZone;

/**
 * Structural preflight only: hashes and operator-supplied references do not
 * prove legal approval, translation accuracy or release authorization.
 */
final class LegalReleaseGate
{
    /** @return array<string,mixed> */
    public static function preflight(array $documents, array $manifest, DateTimeImmutable $now): array
    {
        $rev = $manifest['revision'] ?? null;
        if (!is_string($rev) || preg_match('/\A[a-zA-Z0-9][a-zA-Z0-9._-]{0,63}\z/D', $rev) !== 1) {
            return self::reject('revision');
        }
        $approval = $manifest['approval_reference'] ?? null;
        if (!is_string($approval) || preg_match('/\A[a-zA-Z0-9][a-zA-Z0-9._\/:-]{2,127}\z/D', $approval) !== 1) {
            return self::reject('approval_reference');
        }
        $regions = $manifest['processing_regions'] ?? null;
        if (!is_array($regions) || !array_is_list($regions) || count($regions) < 1 || count($regions) > 16
            ) {
            return self::reject('processing_regions');
        }
        foreach ($regions as $region) {
            if (!is_string($region) || preg_match('/\A[A-Z]{2}\z/D', $region) !== 1) {
                return self::reject('processing_regions');
            }
        }
        if (count(array_unique($regions)) !== count($regions)) {
            return self::reject('processing_regions');
        }
        $effective = $manifest['effective_at'] ?? null;
        $utc = new DateTimeZone('UTC');
        $date = is_string($effective)
            ? DateTimeImmutable::createFromFormat('!Y-m-d\TH:i:s\Z', $effective, $utc) : false;
        if ($date === false || $date->format('Y-m-d\TH:i:s\Z') !== $effective
            || $date > $now->setTimezone($utc)) {
            return self::reject('effective_at');
        }
        $pins = $manifest['sha256'] ?? null;
        if (!is_array($pins)) {
            return self::reject('missing_pins');
        }
        $digests = [];
        foreach (['terms','privacy'] as $kind) {
            foreach (['ru','en'] as $locale) {
                $item = $documents[$kind][$locale] ?? null;
                $pin = $pins[$kind][$locale] ?? null;
                if (!is_array($item) || ($item['revision'] ?? null) !== $rev
                    || !is_string($item['body'] ?? null)
                    || !is_string($pin) || preg_match('/\A[a-f0-9]{64}\z/D', $pin) !== 1) {
                    return self::reject('document_contract');
                }
                $body = $item['body'];
                if (strlen($body) < 250 || strlen($body) > 200000 || str_contains($body, "\0")
                    || preg_match('//u', $body) !== 1
                    || preg_match('/(?:\{\{[^}]+\}\}|\[TODO\]|\bLOREM IPSUM\b|\bDRAFT ONLY\b|НЕ ЮРИДИЧЕСКИЙ ДОКУМЕНТ)/iu', $body) === 1) {
                    return self::reject('placeholder_or_size');
                }
                $actual = hash('sha256', $body);
                if (!hash_equals($pin, $actual)) {
                    return self::reject('digest_mismatch');
                }
                $digests[$kind][$locale] = $actual;
            }
        }
        return [
            'integrity_verified' => true,
            'reason' => 'structural_preflight_only',
            'revision' => $rev,
            'digests' => $digests,
        ];
    }

    /** @return array{integrity_verified:false,reason:string} */
    private static function reject(string $reason): array
    {
        return ['integrity_verified'=>false,'reason'=>$reason];
    }
}
