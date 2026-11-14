<?php
declare(strict_types=1);

namespace App\Support;

/**
 * Never contacts or sends data to the endpoint. Valid URL syntax does not
 * establish ownership, availability, a privacy agreement or safe delivery.
 */
final class SupportDestinationPolicy
{
    /** @return array{valid:bool,reason:string,url?:string} */
    public static function validate(?string $url): array
    {
        if ($url === null || trim($url) === '') {
            return self::reject('unconfigured');
        }
        if ($url !== trim($url) || strlen($url) > 2048
            || preg_match('/[\x00-\x20\x7f]/', $url) === 1
            || filter_var($url, FILTER_VALIDATE_URL) === false) {
            return self::reject('invalid_url');
        }
        $parts = parse_url($url);
        if (!is_array($parts) || strtolower($parts['scheme'] ?? '') !== 'https'
            || !isset($parts['host']) || isset($parts['user']) || isset($parts['pass'])
            || isset($parts['query']) || isset($parts['fragment'])) {
            return self::reject('unsafe_url');
        }
        $host = strtolower($parts['host']);
        if (filter_var($host, FILTER_VALIDATE_IP) !== false
            || preg_match('/\A(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}\z/D', $host) !== 1
            || preg_match('/\.(?:local|localhost|internal|test|invalid|onion)\z/i', $host) === 1
            || (isset($parts['port']) && $parts['port'] !== 443)) {
            return self::reject('unsafe_host');
        }
        $path = $parts['path'] ?? '';
        if (strlen($path) > 512 || preg_match('#\A(?:/[a-zA-Z0-9._~-]+)*/?\z#D', $path) !== 1
            || str_contains($path, '..')
            || preg_match('#/(?:recovery[_-]?key|private[_-]?key|secret|seed|token)(?:/|$)#i', $path) === 1) {
            return self::reject('unsafe_path');
        }
        return ['valid'=>true,'reason'=>'syntactic_https_only','url'=>$url];
    }

    /** @return array{valid:false,reason:string} */
    private static function reject(string $reason): array
    {
        return ['valid'=>false,'reason'=>$reason];
    }
}
