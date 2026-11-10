<?php
declare(strict_types=1);

namespace App\Storage;

/**
 * Physical transport only. Never receives Recovery Keys, plaintext media or
 * authorization decisions. Additional S3 providers implement this interface.
 */
interface StorageAdapter
{
    public function putStream(string $objectKey, mixed $stream): bool;
    public function readStream(string $objectKey): mixed;
    public function exists(string $objectKey): bool;
    public function size(string $objectKey): int;
    public function delete(string $objectKey): bool;
}
