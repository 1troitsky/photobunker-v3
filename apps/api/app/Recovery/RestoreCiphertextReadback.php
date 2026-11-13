<?php
declare(strict_types=1);

namespace App\Recovery;

/**
 * Pure read-only ciphertext AND wrapped-key-envelope byte verification.
 *
 * This is NOT a grant, snapshot receipt, proof of E2EE decryption, or restore.
 * Only pass the authenticated eligible entry returned by a fresh
 * RestoreManifestPreflight::inspect() inside trusted server execution.
 *
 * The caller provides TWO fresh readable streams positioned at byte zero.
 * This class does not open S3/HTTP connections, write files or close streams.
 * The caller owns cleanup, network timeouts, retry and backpressure.
 */
final class RestoreCiphertextReadback
{
    private const MAX_CIPHERTEXT_BYTES = 1_099_511_627_776; // bounded independent of plan
    private const MAX_ENVELOPE_BYTES = 65_536; // proposed encrypted envelope ceiling
    private const CHUNK_BYTES = 65_536;
    private const SHA256 = '/\A[a-f0-9]{64}\z/D';
    private const UUID = '/\A[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\z/D';

    /**
     * @param array<string,mixed> $signedEntry The exact eligible entry
     *                                         from trusted preflight.
     * @param mixed $ciphertextStream Open readable binary stream at offset 0.
     * @param mixed $envelopeStream Open readable envelope stream at offset 0.
     */
    public function verify(
        array $signedEntry,
        mixed $ciphertextStream,
        mixed $envelopeStream,
    ): void {
        $keys = array_keys($signedEntry);
        sort($keys,SORT_STRING);
        if ($keys !== [
            'assetId','ciphertextBytes','ciphertextSha256','envelopeSha256','expiresAt',
        ] || !is_string($signedEntry['assetId'])
          || preg_match(self::UUID,$signedEntry['assetId']) !== 1
          || !is_int($signedEntry['ciphertextBytes'])
          || $signedEntry['ciphertextBytes'] < 1
          || $signedEntry['ciphertextBytes'] > self::MAX_CIPHERTEXT_BYTES
          || !is_string($signedEntry['ciphertextSha256'])
          || preg_match(self::SHA256,$signedEntry['ciphertextSha256']) !== 1
          || !is_string($signedEntry['envelopeSha256'])
          || preg_match(self::SHA256,$signedEntry['envelopeSha256']) !== 1
          || ($signedEntry['expiresAt'] !== null
            && (!is_int($signedEntry['expiresAt']) || $signedEntry['expiresAt'] <= 0))) {
            $this->deny();
        }

        // Hash actual *encrypted* bytes, not an object-store-provided ETag or
        // a hash returned from untrusted metadata. A second independent
        // envelope readback is compulsory: valid ciphertext alone is not enough.
        $this->verifyStream(
            $ciphertextStream,
            $signedEntry['ciphertextSha256'],
            $signedEntry['ciphertextBytes'],
            self::MAX_CIPHERTEXT_BYTES,
        );
        $this->verifyStream(
            $envelopeStream,
            $signedEntry['envelopeSha256'],
            null,
            self::MAX_ENVELOPE_BYTES,
        );
    }

    private function verifyStream(
        mixed $stream,
        string $expectedHash,
        ?int $expectedBytes,
        int $maximumBytes,
    ): void {
        if (!is_resource($stream) || get_resource_type($stream) !== 'stream') {
            $this->deny();
        }
        $context = hash_init('sha256');
        $readBytes = 0;
        while (true) {
            // +1 deliberately probes for trailing bytes after an exact-length
            // payload. Always hard cap the number of bytes accepted.
            $limit = min(self::CHUNK_BYTES, $maximumBytes - $readBytes + 1);
            if ($expectedBytes !== null) {
                $limit = min($limit, $expectedBytes - $readBytes + 1);
            }
            if ($limit < 1) {
                $this->deny();
            }
            try {
                $bytes = @fread($stream,$limit);
            } catch (\Throwable) {
                $this->deny();
            }
            if ($bytes === false || !is_string($bytes)) {
                $this->deny();
            }
            if ($bytes === '') {
                // A nonblocking short read with !EOF cannot be silently
                // treated as a complete verified stream.
                if (!feof($stream)) {
                    $this->deny();
                }
                break;
            }
            $length = strlen($bytes);
            $readBytes += $length;
            if ($readBytes > $maximumBytes
                || ($expectedBytes !== null && $readBytes > $expectedBytes)) {
                $this->deny();
            }
            hash_update($context,$bytes);
        }

        if ($readBytes < 1
            || ($expectedBytes !== null && $readBytes !== $expectedBytes)
            || !hash_equals($expectedHash,hash_final($context))) {
            $this->deny();
        }
    }

    private function deny(): never
    {
        // No file-existence, account or crypto-oracle details in error.
        throw new \DomainException('recovery.readback_integrity_denied');
    }
}
