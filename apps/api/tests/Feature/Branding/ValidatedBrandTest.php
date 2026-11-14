<?php

declare(strict_types=1);

namespace Tests\Feature\Branding;

use App\Branding\ValidatedBrand;
use InvalidArgumentException;
use Tests\TestCase;

final class ValidatedBrandTest extends TestCase
{
    /** @return array<string, string> */
    private function sample(): array
    {
        return [
            'name' => 'Alternative Brand',
            'short_name' => 'Alternative',
            'slug' => 'alternative-brand',
            'mark' => 'AB',
            'public_url' => 'https://alternative.example.org/',
            'support_url' => 'https://support.example.org/help',
            'legal_name' => 'Alternative LLC',
            'copyright_name' => 'Alternative Studio',
            'theme_color' => '#19aa45',
            'pwa_icons' => '',
        ];
    }

    public function test_brand_switch_changes_public_metadata_without_cryptographic_identifiers(): void
    {
        $public = ValidatedBrand::fromArray($this->sample())->publicMetadata();
        $this->assertSame('Alternative Brand', $public['name']);
        $this->assertSame('alternative-brand', $public['slug']);
        $this->assertSame('https://alternative.example.org', $public['publicUrl']);
        $this->assertSame('https://support.example.org/help', $public['supportUrl']);
        $this->assertSame('#19aa45', $public['themeColor']);
        $this->assertSame(
            ['name', 'shortName', 'slug', 'mark', 'publicUrl', 'supportUrl', 'legalName', 'copyrightName', 'themeColor'],
            array_keys($public),
        );
        foreach (['accountId', 'cryptoDomain', 'recoveryKey', 'storageKey', 'invoiceId', 'pwaIcons'] as $secret) {
            $this->assertArrayNotHasKey($secret, $public);
        }
    }

    public function test_reads_real_laravel_configuration(): void
    {
        config()->set('brand', $this->sample());
        config()->set('app.env', 'production');
        $this->assertSame('Alternative Brand', ValidatedBrand::fromConfig()->publicMetadata()['name']);
    }

    public function test_production_public_origin_rejects_unsafe_values(): void
    {
        foreach ([
            'javascript:alert(1)',
            'http://alternative.example.org',
            'https://user:pass@alternative.example.org',
            'https://alternative.example.org/billing',
            'https://alternative.example.org/?token=secret',
            'https://alternative.example.org/#fragment',
            'https://127.0.0.1:8443',
            'https://192.168.1.10',
            "https://alternative.example.org/\nX-Injected: yes",
        ] as $invalid) {
            try {
                ValidatedBrand::fromArray(array_replace($this->sample(), ['public_url' => $invalid]));
                $this->fail('Unsafe origin accepted.');
            } catch (InvalidArgumentException $exception) {
                $this->assertStringContainsString('brand public_url', $exception->getMessage());
                $this->assertStringNotContainsString('secret', $exception->getMessage());
            }
        }
    }

    public function test_optional_support_target_rejects_embedded_credentials(): void
    {
        foreach ([
            'http://support.example.org',
            'https://user:secret@support.example.org',
            'https://support.example.org/help?access=secret',
            'https://support.example.org/help#secret',
            'file:///etc/passwd',
        ] as $invalid) {
            try {
                ValidatedBrand::fromArray(array_replace($this->sample(), ['support_url' => $invalid]));
                $this->fail('Unsafe support destination accepted.');
            } catch (InvalidArgumentException $exception) {
                $this->assertStringContainsString('brand support_url', $exception->getMessage());
                $this->assertStringNotContainsString('secret', $exception->getMessage());
            }
        }
        $empty = ValidatedBrand::fromArray(
            array_replace($this->sample(), ['support_url' => ''])
        )->publicMetadata();
        $this->assertSame('', $empty['supportUrl']);
    }

    public function test_local_http_is_only_possible_for_explicit_loopback(): void
    {
        $local = array_replace($this->sample(), [
            'public_url' => 'http://127.0.0.1:5173/',
            'support_url' => 'http://localhost:8000/help',
        ]);
        $this->assertSame(
            'http://127.0.0.1:5173',
            ValidatedBrand::fromArray($local, true)->publicMetadata()['publicUrl'],
        );
        $this->expectException(InvalidArgumentException::class);
        ValidatedBrand::fromArray($local, false);
    }

    public function test_invalid_slug_color_markup_and_control_text_rejected(): void
    {
        foreach ([
            ['slug', '../files'],
            ['slug', 'Invalid Brand'],
            ['theme_color', 'red;url(x)'],
            ['name', '<img src=x>'],
            ['mark', "X\nInjected"],
            ['short_name', ''],
        ] as [$key, $invalid]) {
            try {
                ValidatedBrand::fromArray(array_replace($this->sample(), [$key => $invalid]));
                $this->fail("Invalid {$key} accepted.");
            } catch (InvalidArgumentException) {
                $this->addToAssertionCount(1);
            }
        }
    }
}
