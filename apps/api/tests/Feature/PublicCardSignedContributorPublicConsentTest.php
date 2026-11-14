<?php

declare(strict_types=1);

namespace Tests\Feature;

use App\Identity\Protocol;
use App\PublicCard\SignedContributorPublicConsent;
use InvalidArgumentException;
use OpenSSLAsymmetricKey;
use Tests\TestCase;

final class PublicCardSignedContributorPublicConsentTest extends TestCase
{
    private const NOW = 1_800_000_000_000;
    private const ACCOUNT = '11111111-1111-4111-8111-111111111111';
    private const ASSIGNMENT = '22222222-2222-4222-8222-222222222222';
    private const SUBMISSION = '33333333-3333-4333-8333-333333333333';
    private const SOURCE = '44444444-4444-4444-8444-444444444444';
    private const SAFE = '55555555-5555-4555-8555-555555555555';

    private OpenSSLAsymmetricKey $contributor;
    private OpenSSLAsymmetricKey $other;
    private array $contract;
    private array $trusted;

    protected function setUp(): void
    {
        parent::setUp();
        $contributor = openssl_pkey_new([
            'private_key_type' => OPENSSL_KEYTYPE_EC,
            'curve_name' => 'prime256v1',
        ]);
        $other = openssl_pkey_new([
            'private_key_type' => OPENSSL_KEYTYPE_EC,
            'curve_name' => 'prime256v1',
        ]);
        self::assertInstanceOf(OpenSSLAsymmetricKey::class, $contributor);
        self::assertInstanceOf(OpenSSLAsymmetricKey::class, $other);
        $this->contributor = $contributor;
        $this->other = $other;
        $pem = openssl_pkey_get_details($contributor)['key'];
        $spki = Protocol::encode(base64_decode(preg_replace(
            '/-----[^-]+-----|\s+/', '', $pem
        )));
        $this->contract = [
            'version' => 1,
            'consentId' => '66666666-6666-4666-8666-666666666666',
            'operationId' => '77777777-7777-4777-8777-777777777777',
            'contributorAccountId' => self::ACCOUNT,
            'assignmentId' => self::ASSIGNMENT,
            'submissionId' => self::SUBMISSION,
            'submissionContractHash' => str_repeat('a', 64),
            'sourceMediaId' => self::SOURCE,
            'sourceContractHash' => str_repeat('b', 64),
            'safeMediaId' => self::SAFE,
            'safeDerivativeSha256' => str_repeat('c', 64),
            'reviewDeclaration' => 'reviewed-exact-safe-jpeg-sha256',
            'scope' => 'safe-jpeg-view-only-v1',
            'action' => 'prepare-consent',
            'expiresAt' => self::NOW + 10_000,
            'fields' => [
                'description' => true,
                'capturedAt' => false,
                'updatedAt' => false,
                'tags' => false,
                'authorTeam' => false,
                'gps' => false,
                'metadata' => false,
            ],
        ];
        $this->trusted = [
            'contributorAccountId' => self::ACCOUNT,
            'contributorSpki' => $spki,
            'contributorReady' => true,
            'assignmentId' => self::ASSIGNMENT,
            'submissionId' => self::SUBMISSION,
            'submissionContractHash' => str_repeat('a', 64),
            'sourceMediaId' => self::SOURCE,
            'sourceContractHash' => str_repeat('b', 64),
            'safeMediaId' => self::SAFE,
            'safeDerivativeSha256' => str_repeat('c', 64),
            'receiptProvenanceVerified' => true,
            'sourceOwnerVerified' => true,
            'sourceExpiresAt' => self::NOW + 30_000,
            'safeExpiresAt' => self::NOW + 20_000,
            'assignmentExpiresAt' => self::NOW + 15_000,
        ];
    }

    private static function canonical(array $value): string
    {
        return json_encode($value, JSON_UNESCAPED_SLASHES | JSON_THROW_ON_ERROR);
    }

    private function signature(
        string $raw,
        ?OpenSSLAsymmetricKey $key = null,
        string $domain = SignedContributorPublicConsent::DOMAIN
    ): string {
        self::assertTrue(openssl_sign(
            $domain.$raw, $der, $key ?? $this->contributor, OPENSSL_ALGO_SHA256
        ));
        $offset = 2;
        $rawSignature = '';
        for ($i = 0; $i < 2; $i++) {
            self::assertSame(2, ord($der[$offset++]));
            $length = ord($der[$offset++]);
            $integer = ltrim(substr($der, $offset, $length), "\0");
            self::assertLessThanOrEqual(32, strlen($integer));
            $rawSignature .= str_pad($integer, 32, "\0", STR_PAD_LEFT);
            $offset += $length;
        }
        return Protocol::encode($rawSignature);
    }

    private function verify(
        ?array $contract = null,
        ?array $trusted = null,
        ?OpenSSLAsymmetricKey $key = null,
        string $domain = SignedContributorPublicConsent::DOMAIN,
        int $now = self::NOW
    ): array {
        $raw = self::canonical($contract ?? $this->contract);
        return SignedContributorPublicConsent::verify(
            $raw, $this->signature($raw, $key, $domain),
            $trusted ?? $this->trusted, $now
        );
    }

    private function rejected(callable $operation): void
    {
        try {
            $operation();
            self::fail('Untrusted consent preflight was accepted');
        } catch (InvalidArgumentException $e) {
            self::assertSame(
                'Invalid prepublication contributor consent declaration',
                $e->getMessage()
            );
        }
    }

    public function test_contributor_signed_digest_is_a_prepared_declaration_not_a_grant(): void
    {
        $checked = $this->verify();
        self::assertTrue($checked['consentPrepared']);
        self::assertFalse($checked['published']);
        self::assertFalse($checked['publicAuthorized']);
        self::assertSame(self::SAFE, $checked['safeMediaId']);
        self::assertSame(str_repeat('c', 64), $checked['safeDerivativeSha256']);
        self::assertSame(self::NOW + 10_000, $checked['expiresAt']);
        self::assertSame(self::SUBMISSION, $checked['submissionId']);
        foreach (['token', 'url', 'key', 'original', 'gps', 'image', 'envelope'] as $field) {
            self::assertArrayNotHasKey($field, $checked);
        }
    }

    public function test_owner_or_stranger_cannot_sign_for_contributor(): void
    {
        $this->rejected(fn () => $this->verify(key: $this->other));
    }

    public function test_signature_from_other_domain_cannot_authorize_same_bytes(): void
    {
        $this->rejected(fn () => $this->verify(
            domain: "pb3.public-card-publication-intent.v1\n"
        ));
    }

    public function test_wrong_exact_safe_jpeg_digest_and_source_id_are_denied(): void
    {
        $c = $this->contract;
        $c['safeDerivativeSha256'] = str_repeat('d', 64);
        $this->rejected(fn () => $this->verify($c));
        $c = $this->contract;
        $c['sourceMediaId'] = self::SAFE;
        $this->rejected(fn () => $this->verify($c));
        $c = $this->contract;
        $c['submissionContractHash'] = str_repeat('e', 64);
        $this->rejected(fn () => $this->verify($c));
    }

    public function test_contributor_does_not_infer_public_scope_from_viewer_preview(): void
    {
        foreach ([
            ['action' => 'publish'],
            ['scope' => 'original-download-v1'],
            ['reviewDeclaration' => 'unchecked'],
            ['version' => 2],
        ] as $change) {
            $this->rejected(fn () => $this->verify(
                array_replace($this->contract, $change)
            ));
        }
    }

    public function test_gps_metadata_tags_extra_actions_and_token_are_all_disallowed(): void
    {
        foreach (['gps', 'metadata', 'tags', 'authorTeam', 'updatedAt'] as $field) {
            $c = $this->contract;
            $c['fields'][$field] = true;
            $this->rejected(fn () => $this->verify($c));
        }
        $c = $this->contract;
        $c['token'] = 'secret';
        $this->rejected(fn () => $this->verify($c));
        $c = $this->contract;
        $c['download'] = true;
        $this->rejected(fn () => $this->verify($c));
    }

    public function test_consent_cannot_outlive_source_safe_or_assignment(): void
    {
        $c = $this->contract;
        $c['expiresAt'] = self::NOW + 16_000;
        $this->rejected(fn () => $this->verify($c));
        $this->rejected(fn () => $this->verify(now: self::NOW + 11_000));
        $c = $this->contract;
        $c['expiresAt'] = self::NOW + 14_000;
        self::assertSame(self::NOW + 14_000, $this->verify($c)['expiresAt']);
    }

    public function test_retired_contributor_or_untrusted_receipt_denies_even_valid_signature(): void
    {
        foreach ([
            ['contributorReady' => false],
            ['receiptProvenanceVerified' => false],
            ['sourceOwnerVerified' => false],
            ['contributorAccountId' => '88888888-8888-4888-8888-888888888888'],
            ['assignmentId' => '99999999-9999-4999-8999-999999999999'],
        ] as $drift) {
            $this->rejected(fn () => $this->verify(
                trusted: array_replace($this->trusted, $drift)
            ));
        }
    }

    public function test_rejects_noncanonical_and_duplicate_key_json_even_if_signed(): void
    {
        $raw = self::canonical($this->contract).' ';
        $this->rejected(fn () => SignedContributorPublicConsent::verify(
            $raw, $this->signature($raw), $this->trusted, self::NOW
        ));
        $raw = substr(self::canonical($this->contract), 0, -1)
            .',"action":"prepare-consent"}';
        $this->rejected(fn () => SignedContributorPublicConsent::verify(
            $raw, $this->signature($raw), $this->trusted, self::NOW
        ));
    }

    public function test_invalid_signature_and_missing_trusted_field_fail_closed(): void
    {
        $raw = self::canonical($this->contract);
        $this->rejected(fn () => SignedContributorPublicConsent::verify(
            $raw, Protocol::encode(str_repeat('x', 64)),
            $this->trusted, self::NOW
        ));
        $t = $this->trusted;
        unset($t['sourceOwnerVerified']);
        $this->rejected(fn () => $this->verify(trusted: $t));
    }

    public function test_signature_replay_is_still_only_a_declaration_not_access(): void
    {
        $first = $this->verify();
        $second = $this->verify();
        self::assertSame($first, $second);
        self::assertFalse($first['publicAuthorized']);
        // A future persistent issuer MUST implement fresh consent revocation
        // and replay protection. This pure preflight does not claim either.
    }
}
