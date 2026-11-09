<?php
declare(strict_types=1);

namespace App\Storage;

use Illuminate\Support\Facades\Storage;

/** Only this provider adapter talks to the physical S3-compatible disk. */
final class AppS3Adapter implements StorageAdapter
{
    private function disk(): \Illuminate\Filesystem\FilesystemAdapter
    {
        return Storage::disk('ciphertext');
    }

    public function putStream(string $objectKey, mixed $stream): bool
    {
        if (!is_resource($stream)) throw new \InvalidArgumentException('Ciphertext stream required');
        return $this->disk()->put($objectKey, $stream) !== false;
    }

    public function readStream(string $objectKey): mixed
    {
        return $this->disk()->readStream($objectKey);
    }

    public function exists(string $objectKey): bool
    {
        return $this->disk()->exists($objectKey);
    }

    public function size(string $objectKey): int
    {
        return $this->disk()->size($objectKey);
    }

    public function delete(string $objectKey): bool
    {
        return $this->disk()->delete($objectKey);
    }
}
