<?php
declare(strict_types=1);

namespace App\Recovery;

/**
 * READ-ONLY candidate inspection, NOT a restoration capability or a backup verifier.
 *
 * All $trustedGeneration, $trustedAccountSpki and $currentAssets MUST be read
 * independently from authenticated server-side state, never from the submitted
 * manifest or an unauthenticated request. A caller must repeat authorization
 * and ciphertext hash verification immediately before any future restore write.
 *
 * This proposed v1 manifest contract must be reconciled with #218's eventual
 * verified backup producer. No S3, DB, key decryption, or write side effects.
 */
final class RestoreManifestPreflight
{
    private const PURPOSE = "pb3.backup-restore-manifest.v1\n";
    private const MAX_MANIFEST_BYTES = 2_000_000;
    private const MAX_FILES = 10_000;
    private const MAX_CIPHERTEXT_BYTES = 1_099_511_627_776; // 1 TiB per entry, never a billing right
    private const UUID = '/\A[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\z/D';
    private const SHA256 = '/\A[0-9a-f]{64}\z/D';

    /**
     * @param array<string,mixed> $trustedGeneration Independently authenticated:
     *     accountId,generationId,state,active,verifiedAt,manifestSha256.
     * @param array<string,array<string,mixed>> $currentAssets Independently
     *     authorized current ownership/retention/tombstone and digest state.
     * @return array{generationId:string,eligible:list<array<string,mixed>>,
     *               excluded:list<array{assetId:string,reason:string}>,ciphertextBytes:int}
     */
    public function inspect(
        string $manifestBytes,
        string $signatureP1363,
        string $trustedAccountSpki,
        array $trustedGeneration,
        array $currentAssets,
        string $requesterAccountId,
        int $now,
    ): array {
        if (!$this->uuid($requesterAccountId) || $now <= 0
            || $manifestBytes === '' || strlen($manifestBytes) > self::MAX_MANIFEST_BYTES) {
            $this->deny();
        }

        $this->exact($trustedGeneration, [
            'accountId', 'generationId', 'state', 'active', 'verifiedAt', 'manifestSha256',
        ]);
        if ($trustedGeneration['accountId'] !== $requesterAccountId
            || !$this->uuid($trustedGeneration['generationId'])
            || $trustedGeneration['state'] !== 'verified'
            || $trustedGeneration['active'] !== true
            || !is_int($trustedGeneration['verifiedAt'])
            || $trustedGeneration['verifiedAt'] <= 0
            || $trustedGeneration['verifiedAt'] > $now
            || !$this->sha($trustedGeneration['manifestSha256'])
            || !hash_equals($trustedGeneration['manifestSha256'], hash('sha256', $manifestBytes))) {
            $this->deny();
        }

        // Owner key must be pinned by trusted identity/account history. The
        // candidate is NOT allowed to self-declare its own verification key.
        $this->verifyOwnerSignature($trustedAccountSpki, $signatureP1363, $manifestBytes);

        try {
            $candidate = json_decode($manifestBytes, true, 16, JSON_THROW_ON_ERROR);
        } catch (\JsonException) {
            $this->deny();
        }
        if (!is_array($candidate) || array_is_list($candidate)) {
            $this->deny();
        }
        $this->exact($candidate, ['accountId','createdAt','files','generationId','version']);
        if ($candidate['version'] !== 1
            || $candidate['accountId'] !== $requesterAccountId
            || $candidate['generationId'] !== $trustedGeneration['generationId']
            || !is_int($candidate['createdAt'])
            || $candidate['createdAt'] <= 0 || $candidate['createdAt'] > $now
            || $candidate['createdAt'] > $trustedGeneration['verifiedAt']
            || !is_array($candidate['files'])
            || !array_is_list($candidate['files'])
            || count($candidate['files']) === 0
            || count($candidate['files']) > self::MAX_FILES) {
            $this->deny();
        }

        $eligible = [];
        $excluded = [];
        $total = 0;
        $lastId = '';
        foreach ($candidate['files'] as $item) {
            if (!is_array($item) || array_is_list($item)) {
                $this->deny();
            }
            $this->exact($item, [
                'assetId','ciphertextBytes','ciphertextSha256','envelopeSha256','expiresAt',
            ]);
            if (!$this->uuid($item['assetId']) || ($lastId !== '' && strcmp($lastId, $item['assetId']) >= 0)
                || !is_int($item['ciphertextBytes'])
                || $item['ciphertextBytes'] < 1
                || $item['ciphertextBytes'] > self::MAX_CIPHERTEXT_BYTES
                || !$this->sha($item['ciphertextSha256'])
                || !$this->sha($item['envelopeSha256'])
                || ($item['expiresAt'] !== null
                    && (!is_int($item['expiresAt']) || $item['expiresAt'] <= 0))) {
                $this->deny();
            }
            $lastId = $item['assetId'];

            $policy = $currentAssets[$lastId] ?? null;
            if ($policy === null) {
                $excluded[] = ['assetId'=>$lastId,'reason'=>'not_currently_authorized'];
                continue;
            }
            if (!is_array($policy) || array_is_list($policy)) {
                $this->deny();
            }
            $this->exact($policy, [
                'ownerAccountId','restorable','tombstoned','expiresAt',
                'ciphertextSha256','ciphertextBytes',
            ]);
            if (!$this->uuid($policy['ownerAccountId'])
                || !is_bool($policy['restorable']) || !is_bool($policy['tombstoned'])
                || ($policy['expiresAt'] !== null
                    && (!is_int($policy['expiresAt']) || $policy['expiresAt'] <= 0))
                || !$this->sha($policy['ciphertextSha256'])
                || !is_int($policy['ciphertextBytes'])
                || $policy['ciphertextBytes'] < 1
                || $policy['ciphertextBytes'] > self::MAX_CIPHERTEXT_BYTES) {
                $this->deny();
            }

            // An absent, foreign, revoked, tombstoned or expired live record
            // cannot be resurrected by an older, otherwise valid backup.
            if ($policy['ownerAccountId'] !== $requesterAccountId
                || $policy['restorable'] !== true
                || $policy['tombstoned'] === true) {
                $excluded[] = ['assetId'=>$lastId,'reason'=>'not_currently_authorized'];
                continue;
            }
            if (($item['expiresAt'] !== null && $item['expiresAt'] <= $now)
                || ($policy['expiresAt'] !== null && $policy['expiresAt'] <= $now)) {
                $excluded[] = ['assetId'=>$lastId,'reason'=>'expired'];
                continue;
            }
            // The trusted server must affirm the same immutable encrypted bytes
            // as the backup manifest; a reused asset ID is not sufficient.
            if (!hash_equals($policy['ciphertextSha256'], $item['ciphertextSha256'])
                || $policy['ciphertextBytes'] !== $item['ciphertextBytes']) {
                $excluded[] = ['assetId'=>$lastId,'reason'=>'ciphertext_version_changed'];
                continue;
            }
            if ($total > PHP_INT_MAX - $item['ciphertextBytes']) {
                $this->deny();
            }
            $total += $item['ciphertextBytes'];
            // Return digests and bounded lengths ONLY, not keys or plaintext.
            $eligible[] = $item;
        }

        // Canonical JSON is the signature contract. Duplicate keys, reordered
        // keys, formatting changes, float coercion or JSON extensions fail.
        // All nested object field names were explicitly validated above.
        if (json_encode($candidate, JSON_UNESCAPED_SLASHES | JSON_THROW_ON_ERROR) !== $manifestBytes) {
            $this->deny();
        }

        return [
            'generationId'=>$trustedGeneration['generationId'],
            'eligible'=>$eligible,
            'excluded'=>$excluded,
            'ciphertextBytes'=>$total,
        ];
    }

    private function verifyOwnerSignature(string $encodedSpki, string $encodedP1363, string $manifest): void
    {
        $spki = $this->decodeB64Url($encodedSpki, 70, 150);
        $raw = $this->decodeB64Url($encodedP1363, 64, 64);
        if ($spki === null || $raw === null) {
            $this->deny();
        }
        $pem = "-----BEGIN PUBLIC KEY-----\n"
            .chunk_split(base64_encode($spki),64,"\n")
            ."-----END PUBLIC KEY-----\n";
        $pub = openssl_pkey_get_public($pem);
        if ($pub === false) {
            $this->deny();
        }
        $details = openssl_pkey_get_details($pub);
        if (!is_array($details) || $details['type'] !== OPENSSL_KEYTYPE_EC
            || ($details['ec']['curve_name'] ?? '') !== 'prime256v1') {
            $this->deny();
        }

        $r = $this->asnInteger(substr($raw,0,32));
        $s = $this->asnInteger(substr($raw,32,32));
        $der = "\x30".chr(strlen($r.$s)).$r.$s;
        if (openssl_verify(self::PURPOSE.$manifest, $der, $pub, OPENSSL_ALGO_SHA256) !== 1) {
            $this->deny();
        }
    }

    private function asnInteger(string $bytes): string
    {
        $bytes = ltrim($bytes, "\x00");
        if ($bytes === '') $bytes = "\x00";
        if ((ord($bytes[0]) & 0x80) !== 0) $bytes = "\x00".$bytes;
        return "\x02".chr(strlen($bytes)).$bytes;
    }

    private function decodeB64Url(string $s, int $minimum, int $maximum): ?string
    {
        if ($s === '' || strlen($s) > 256 || preg_match('/\A[A-Za-z0-9_-]+\z/D',$s) !== 1) {
            return null;
        }
        $bytes = base64_decode(strtr($s,'-_','+/').str_repeat('=',(4-strlen($s)%4)%4),true);
        if (!is_string($bytes) || strlen($bytes) < $minimum || strlen($bytes) > $maximum
            || rtrim(strtr(base64_encode($bytes),'+/','-_'),'=') !== $s) {
            return null;
        }
        return $bytes;
    }

    /** @param list<string> $required */
    private function exact(array $value, array $required): void
    {
        $keys = array_keys($value);
        sort($keys, SORT_STRING);
        sort($required, SORT_STRING);
        if ($keys !== $required) $this->deny();
    }

    private function uuid(mixed $v): bool
    {
        return is_string($v) && preg_match(self::UUID, $v) === 1;
    }

    private function sha(mixed $v): bool
    {
        return is_string($v) && preg_match(self::SHA256, $v) === 1;
    }

    private function deny(): never
    {
        // Generic error: don't disclose candidate ownership, grant or existence.
        throw new \DomainException('recovery.restore_preflight_denied');
    }
}
