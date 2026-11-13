<?php

declare(strict_types=1);

namespace Tests\Unit\PublicCard;

use App\PublicCard\SafeCardProjection;
use InvalidArgumentException;
use PHPUnit\Framework\Attributes\DataProvider;
use PHPUnit\Framework\TestCase;

final class SafeCardProjectionTest extends TestCase
{
    private const NOW = 1800000000000;

    /** @return array{0:array<string,mixed>,1:array<string,mixed>} */
    private static function validInput(): array
    {
        return [
            [
                'mimeType' => 'image/jpeg',
                'description' => 'Verified safe image',
                'capturedAt' => '2026-11-13T12:00:00Z',
                'expiresAt' => self::NOW + 7000,
            ],
            [
                'publication' => 'disabled',
                'expiresAt' => self::NOW + 2000,
                'fields' => [
                    'description' => true,
                    'capturedAt' => true,
                    'updatedAt' => false,
                    'tags' => false,
                    'authorTeam' => false,
                    'gps' => false,
                    'metadata' => false,
                ],
                'actions' => [
                    'view' => false,
                    'copy' => false,
                    'download' => false,
                    'share' => false,
                ],
            ],
        ];
    }

    public function test_only_allowlisted_safe_data_is_emitted_and_expiry_is_minimum(): void
    {
        [$safe, $policy] = self::validInput();
        self::assertSame([
            'mimeType' => 'image/jpeg',
            'description' => 'Verified safe image',
            'capturedAt' => '2026-11-13T12:00:00Z',
            'expiresAt' => self::NOW + 2000,
        ], SafeCardProjection::preview($safe, $policy, self::NOW));
    }

    public function test_optional_fields_must_be_absent_when_not_granted(): void
    {
        [$safe, $policy] = self::validInput();
        $safe['description'] = null;
        $safe['capturedAt'] = null;
        $policy['fields']['description'] = false;
        $policy['fields']['capturedAt'] = false;
        self::assertNull(SafeCardProjection::preview($safe, $policy, self::NOW)['description']);
    }

    /** @return iterable<string,array{0:string,1:string,2:mixed}> */
    public static function maliciousInput(): iterable
    {
        yield 'original URL injection' => ['safe', 'originalUrl', 'https://example.test/original'];
        yield 'GPS injection' => ['safe', 'gps', ['latitude' => 1]];
        yield 'DEK injection' => ['safe', 'dek', 'private-key'];
        yield 'HTML description' => ['safe', 'description', '<img src=x>'];
        yield 'control character' => ['safe', 'description', "unsafe\ntext"];
        yield 'overlong description' => ['safe', 'description', str_repeat('a', 501)];
        yield 'wrong MIME' => ['safe', 'mimeType', 'image/png'];
        yield 'media expired' => ['safe', 'expiresAt', self::NOW - 1];
        yield 'ceiling expired' => ['policy', 'expiresAt', self::NOW];
        yield 'attempted publication activation' => ['policy', 'publication', 'enabled'];
        yield 'allow GPS flag' => ['fields', 'gps', true];
        yield 'allow arbitrary metadata' => ['fields', 'metadata', true];
        yield 'allow download action' => ['actions', 'download', true];
        yield 'allow view action' => ['actions', 'view', true];
        yield 'unexpected policy scope' => ['policy', 'sourceMediaId', 'original-id'];
        yield 'incorrect type' => ['safe', 'expiresAt', (string) (self::NOW + 7000)];
    }

    #[DataProvider('maliciousInput')]
    public function test_all_unsafe_or_undeclared_inputs_fail_closed(
        string $location, string $key, mixed $value
    ): void {
        [$safe, $policy] = self::validInput();
        switch ($location) {
            case 'safe':
                $safe[$key] = $value;
                break;
            case 'policy':
                $policy[$key] = $value;
                break;
            case 'fields':
                $policy['fields'][$key] = $value;
                break;
            case 'actions':
                $policy['actions'][$key] = $value;
                break;
        }
        $this->expectException(InvalidArgumentException::class);
        SafeCardProjection::preview($safe, $policy, self::NOW);
    }

    public function test_no_publication_capability_is_conferred(): void
    {
        [$safe, $policy] = self::validInput();
        $result = SafeCardProjection::preview($safe, $policy, self::NOW);
        foreach (['url', 'token', 'sourceMediaId', 'safeMediaId', 'gps', 'dek', 'original', 'storageKey'] as $secret) {
            self::assertArrayNotHasKey($secret, $result);
        }
        self::assertSame('disabled', $policy['publication']);
        self::assertFalse($policy['actions']['view']);
    }
}
