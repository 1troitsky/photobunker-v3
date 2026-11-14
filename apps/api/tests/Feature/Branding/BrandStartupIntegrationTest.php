<?php

declare(strict_types=1);

namespace Tests\Feature\Branding;

use App\Providers\AppServiceProvider;
use InvalidArgumentException;
use Tests\TestCase;

/**
 * Exercises the real AppServiceProvider::boot() entry point rather than
 * only invoking a detached brand parser.
 */
final class BrandStartupIntegrationTest extends TestCase
{
    /** @param array<string, string> $overrides */
    private function configure(string $environment, array $overrides = []): void
    {
        config()->set('app.env', $environment);
        config()->set('brand', array_replace([
            'name' => 'Brand Switch',
            'short_name' => 'Brand',
            'slug' => 'brand-switch',
            'mark' => 'B',
            'public_url' => 'https://brand-switch.example.org/',
            'support_url' => 'https://support.example.org/help',
            'legal_name' => '',
            'copyright_name' => '',
            'theme_color' => '#1ed760',
            'pwa_icons' => '',
        ], $overrides));
    }

    public function test_valid_production_brand_passes_actual_provider_boot(): void
    {
        $this->configure('production');
        (new AppServiceProvider($this->app))->boot();

        $this->getJson('/api/healthz')->assertOk()->assertExactJson(['status' => 'ok']);
    }

    public function test_provider_boot_rejects_insecure_production_origin(): void
    {
        $this->configure('production', ['public_url' => 'http://brand-switch.example.org/']);

        $this->expectException(InvalidArgumentException::class);
        $this->expectExceptionMessage('Invalid brand public_url');
        (new AppServiceProvider($this->app))->boot();
    }

    public function test_provider_boot_rejects_credentials_in_support_destination(): void
    {
        $this->configure('production', ['support_url' => 'https://user:secret@support.example.org/help']);

        $this->expectException(InvalidArgumentException::class);
        $this->expectExceptionMessage('Invalid brand support_url');
        (new AppServiceProvider($this->app))->boot();
    }

    public function test_provider_boot_rejects_markup_in_user_facing_name(): void
    {
        $this->configure('production', ['name' => '<script>alert(1)</script>']);

        $this->expectException(InvalidArgumentException::class);
        $this->expectExceptionMessage('Invalid brand name');
        (new AppServiceProvider($this->app))->boot();
    }

    public function test_local_loopback_can_boot_but_same_config_fails_in_production(): void
    {
        $this->configure('testing', [
            'public_url' => 'http://127.0.0.1:5173/',
            'support_url' => '',
        ]);
        (new AppServiceProvider($this->app))->boot();

        config()->set('app.env', 'production');
        $this->expectException(InvalidArgumentException::class);
        (new AppServiceProvider($this->app))->boot();
    }

    public function test_pre_release_https_placeholder_does_not_activate_any_service(): void
    {
        // Structural gate, not production deployment/domain approval.
        $this->configure('production', [
            'name' => 'Example Application',
            'short_name' => 'Example',
            'slug' => 'example-app',
            'public_url' => 'https://example.invalid',
            'support_url' => '',
        ]);
        (new AppServiceProvider($this->app))->boot();
        $this->assertSame('https://example.invalid', config('brand.public_url'));
    }
}
