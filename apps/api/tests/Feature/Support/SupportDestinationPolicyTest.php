<?php
declare(strict_types=1);

namespace Tests\Feature\Support;

use App\Support\SupportDestinationPolicy;
use PHPUnit\Framework\TestCase;

final class SupportDestinationPolicyTest extends TestCase
{
    public function test_no_config_no_endpoint_and_safe_syntax_is_not_confirmed_delivery(): void
    {
        self::assertSame('unconfigured',SupportDestinationPolicy::validate(null)['reason']);
        self::assertSame('unconfigured',SupportDestinationPolicy::validate('')['reason']);
        $r = SupportDestinationPolicy::validate('https://help.example.org/contact');
        self::assertTrue($r['valid']);
        self::assertSame('syntactic_https_only',$r['reason']);
        self::assertArrayNotHasKey('reachable',$r);
        self::assertArrayNotHasKey('delivered',$r);
    }

    public function test_rejects_secret_carrying_untrusted_or_non_https_endpoints(): void
    {
        foreach ([
            'http://help.example.org/contact',
            'https://user:pass@help.example.org/contact',
            'https://help.example.org/contact?recovery_key=secret',
            'https://help.example.org/contact#private',
            'https://127.0.0.1/contact',
            'https://[::1]/contact',
            'https://localhost/contact',
            'https://help.local/contact',
            'https://help.example.org:8080/contact',
            'https://help.example.org/%0a/contact',
            "https://help.example.org/contact\r\nX-Foo: value",
            'https://help.example.org/../admin',
            ' https://help.example.org/contact',
            'https://help.example.org/secret/token',
        ] as $url) {
            self::assertFalse(SupportDestinationPolicy::validate($url)['valid'], $url);
        }
    }

    public function test_policy_does_not_construct_message_pii_or_recovery_key_query(): void
    {
        $r = SupportDestinationPolicy::validate('https://help.example.org/help/en');
        self::assertTrue($r['valid']);
        $json = json_encode($r, JSON_THROW_ON_ERROR);
        self::assertStringNotContainsString('recovery_key',$json);
        self::assertStringNotContainsString('message',$json);
        self::assertStringNotContainsString('media',$json);
    }
}
