<?php

declare(strict_types=1);

namespace App\PublicCard;

use App\Identity\Protocol;
use InvalidArgumentException;
use Throwable;

/**
 * PREPUBLICATION only: an independently contributor-signed declaration that
 * they reviewed the exact output JPEG digest and are willing to consider a
 * FUTURE view-only public scope. Never an active grant or anonymous endpoint.
 *
 * This does not establish pixel review, proof of flattened JPEG bytes,
 * actual contributor right to publish, replay prevention or live ACL.
 * A future issuer must independently derive $trusted from real locked DB
 * receipt/media/policy/consent records, persist revocation, and require a
 * separate active public grant checked on EVERY read.
 */
final class SignedContributorPublicConsent
{
    public const DOMAIN = "pb3.public-card-contributor-consent-preflight.v1\n";

    private const CONTRACT = [
        'version', 'consentId', 'operationId', 'contributorAccountId',
        'assignmentId', 'submissionId', 'submissionContractHash',
        'sourceMediaId', 'sourceContractHash', 'safeMediaId',
        'safeDerivativeSha256', 'reviewDeclaration', 'scope',
        'action', 'expiresAt', 'fields',
    ];

    private const TRUSTED = [
        'contributorAccountId', 'contributorSpki', 'contributorReady',
        'assignmentId', 'submissionId', 'submissionContractHash',
        'sourceMediaId', 'sourceContractHash',
        'safeMediaId', 'safeDerivativeSha256',
        'receiptProvenanceVerified', 'sourceOwnerVerified',
        'sourceExpiresAt', 'safeExpiresAt', 'assignmentExpiresAt',
    ];

    private const FIELDS = [
        'description', 'capturedAt', 'updatedAt', 'tags',
        'authorTeam', 'gps', 'metadata',
    ];

    /**
     * @param array<string,mixed> $trusted Independently resolved authoritative
     *                                     snapshot, NEVER client-submitted data.
     * @return array{consentId:string,submissionId:string,contributorAccountId:string,safeMediaId:string,safeDerivativeSha256:string,expiresAt:int,fields:array<string,bool>,consentPrepared:bool,published:bool,publicAuthorized:bool}
     */
    public static function verify(
        string $json,
        string $signature,
        array $trusted,
        int $nowMs
    ): array {
        self::require($nowMs > 1_500_000_000_000);
        self::require(strlen($json) >= 250 && strlen($json) <= 4096);
        self::exact($trusted, self::TRUSTED);
        try {
            $c = json_decode($json, true, 16, JSON_THROW_ON_ERROR);
        } catch (Throwable) {
            self::fail();
        }
        self::exact($c, self::CONTRACT);
        try {
            self::require(json_encode(
                $c, JSON_UNESCAPED_SLASHES | JSON_THROW_ON_ERROR
            ) === $json);
        } catch (Throwable) {
            self::fail();
        }
        self::require($c['version'] === 1
            && $c['reviewDeclaration'] === 'reviewed-exact-safe-jpeg-sha256'
            && $c['scope'] === 'safe-jpeg-view-only-v1'
            && $c['action'] === 'prepare-consent'
            && is_int($c['expiresAt'])
            && $c['expiresAt'] > $nowMs);
        foreach ([
            'consentId', 'operationId', 'contributorAccountId',
            'assignmentId', 'submissionId', 'sourceMediaId', 'safeMediaId',
        ] as $field) {
            self::require(self::uuid($c[$field]));
        }
        self::require($c['sourceMediaId'] !== $c['safeMediaId']);
        foreach ([
            'submissionContractHash', 'sourceContractHash',
            'safeDerivativeSha256',
        ] as $field) {
            self::require(self::hash($c[$field]));
        }
        self::require($trusted['contributorReady'] === true
            && $trusted['receiptProvenanceVerified'] === true
            && $trusted['sourceOwnerVerified'] === true
            && is_string($trusted['contributorSpki'])
            && $trusted['contributorSpki'] !== '');
        foreach ([
            'contributorAccountId', 'assignmentId', 'submissionId',
            'submissionContractHash', 'sourceMediaId',
            'sourceContractHash', 'safeMediaId', 'safeDerivativeSha256',
        ] as $bound) {
            self::require(is_string($trusted[$bound])
                && hash_equals($trusted[$bound], $c[$bound]));
        }
        foreach ([
            $trusted['sourceExpiresAt'],
            $trusted['safeExpiresAt'],
            $trusted['assignmentExpiresAt'],
        ] as $maxExpiry) {
            self::require(is_int($maxExpiry)
                && $maxExpiry > $nowMs
                && $c['expiresAt'] <= $maxExpiry);
        }
        self::exact($c['fields'], self::FIELDS);
        foreach (self::FIELDS as $field) {
            self::require(is_bool($c['fields'][$field]));
            // GPS, arbitrary metadata, author/team, tags and updated time
            // cannot be included without additional signed product scopes.
            if (!in_array($field, ['description', 'capturedAt'], true)) {
                self::require($c['fields'][$field] === false);
            }
        }
        try {
            self::require(Protocol::verify(
                $trusted['contributorSpki'],
                self::DOMAIN.$json,
                $signature
            ));
        } catch (Throwable) {
            self::fail();
        }

        // Proof of a declaration only. No bearer URL, plaintext pixels,
        // private DEK, file bytes, original image or public permissions.
        return [
            'consentId' => $c['consentId'],
            'submissionId' => $c['submissionId'],
            'contributorAccountId' => $c['contributorAccountId'],
            'safeMediaId' => $c['safeMediaId'],
            'safeDerivativeSha256' => $c['safeDerivativeSha256'],
            'expiresAt' => $c['expiresAt'],
            'fields' => $c['fields'],
            'consentPrepared' => true,
            'published' => false,
            'publicAuthorized' => false,
        ];
    }

    /** @param list<string> $fields */
    private static function exact(mixed $value, array $fields): void
    {
        self::require(is_array($value) && !array_is_list($value));
        $actual = array_keys($value);
        sort($actual, SORT_STRING);
        sort($fields, SORT_STRING);
        self::require($actual === $fields);
    }

    private static function uuid(mixed $value): bool
    {
        return is_string($value)
            && preg_match(
                '/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/D',
                $value
            ) === 1;
    }

    private static function hash(mixed $value): bool
    {
        return is_string($value)
            && preg_match('/^[a-f0-9]{64}$/D', $value) === 1;
    }

    private static function require(bool $okay): void
    {
        if (!$okay) self::fail();
    }

    private static function fail(): never
    {
        throw new InvalidArgumentException(
            'Invalid prepublication contributor consent declaration'
        );
    }
}
