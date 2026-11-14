<?php

declare(strict_types=1);

namespace App\Branding;

use InvalidArgumentException;

/**
 * Server-side brand metadata validation. Read-only and deliberately not
 * wired into routes, invoices, public cards or signed PWA activation.
 */
final readonly class ValidatedBrand
{
    /** @param array<string, string> $values */
    private function __construct(private array $values) {}

    public static function fromConfig(): self
    {
        $values = config('brand');
        if (!is_array($values)) {
            throw new InvalidArgumentException('Invalid brand configuration.');
        }
        return self::fromArray($values, in_array((string) config('app.env'), ['local', 'testing'], true));
    }

    /** @param array<string, mixed> $values */
    public static function fromArray(array $values, bool $allowLocalLoopback = false): self
    {
        $clean = [
            'name' => self::safeText($values['name'] ?? null, 'name', 200),
            'shortName' => self::safeText($values['short_name'] ?? null, 'short_name', 80),
            'slug' => self::safeText($values['slug'] ?? null, 'slug', 80),
            'mark' => self::safeText($values['mark'] ?? null, 'mark', 80),
            'publicUrl' => self::safeUrl($values['public_url'] ?? null, 'public_url', true, $allowLocalLoopback),
            'supportUrl' => self::safeUrl($values['support_url'] ?? '', 'support_url', false, $allowLocalLoopback),
            'legalName' => self::safeText($values['legal_name'] ?? '', 'legal_name', 240, true),
            'copyrightName' => self::safeText($values['copyright_name'] ?? '', 'copyright_name', 240, true),
            'themeColor' => self::safeText($values['theme_color'] ?? null, 'theme_color', 7),
        ];
        if (preg_match('/^[a-z0-9]+(?:-[a-z0-9]+)*$/D', $clean['slug']) !== 1) {
            throw new InvalidArgumentException('Invalid brand slug.');
        }
        if (preg_match('/^#[0-9a-fA-F]{6}$/D', $clean['themeColor']) !== 1) {
            throw new InvalidArgumentException('Invalid brand theme_color.');
        }
        // APP_PWA_ICONS belongs to signed asset verification, not this contract.
        return new self($clean);
    }

    /** @return array<string, string> */
    public function publicMetadata(): array
    {
        return $this->values;
    }

    private static function safeText(mixed $value, string $name, int $limit, bool $optional = false): string
    {
        if (!is_string($value)) {
            throw new InvalidArgumentException("Invalid brand {$name}.");
        }
        $value = trim($value);
        if ((!$optional && $value === '') || strlen($value) > $limit
            || preg_match('/[\x00-\x1F\x7F<>]/u', $value) !== 0) {
            throw new InvalidArgumentException("Invalid brand {$name}.");
        }
        return $value;
    }

    private static function safeUrl(mixed $input, string $name, bool $originOnly, bool $allowLocal): string
    {
        if (!is_string($input)) {
            throw new InvalidArgumentException("Invalid brand {$name}.");
        }
        if (!$originOnly && $input === '') {
            return '';
        }
        if ($input === '' || preg_match('/[\x00-\x20\x7f]/', $input) !== 0
            || filter_var($input, FILTER_VALIDATE_URL) === false) {
            throw new InvalidArgumentException("Invalid brand {$name}.");
        }
        $parts = parse_url($input);
        if (!is_array($parts) || !isset($parts['scheme'], $parts['host'])
            || array_key_exists('user', $parts) || array_key_exists('pass', $parts)
            || array_key_exists('query', $parts) || array_key_exists('fragment', $parts)) {
            throw new InvalidArgumentException("Invalid brand {$name}.");
        }

        $scheme = strtolower($parts['scheme']);
        $host = strtolower($parts['host']);
        $bareHost = trim($host, '[]');
        $loopback = in_array($bareHost, ['localhost', '127.0.0.1', '::1'], true);
        $privateIp = filter_var($bareHost, FILTER_VALIDATE_IP) !== false
            && filter_var($bareHost, FILTER_VALIDATE_IP, FILTER_FLAG_NO_PRIV_RANGE | FILTER_FLAG_NO_RES_RANGE) === false;

        if (!in_array($scheme, ['http', 'https'], true)
            || ($scheme === 'http' && !($allowLocal && $loopback))
            || (!$allowLocal && ($loopback || $privateIp))
            || ($privateIp && !$loopback)) {
            throw new InvalidArgumentException("Invalid brand {$name}.");
        }
        if ($originOnly && isset($parts['path']) && !in_array($parts['path'], ['', '/'], true)) {
            throw new InvalidArgumentException("Invalid brand {$name}: origin required.");
        }
        return $originOnly
            ? $scheme.'://'.$host.(isset($parts['port']) ? ':'.$parts['port'] : '')
            : $input;
    }
}
