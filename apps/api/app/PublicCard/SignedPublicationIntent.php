<?php

declare(strict_types=1);

namespace App\PublicCard;

use App\Identity\Protocol;
use InvalidArgumentException;
use Throwable;

/**
 * Verifies a *future* owner-authorized publication INTENT, not public access.
 *
 * No endpoint invokes this class. A later publisher MUST independently bind
 * every input in $trusted to a current locked server row, verify the separate
 * assignment/file policy chains, flatten and inspect the JPEG, atomically store
 * uniqueness/revocation and re-evaluate ACL/TTL on EVERY anonymous read.
 *
 * Never derive $trusted from client JSON; success never activates a URL.
 */
final class SignedPublicationIntent
{
    public const DOMAIN = "pb3.public-card-publication-intent.v1\n";

    private const CONTRACT_FIELDS = [
        'version', 'operationId', 'accountId', 'sourceMediaId',
        'safeMediaId', 'sourceContractHash', 'safeContractHash',
        'safeDerivativeSha256', 'tokenHash', 'revision', 'scope',
        'expiresAt', 'fields', 'actions',
    ];

    private const TRUSTED_FIELDS = [
        'accountId', 'accountSpki', 'accountReady', 'expectedRevision',
        'sourceMediaId', 'safeMediaId',
        'sourceContractHash', 'safeContractHash',
        'sourceActive', 'safeActive', 'sourcePhoto', 'safePhoto',
        'sourceArchived', 'safeArchived',
        'sourceTombstoned', 'safeTombstoned',
        'sourceExpiresAt', 'safeExpiresAt', 'assignmentExpiresAt',
        'assignmentAllowsPublic', 'fileAllowsPublic',
        'assignmentFields', 'fileFields',
        'assignmentActions', 'fileActions',
    ];

    private const PUBLIC_FIELDS = [
        'description', 'capturedAt', 'updatedAt', 'tags',
        'authorTeam', 'gps', 'metadata',
    ];

    private const PUBLIC_ACTIONS = ['view', 'copy', 'download', 'share'];

    /**
     * @param array<string,mixed> $trusted A verified authoritative snapshot, never request data.
     * @return array{accountId:string,operationId:string,sourceMediaId:string,safeMediaId:string,tokenHash:string,safeDerivativeSha256:string,revision:int,expiresAt:int,fields:array<string,bool>,actions:array<string,bool>}
     */
    public static function verify(
        string $contractJson,
        string $p1363Signature,
        array $trusted,
        int $nowMs
    ): array {
        self::ensure($nowMs > 1_500_000_000_000);
        self::ensure(strlen($contractJson) >= 200 && strlen($contractJson) <= 4096);
        self::exact($trusted, self::TRUSTED_FIELDS);

        try {
            $contract = json_decode($contractJson, true, 16, JSON_THROW_ON_ERROR);
        } catch (Throwable) {
            self::fail();
        }
        self::ensure(is_array($contract) && !array_is_list($contract));
        self::exact($contract, self::CONTRACT_FIELDS);

        // Reject alias encodings, whitespace and duplicate JSON keys.
        try {
            self::ensure(json_encode($contract, JSON_UNESCAPED_SLASHES | JSON_THROW_ON_ERROR) === $contractJson);
        } catch (Throwable) {
            self::fail();
        }

        self::ensure($contract['version'] === 1 && $contract['scope'] === 'safe-photo-view-v1');
        self::ensure(is_int($contract['revision']) && $contract['revision'] >= 1
            && $contract['revision'] <= 1_000_000
            && is_int($trusted['expectedRevision'])
            && $contract['revision'] === $trusted['expectedRevision']);

        foreach (['operationId', 'accountId', 'sourceMediaId', 'safeMediaId'] as $id) {
            self::ensure(self::uuid($contract[$id]));
        }
        self::ensure($contract['sourceMediaId'] !== $contract['safeMediaId']);
        foreach (['sourceContractHash', 'safeContractHash', 'safeDerivativeSha256', 'tokenHash'] as $digest) {
            self::ensure(self::digest($contract[$digest]));
        }

        self::ensure(is_string($trusted['accountSpki']) && $trusted['accountSpki'] !== '');
        self::ensure($trusted['accountReady'] === true);
        foreach ([
            'accountId', 'sourceMediaId', 'safeMediaId',
            'sourceContractHash', 'safeContractHash',
        ] as $bound) {
            self::ensure(is_string($trusted[$bound])
                && hash_equals($trusted[$bound], $contract[$bound]));
        }

        foreach (['sourceActive', 'safeActive', 'sourcePhoto', 'safePhoto',
                  'assignmentAllowsPublic', 'fileAllowsPublic'] as $required) {
            self::ensure($trusted[$required] === true);
        }
        foreach (['sourceArchived', 'safeArchived',
                  'sourceTombstoned', 'safeTombstoned'] as $forbidden) {
            self::ensure($trusted[$forbidden] === false);
        }

        self::ensure(is_int($contract['expiresAt']) && $contract['expiresAt'] > $nowMs);
        $ceilings = [$trusted['sourceExpiresAt'], $trusted['safeExpiresAt']];
        if ($trusted['assignmentExpiresAt'] !== null) {
            $ceilings[] = $trusted['assignmentExpiresAt'];
        }
        foreach ($ceilings as $ceiling) {
            self::ensure(is_int($ceiling) && $ceiling > $nowMs);
        }
        self::ensure($contract['expiresAt'] <= min($ceilings));

        self::booleans($contract['fields'], self::PUBLIC_FIELDS);
        self::booleans($trusted['assignmentFields'], self::PUBLIC_FIELDS);
        self::booleans($trusted['fileFields'], self::PUBLIC_FIELDS);
        self::booleans($contract['actions'], self::PUBLIC_ACTIONS);
        self::booleans($trusted['assignmentActions'], self::PUBLIC_ACTIONS);
        self::booleans($trusted['fileActions'], self::PUBLIC_ACTIONS);

        // Deliberately narrower than the complete future UX. GPS, arbitrary
        // metadata and downloads need separate audited product contracts.
        foreach (self::PUBLIC_FIELDS as $field) {
            if (!in_array($field, ['description', 'capturedAt'], true)) {
                self::ensure($contract['fields'][$field] === false);
            }
            if ($contract['fields'][$field]) {
                self::ensure($trusted['assignmentFields'][$field]
                    && $trusted['fileFields'][$field]);
            }
        }
        self::ensure($contract['actions']['view'] === true
            && $trusted['assignmentActions']['view'] === true
            && $trusted['fileActions']['view'] === true);
        foreach (['copy', 'download', 'share'] as $action) {
            self::ensure($contract['actions'][$action] === false);
        }

        // Real P-256 owner ROOT signature, not browser device key or a hash
        // submitted by the holder of a future public URL.
        try {
            self::ensure(Protocol::verify(
                $trusted['accountSpki'],
                self::DOMAIN.$contractJson,
                $p1363Signature
            ));
        } catch (Throwable) {
            self::fail();
        }

        // Internal result ONLY. Includes hashed capability, never bearer
        // secret, original bytes, private keys, GPS or public URL.
        return [
            'accountId' => $contract['accountId'],
            'operationId' => $contract['operationId'],
            'sourceMediaId' => $contract['sourceMediaId'],
            'safeMediaId' => $contract['safeMediaId'],
            'tokenHash' => $contract['tokenHash'],
            'safeDerivativeSha256' => $contract['safeDerivativeSha256'],
            'revision' => $contract['revision'],
            'expiresAt' => $contract['expiresAt'],
            'fields' => $contract['fields'],
            'actions' => $contract['actions'],
        ];
    }

    private static function uuid(mixed $id): bool
    {
        return is_string($id)
            && preg_match('/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/D', $id) === 1;
    }

    private static function digest(mixed $digest): bool
    {
        return is_string($digest) && preg_match('/^[0-9a-f]{64}$/D', $digest) === 1;
    }

    /** @param array<string,mixed> $data @param list<string> $keys */
    private static function exact(mixed $data, array $keys): void
    {
        self::ensure(is_array($data) && !array_is_list($data));
        $actual = array_keys($data);
        sort($actual, SORT_STRING);
        sort($keys, SORT_STRING);
        self::ensure($actual === $keys);
    }

    /** @param list<string> $keys */
    private static function booleans(mixed $data, array $keys): void
    {
        self::exact($data, $keys);
        foreach ($keys as $key) {
            self::ensure(is_bool($data[$key]));
        }
    }

    private static function ensure(bool $valid): void
    {
        if (!$valid) {
            self::fail();
        }
    }

    private static function fail(): never
    {
        throw new InvalidArgumentException('Invalid signed public publication intent');
    }
}
