<?php
declare(strict_types=1);

namespace Tests\Feature\StorageContracts;

use App\Storage\StorageAdapter;
use RuntimeException;

/**
 * In-memory fault-injection adapter. Never contacts S3 or uses real media.
 * This fake is for contract tests, NOT a production-ready S3 implementation.
 */
final class ContractAdapter implements StorageAdapter
{
    /** @var array<string,string> */
    public array $objects = [];
    public bool $rejectPut = false;
    public bool $rejectDelete = false;
    public bool $reportDeletedObjectStillPresent = false;
    public bool $corruptReads = false;
    public bool $throwOnRead = false;
    public int $putCalls = 0;
    public int $deleteCalls = 0;

    public function putStream(string $objectKey, mixed $stream): bool
    {
        $this->putCalls++;
        if ($this->rejectPut || !is_resource($stream)) {
            return false;
        }
        $data = stream_get_contents($stream);
        if (!is_string($data)) {
            return false;
        }
        $this->objects[$objectKey] = $data;
        return true;
    }

    public function readStream(string $objectKey): mixed
    {
        if ($this->throwOnRead) {
            throw new RuntimeException('test.injected_read_outage');
        }
        if (!isset($this->objects[$objectKey])) {
            return false;
        }
        $data = $this->objects[$objectKey];
        if ($this->corruptReads && $data !== '') {
            $data[0] = chr(ord($data[0]) ^ 1);
        }
        $stream = fopen('php://temp', 'w+b');
        if ($stream === false) {
            throw new RuntimeException('test.fixture_stream_unavailable');
        }
        fwrite($stream, $data);
        rewind($stream);
        return $stream;
    }

    public function exists(string $objectKey): bool
    {
        return $this->reportDeletedObjectStillPresent
            || array_key_exists($objectKey, $this->objects);
    }

    public function size(string $objectKey): int
    {
        if (!isset($this->objects[$objectKey])) {
            throw new RuntimeException('test.missing_object');
        }
        return strlen($this->objects[$objectKey]);
    }

    public function delete(string $objectKey): bool
    {
        $this->deleteCalls++;
        if ($this->rejectDelete) {
            return false;
        }
        unset($this->objects[$objectKey]);
        return true;
    }
}
