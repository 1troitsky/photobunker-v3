<?php

declare(strict_types=1);

namespace Tests\Feature;

use App\Identity\Protocol;
use App\PublicCard\SignedPublicationIntent;
use InvalidArgumentException;
use PHPUnit\Framework\Attributes\DataProvider;
use Tests\TestCase;

final class PublicCardSignedPublicationIntentTest extends TestCase
{
    private const NOW = 1_800_000_000_000;
    private const ACCOUNT = '11111111-1111-4111-8111-111111111111';
    private const SOURCE = '22222222-2222-4222-8222-222222222222';
    private const SAFE = '33333333-3333-4333-8333-333333333333';
    private const OPERATION = '44444444-4444-4444-8444-444444444444';

    /** @return array{0:\OpenSSLAsymmetricKey,1:array<string,mixed>,2:array<string,mixed>} */
    private function fixture(): array
    {
        $key = openssl_pkey_new([
            'private_key_type' => OPENSSL_KEYTYPE_EC,
            'curve_name' => 'prime256v1',
        ]);
        self::assertInstanceOf(\OpenSSLAsymmetricKey::class, $key);
        $publicPem = openssl_pkey_get_details($key)['key'];
        $spki = Protocol::encode(base64_decode(
            preg_replace('/-----[^-]+-----|\s+/', '', $publicPem)
        ));
        $fields = [
            'description' => true, 'capturedAt' => false,
            'updatedAt' => false, 'tags' => false,
            'authorTeam' => false, 'gps' => false, 'metadata' => false,
        ];
        $actions = [
            'view' => true, 'copy' => false,
            'download' => false, 'share' => false,
        ];
        $c = [
            'version' => 1,
            'operationId' => self::OPERATION,
            'accountId' => self::ACCOUNT,
            'sourceMediaId' => self::SOURCE,
            'safeMediaId' => self::SAFE,
            'sourceContractHash' => str_repeat('a', 64),
            'safeContractHash' => str_repeat('b', 64),
            'safeDerivativeSha256' => hash('sha256', 'a flattened safe JPEG fixture'),
            'tokenHash' => hash('sha256', random_bytes(32)),
            'revision' => 1,
            'scope' => 'safe-photo-view-v1',
            'expiresAt' => self::NOW + 10_000,
            'fields' => $fields,
            'actions' => $actions,
        ];
        $s = [
            'accountId' => self::ACCOUNT,
            'accountSpki' => $spki,
            'accountReady' => true,
            'expectedRevision' => 1,
            'sourceMediaId' => self::SOURCE,
            'safeMediaId' => self::SAFE,
            'sourceContractHash' => str_repeat('a', 64),
            'safeContractHash' => str_repeat('b', 64),
            'sourceActive' => true,
            'safeActive' => true,
            'sourcePhoto' => true,
            'safePhoto' => true,
            'sourceArchived' => false,
            'safeArchived' => false,
            'sourceTombstoned' => false,
            'safeTombstoned' => false,
            'sourceExpiresAt' => self::NOW + 40_000,
            'safeExpiresAt' => self::NOW + 30_000,
            'assignmentExpiresAt' => self::NOW + 20_000,
            'assignmentAllowsPublic' => true,
            'fileAllowsPublic' => true,
            'assignmentFields' => $fields,
            'fileFields' => $fields,
            'assignmentActions' => $actions,
            'fileActions' => $actions,
        ];

        return [$key, $c, $s];
    }

    private static function json(array $contract): string
    {
        return json_encode($contract, JSON_UNESCAPED_SLASHES | JSON_THROW_ON_ERROR);
    }

    private static function sign(
        \OpenSSLAsymmetricKey $key,
        string $contractJson,
        string $domain = SignedPublicationIntent::DOMAIN
    ): string {
        self::assertTrue(openssl_sign(
            $domain.$contractJson, $der, $key, OPENSSL_ALGO_SHA256
        ));
        $offset = 2;
        $raw = '';
        for ($i = 0; $i < 2; $i++) {
            self::assertSame(2, ord($der[$offset++]));
            $bytes = ord($der[$offset++]);
            $integer = ltrim(substr($der, $offset, $bytes), "\x00");
            self::assertLessThanOrEqual(32, strlen($integer));
            $raw .= str_pad($integer, 32, "\x00", STR_PAD_LEFT);
            $offset += $bytes;
        }
        return Protocol::encode($raw);
    }

    public function test_valid_real_owner_signature_only_returns_nonpublic_internal_intent(): void
    {
        [$key, $c, $state] = $this->fixture();
        $raw = self::json($c);
        $value = SignedPublicationIntent::verify(
            $raw, self::sign($key, $raw), $state, self::NOW
        );
        self::assertSame(self::ACCOUNT, $value['accountId']);
        self::assertSame(self::SAFE, $value['safeMediaId']);
        self::assertSame($c['tokenHash'], $value['tokenHash']);
        self::assertSame(self::NOW + 10_000, $value['expiresAt']);
        self::assertTrue($value['actions']['view']);
        foreach (['token', 'url', 'originalUrl', 'gps', 'dek', 'wrappedDEK', 'ciphertext', 'image'] as $secret) {
            self::assertArrayNotHasKey($secret, $value);
        }
    }

    /** @return iterable<string,array{0:string,1:string,2:mixed}> */
    public static function tampering(): iterable
    {
        yield 'unexpected payload field' => ['contract', 'url', 'https://invalid.test/photo'];
        yield 'wrong account' => ['contract', 'accountId', '55555555-5555-4555-8555-555555555555'];
        yield 'original equals safe' => ['contract', 'safeMediaId', self::SOURCE];
        yield 'wrong source' => ['contract', 'sourceMediaId', '66666666-6666-4666-8666-666666666666'];
        yield 'wrong safe hash' => ['contract', 'safeContractHash', str_repeat('c', 64)];
        yield 'uppercase token digest' => ['contract', 'tokenHash', str_repeat('A', 64)];
        yield 'unbounded original scope' => ['contract', 'scope', 'original'];
        yield 'wrong revision' => ['contract', 'revision', 2];
        yield 'expired intent' => ['contract', 'expiresAt', self::NOW];
        yield 'exceeds assignment deadline' => ['contract', 'expiresAt', self::NOW + 20_001];
        yield 'GPS public' => ['contract', 'fields.gps', true];
        yield 'arbitrary metadata public' => ['contract', 'fields.metadata', true];
        yield 'download escalation' => ['contract', 'actions.download', true];
        yield 'unsafe extra action' => ['contract', 'actions.stream', true];
        yield 'nonboolean public field' => ['contract', 'fields.description', 1];
        yield 'replayed old revision' => ['state', 'expectedRevision', 2];
        yield 'other owner' => ['state', 'accountId', '77777777-7777-4777-8777-777777777777'];
        yield 'disabled account' => ['state', 'accountReady', false];
        yield 'source no longer active' => ['state', 'sourceActive', false];
        yield 'safe no longer active' => ['state', 'safeActive', false];
        yield 'source is not photo' => ['state', 'sourcePhoto', false];
        yield 'safe is not photo' => ['state', 'safePhoto', false];
        yield 'source archived' => ['state', 'sourceArchived', true];
        yield 'safe archived' => ['state', 'safeArchived', true];
        yield 'source tombstone' => ['state', 'sourceTombstoned', true];
        yield 'safe tombstone' => ['state', 'safeTombstoned', true];
        yield 'expired source' => ['state', 'sourceExpiresAt', self::NOW];
        yield 'expired safe' => ['state', 'safeExpiresAt', self::NOW - 1];
        yield 'expired assignment' => ['state', 'assignmentExpiresAt', self::NOW];
        yield 'assignment public disabled' => ['state', 'assignmentAllowsPublic', false];
        yield 'file public disabled' => ['state', 'fileAllowsPublic', false];
        yield 'assignment field ceiling' => ['state', 'assignmentFields.description', false];
        yield 'file field ceiling' => ['state', 'fileFields.description', false];
        yield 'assignment view denied' => ['state', 'assignmentActions.view', false];
        yield 'file view denied' => ['state', 'fileActions.view', false];
        yield 'injected extra trust field' => ['state', 'clientCanPublish', true];
    }

    #[DataProvider('tampering')]
    public function test_even_validly_signed_unsafe_intents_and_stale_server_states_are_rejected(
        string $target, string $keyName, mixed $value
    ): void {
        [$key, $contract, $trusted] = $this->fixture();
        $recipient = &$contract;
        if ($target === 'state') {
            $recipient = &$trusted;
        }
        $path = explode('.', $keyName);
        if (count($path) === 2) {
            $recipient[$path[0]][$path[1]] = $value;
        } else {
            $recipient[$path[0]] = $value;
        }
        unset($recipient);
        $raw = self::json($contract);
        $this->expectException(InvalidArgumentException::class);
        SignedPublicationIntent::verify($raw, self::sign($key, $raw), $trusted, self::NOW);
    }

    public function test_wrong_owner_signature_and_wrong_domain_fail_even_with_valid_schema(): void
    {
        [$key, $contract, $trusted] = $this->fixture();
        $raw = self::json($contract);
        $other = openssl_pkey_new([
            'private_key_type' => OPENSSL_KEYTYPE_EC,
            'curve_name' => 'prime256v1',
        ]);
        self::assertInstanceOf(\OpenSSLAsymmetricKey::class, $other);
        foreach ([
            self::sign($other, $raw),
            self::sign($key, $raw, "pb3.not-public-card.v1\n"),
            'not-a-signature',
        ] as $sig) {
            try {
                SignedPublicationIntent::verify($raw, $sig, $trusted, self::NOW);
                self::fail('Untrusted signature incorrectly accepted');
            } catch (InvalidArgumentException $expected) {
                self::assertNotSame('', $expected->getMessage());
            }
        }
    }

    public function test_noncanonical_and_duplicate_json_key_encoding_are_rejected(): void
    {
        [$key, $contract, $trusted] = $this->fixture();
        $json = self::json($contract);
        foreach ([
            " \n".$json,
            substr($json, 0, -1).',"version":1}',
        ] as $noncanonical) {
            try {
                SignedPublicationIntent::verify(
                    $noncanonical,
                    self::sign($key, $noncanonical),
                    $trusted,
                    self::NOW
                );
                self::fail('Noncanonical signed JSON was accepted');
            } catch (InvalidArgumentException $expected) {
                self::assertNotSame('', $expected->getMessage());
            }
        }
    }
}
