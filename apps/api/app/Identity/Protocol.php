<?php
declare(strict_types=1);

namespace App\Identity;

use Illuminate\Support\Str;

/**
 * Protocol v2: only exact ASCII, fixed-field inputs; signatures from WebCrypto
 * are IEEE P1363 r||s and must be converted to DER for OpenSSL verification.
 */
final class Protocol
{
    public static function b64(string $input, ?int $length = null): string
    {
        abort_unless(preg_match('/^[A-Za-z0-9_-]+$/D', $input) === 1 && strlen($input) <= 8192, 422);
        $bytes = base64_decode(strtr($input, '-_', '+/').str_repeat('=', (4 - strlen($input) % 4) % 4), true);
        abort_unless($bytes !== false && self::encode($bytes) === $input, 422);
        if ($length !== null) abort_unless(strlen($bytes) === $length, 422);
        return $bytes;
    }

    public static function encode(string $bytes): string
    {
        return rtrim(strtr(base64_encode($bytes), '+/', '-_'), '=');
    }

    public static function uuid(string $input): string
    {
        abort_unless(Str::isUuid($input) && strtolower($input) === $input, 422);
        return $input;
    }

    public static function spki(string $encoded): string
    {
        $der = self::b64($encoded);
        abort_unless(strlen($der) >= 70 && strlen($der) <= 150, 422);
        $pem = "-----BEGIN PUBLIC KEY-----\n".chunk_split(base64_encode($der), 64, "\n")."-----END PUBLIC KEY-----\n";
        $pub = openssl_pkey_get_public($pem);
        abort_unless($pub !== false, 422);
        $details = openssl_pkey_get_details($pub);
        abort_unless($details !== false && $details['type'] === OPENSSL_KEYTYPE_EC
            && ($details['ec']['curve_name'] ?? '') === 'prime256v1'
            && self::encode(base64_decode(preg_replace('/-----[^-]+-----|\s+/', '', $details['key']))) === $encoded, 422);
        return $pem;
    }

    public static function exact(array $object, array $keys): array
    {
        $actual = array_keys($object); sort($actual, SORT_STRING);
        sort($keys, SORT_STRING);
        abort_unless($actual === $keys, 422);
        return $object;
    }

    public static function canonical(array $payload): string
    {
        ksort($payload, SORT_STRING);
        foreach ($payload as $key => $value) {
            abort_unless(is_string($key) && is_string($value) && preg_match('/^[\x21-\x7e]*$/D', $value) === 1, 422);
        }
        return json_encode($payload, JSON_UNESCAPED_SLASHES | JSON_THROW_ON_ERROR);
    }

    public static function fields(string $purpose): array
    {
        return match ($purpose) {
            'register' => ['accountId','accountSpki','deviceId','deviceSpki','envelopeHash','locator','operationId','purpose'],
            'login' => ['accountId','deviceId','purpose'],
            'recover' => ['accountId','deviceId','deviceSpki','purpose','revision'],
            'pair-enroll' => ['accountId','deviceId','deviceSpki','pairingId','purpose','revision'],
            'rotate' => ['accountId','deviceId','envelopeHash','expectedRevision','locator','operationId','purpose'],
            default => abort(422),
        };
    }

    public static function payload(string $purpose, array $payload): string
    {
        self::exact($payload, self::fields($purpose));
        abort_unless(($payload['purpose'] ?? null) === $purpose, 422);
        foreach ($payload as $field => $value) {
            abort_unless(is_string($value) && strlen($value) <= 512, 422);
            if (str_ends_with($field,'Id') || $field === 'operationId' || $field === 'pairingId') self::uuid($value);
            if (str_ends_with($field,'Spki')) self::spki($value);
            if ($field === 'locator') self::b64($value,16);
            if ($field === 'envelopeHash') abort_unless(preg_match('/^[a-f0-9]{64}$/D',$value) === 1,422);
            if (in_array($field,['revision','expectedRevision'],true)) abort_unless(preg_match('/^[1-9][0-9]{0,8}$/D',$value) === 1,422);
        }
        return self::canonical($payload);
    }

    public static function challengeMessage(object $row): string
    {
        return "photobunker.identity.v2\n".$row->purpose."\n".$row->id."\n".$row->nonce
            ."\n".\Carbon\Carbon::parse($row->expires_at)->utc()->format('Y-m-d\TH:i:s.v\Z')
            ."\n".$row->digest;
    }

    private static function integer(string $raw): string
    {
        $raw = ltrim($raw, "\x00");
        if ($raw === '') $raw = "\x00";
        if (ord($raw[0]) & 0x80) $raw = "\x00".$raw;
        return "\x02".chr(strlen($raw)).$raw;
    }

    public static function verify(string $publicSpki, string $message, string $p1363): bool
    {
        $raw = self::b64($p1363,64);
        $r = self::integer(substr($raw,0,32));
        $s = self::integer(substr($raw,32,32));
        $payload = $r.$s;
        $der = "\x30".chr(strlen($payload)).$payload;
        return openssl_verify($message,$der,self::spki($publicSpki),OPENSSL_ALGO_SHA256) === 1;
    }

    public static function envelope(array $e, string $accountId, string $locator, string $purpose, int $revision): string
    {
        self::exact($e, ['v','alg','accountId','locator','keyId','purpose','revision','iv','ciphertext']);
        abort_unless($e['v'] === 2 && $e['alg'] === 'A256GCM' && $e['accountId'] === $accountId
          && $e['locator'] === $locator && $e['purpose'] === $purpose
          && $e['revision'] === $revision && preg_match('/^[A-Za-z0-9_-]{16,60}$/D',$e['keyId']) === 1, 422);
        self::b64($e['iv'],12);
        abort_unless(is_string($e['ciphertext']) && strlen($e['ciphertext']) <= 16384, 422);
        self::b64($e['ciphertext']);
        ksort($e,SORT_STRING);
        return json_encode($e, JSON_UNESCAPED_SLASHES | JSON_THROW_ON_ERROR);
    }
}
