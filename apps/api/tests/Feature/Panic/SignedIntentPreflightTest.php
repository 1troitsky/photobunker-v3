<?php
declare(strict_types=1);

namespace Tests\Feature\Panic;

use App\Identity\Protocol;
use App\Panic\SignedIntentPreflight;
use DomainException;
use Tests\TestCase;

/** Pure PHP/real OpenSSL: no DB, server endpoint or deletion hooks. */
final class SignedIntentPreflightTest extends TestCase
{
    private const DOMAIN = "photobunker.panic.intent.v1\n";
    private const NOW_MS = 1_800_000_000_000;
    private const ACCOUNT = '00000000-0000-4000-8000-000000000001';
    private const DEVICE = '00000000-0000-4000-8000-000000000002';

    /** @return array{key:mixed,spki:string} */
    private function keyPair(): array
    {
        $key = openssl_pkey_new([
            'private_key_type' => OPENSSL_KEYTYPE_EC,
            'curve_name' => 'prime256v1',
        ]);
        self::assertNotFalse($key);
        $details = openssl_pkey_get_details($key);
        self::assertIsArray($details);
        $body = preg_replace('/-----[^-]+-----|\s+/', '', $details['key']);
        self::assertIsString($body);
        $der = base64_decode($body, true);
        self::assertNotFalse($der);
        return ['key' => $key, 'spki' => Protocol::encode($der)];
    }

    private function rawSignature(string $message, mixed $privateKey): string
    {
        self::assertTrue(openssl_sign($message, $der, $privateKey, OPENSSL_ALGO_SHA256));
        // OpenSSL returns DER, but browser sends P1363 r||s (64 bytes).
        self::assertSame(0x30, ord($der[0]));
        $position = 2;
        $read = static function () use (&$position, $der): string {
            if (ord($der[$position++]) !== 0x02) {
                throw new \RuntimeException('Unexpected ECDSA DER integer');
            }
            $length = ord($der[$position++]);
            $integer = substr($der, $position, $length);
            $position += $length;
            return str_pad(ltrim($integer, "\x00"), 32, "\x00", STR_PAD_LEFT);
        };
        return Protocol::encode($read().$read());
    }

    /** @return array<string,mixed> */
    private function contract(int $issuedMs = self::NOW_MS): array
    {
        return [
            'version' => 1,
            'purpose' => 'panic.live-delete',
            'operationId' => '00000000-0000-4000-8000-000000000003',
            'accountId' => self::ACCOUNT,
            'deviceId' => self::DEVICE,
            'keyRevision' => 4,
            'nonce' => Protocol::encode(str_repeat('n', 32)),
            'issuedAt' => gmdate('Y-m-d\TH:i:s', intdiv($issuedMs, 1000))
                .sprintf('.%03dZ', $issuedMs % 1000),
            'liveScope' => 'all-live-locations',
            'vault' => 'preserve-existing-verified',
        ];
    }

    private function scope(): array
    {
        return ['accountId' => self::ACCOUNT, 'deviceId' => self::DEVICE, 'keyRevision' => 4];
    }

    /** @param array<string,mixed> $contract */
    private function wire(array $contract, mixed $privateKey, bool $sort = true, string $domain = self::DOMAIN): array
    {
        if ($sort) {
            ksort($contract, SORT_STRING);
        }
        $json = json_encode($contract, JSON_UNESCAPED_SLASHES | JSON_THROW_ON_ERROR);
        return [
            'contract' => $json,
            'signature' => $this->rawSignature($domain.$json, $privateKey),
        ];
    }

    /** @return array{keys:array,wire:array,scope:array} */
    private function sample(): array
    {
        $keys = $this->keyPair();
        return ['keys' => $keys, 'wire' => $this->wire($this->contract(), $keys['key']), 'scope' => $this->scope()];
    }

    /** @param callable():mixed $callback */
    private function deny(callable $callback): void
    {
        try {
            $callback();
            self::fail('An unauthorized Panic intent was unexpectedly accepted');
        } catch (DomainException $error) {
            self::assertSame('panic.invalid_intent', $error->getMessage());
        }
    }

    public function test_real_p1363_signature_matches_js_canonical_contract_without_granting_delete_authority(): void
    {
        $f = $this->sample();
        $result = SignedIntentPreflight::inspect(
            $f['wire'], $f['scope'], $f['keys']['spki'], self::NOW_MS,
        );
        self::assertSame([
            'operationId' => $this->contract()['operationId'],
            'accountId' => self::ACCOUNT,
            'deviceId' => self::DEVICE,
            'keyRevision' => 4,
            'contractHash' => hash('sha256', $f['wire']['contract']),
        ], $result);
        self::assertArrayNotHasKey('ack', $result);
        self::assertArrayNotHasKey('deleted', $result);
        self::assertArrayNotHasKey('accepted', $result);
    }

    public function test_wrong_device_account_revision_and_wrong_public_key_are_rejected(): void
    {
        $f = $this->sample();
        foreach ([
            ['accountId' => '00000000-0000-4000-8000-000000000009'] + $f['scope'],
            ['deviceId' => '00000000-0000-4000-8000-000000000009'] + $f['scope'],
            ['keyRevision' => 5] + $f['scope'],
            ['accountId' => 'non-uuid'] + $f['scope'],
        ] as $invalidScope) {
            $this->deny(fn () => SignedIntentPreflight::inspect(
                $f['wire'], $invalidScope, $f['keys']['spki'], self::NOW_MS,
            ));
        }
        $other = $this->keyPair();
        $this->deny(fn () => SignedIntentPreflight::inspect(
            $f['wire'], $f['scope'], $other['spki'], self::NOW_MS,
        ));
    }

    public function test_valid_signature_cannot_change_scope_to_delete_recovery_vault_or_account(): void
    {
        $f = $this->sample();
        foreach ([
            ['purpose' => 'panic.account-delete'],
            ['vault' => 'delete-recovery'],
            ['liveScope' => 'all-including-vault'],
            ['version' => 2],
            ['recoveryLocator' => Protocol::encode(random_bytes(16))],
            ['emergencyPin' => '1234'],
        ] as $changes) {
            // Malicious client *can sign* another contract: the server must
            // reject it even with a valid current registered device signature.
            $candidate = $this->wire(array_replace($this->contract(), $changes), $f['keys']['key']);
            $this->deny(fn () => SignedIntentPreflight::inspect(
                $candidate, $f['scope'], $f['keys']['spki'], self::NOW_MS,
            ));
        }
    }

    public function test_mutating_signed_fields_signature_and_domain_fails(): void
    {
        $f = $this->sample();
        foreach ([
            ['accountId' => '00000000-0000-4000-8000-000000000009'],
            ['deviceId' => '00000000-0000-4000-8000-000000000009'],
            ['operationId' => '00000000-0000-4000-8000-000000000009'],
            ['keyRevision' => 5],
            ['nonce' => Protocol::encode(random_bytes(32))],
        ] as $patch) {
            $obj = array_replace($this->contract(), $patch);
            ksort($obj, SORT_STRING);
            $tampered = $f['wire'];
            $tampered['contract'] = json_encode($obj, JSON_UNESCAPED_SLASHES | JSON_THROW_ON_ERROR);
            $this->deny(fn () => SignedIntentPreflight::inspect(
                $tampered, $f['scope'], $f['keys']['spki'], self::NOW_MS,
            ));
        }
        $otherDomain = $this->wire(
            $this->contract(), $f['keys']['key'], true, "photobunker.identity.v2\n",
        );
        $this->deny(fn () => SignedIntentPreflight::inspect(
            $otherDomain, $f['scope'], $f['keys']['spki'], self::NOW_MS,
        ));
    }

    public function test_duplicate_keys_noncanonical_json_and_unknown_outer_fields_are_rejected(): void
    {
        $f = $this->sample();
        $unsorted = $this->wire($this->contract(), $f['keys']['key'], false);
        $this->deny(fn () => SignedIntentPreflight::inspect(
            $unsorted, $f['scope'], $f['keys']['spki'], self::NOW_MS,
        ));
        $double = str_replace(
            '{"accountId":',
            '{"accountId":"'.self::ACCOUNT.'","accountId":',
            $f['wire']['contract'],
        );
        $this->deny(fn () => SignedIntentPreflight::inspect(
            ['contract' => $double, 'signature' => $this->rawSignature(self::DOMAIN.$double, $f['keys']['key'])],
            $f['scope'], $f['keys']['spki'], self::NOW_MS,
        ));
        foreach ([
            $f['wire'] + ['cloud_deleted' => true],
            ['contract' => $f['wire']['contract']],
            ['contract' => $f['wire']['contract'], 'signature' => 'AAAAAAAA'],
            ['contract' => $f['wire']['contract']."\n", 'signature' => $f['wire']['signature']],
            ['contract' => 'not-json', 'signature' => $f['wire']['signature']],
        ] as $bad) {
            $this->deny(fn () => SignedIntentPreflight::inspect(
                $bad, $f['scope'], $f['keys']['spki'], self::NOW_MS,
            ));
        }
    }

    public function test_timestamp_accepts_old_offline_intent_but_not_more_than_two_minute_future(): void
    {
        $f = $this->sample();
        $old = SignedIntentPreflight::inspect(
            $f['wire'], $f['scope'], $f['keys']['spki'], self::NOW_MS + 180 * 86_400_000,
        );
        self::assertSame($this->contract()['operationId'], $old['operationId']);
        $edge = $this->wire($this->contract(self::NOW_MS + 120_000), $f['keys']['key']);
        self::assertSame($this->contract()['operationId'],
            SignedIntentPreflight::inspect($edge, $f['scope'], $f['keys']['spki'], self::NOW_MS)['operationId']);
        $future = $this->wire($this->contract(self::NOW_MS + 120_001), $f['keys']['key']);
        $this->deny(fn () => SignedIntentPreflight::inspect(
            $future, $f['scope'], $f['keys']['spki'], self::NOW_MS,
        ));
    }

    public function test_malformed_nonce_uuid_revision_and_iso_timestamp_fail_closed(): void
    {
        $f = $this->sample();
        foreach ([
            ['nonce' => Protocol::encode(random_bytes(31))],
            ['nonce' => '@'],
            ['operationId' => 'BAD'],
            ['keyRevision' => 4.5],
            ['keyRevision' => '4'],
            ['issuedAt' => '2026-01-01T00:00:00+00:00'],
            ['issuedAt' => '2026-02-30T00:00:00.000Z'],
            ['issuedAt' => '2026-01-01T00:00:00Z'],
        ] as $patch) {
            $wire = $this->wire(array_replace($this->contract(), $patch), $f['keys']['key']);
            $this->deny(fn () => SignedIntentPreflight::inspect(
                $wire, $f['scope'], $f['keys']['spki'], self::NOW_MS,
            ));
        }
    }

    public function test_malformed_current_device_spki_and_server_clock_never_create_a_receipt(): void
    {
        $f = $this->sample();
        $this->deny(fn () => SignedIntentPreflight::inspect(
            $f['wire'], $f['scope'], 'not-spki', self::NOW_MS,
        ));
        $this->deny(fn () => SignedIntentPreflight::inspect(
            $f['wire'], $f['scope'], $f['keys']['spki'], -1,
        ));
        $this->deny(fn () => SignedIntentPreflight::inspect(
            $f['wire'], $f['scope'] + ['server_ack' => true], $f['keys']['spki'], self::NOW_MS,
        ));
    }
}
