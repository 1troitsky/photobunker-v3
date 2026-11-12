<?php
declare(strict_types=1);

namespace App\Storage;

/**
 * Destructive GC must never trust a stored object-key array as authority.
 *
 * Tombstone keys come from the server-side registered placements, not users;
 * even a damaged/legacy DB row must fail closed rather than deleting another
 * account's ciphertext. Validate the WHOLE set before the first physical IO.
 *
 * This is a strict initial app_s3 path check. Future BYO/replica placement
 * adapters need an explicitly reviewed provider-aware extension.
 */
final class TombstoneKeyScope
{
    public static function check(
        string $kind,string $accountId,string $parentId,array $keys,
    ):void {
        if(!in_array($kind,['photo','media'],true)
            ||!self::uuid($accountId)||!self::uuid($parentId)
            ||count($keys)>512) {
            throw new \RuntimeException('storage.invalid_tombstone_scope');
        }
        $prefix=($kind==='media'?'cipher/media/v1/':'cipher/v1/')
            .$accountId.'/'.$parentId.'/';
        $seen=[];
        foreach($keys as $key){
            if(!is_string($key)||!str_starts_with($key,$prefix)
                ||!self::uuid(substr($key,strlen($prefix)))
                ||isset($seen[$key])) {
                throw new \RuntimeException('storage.invalid_tombstone_scope');
            }
            $seen[$key]=true;
        }
    }

    public static function decode(
        string $kind,string $accountId,string $parentId,mixed $raw,
    ):array {
        if(!is_string($raw)||strlen($raw)>128*1024)
            throw new \RuntimeException('storage.invalid_tombstone_scope');
        try{$keys=json_decode($raw,true,16,JSON_THROW_ON_ERROR);}
        catch(\Throwable){throw new \RuntimeException('storage.invalid_tombstone_scope');}
        if(!is_array($keys)||!array_is_list($keys))
            throw new \RuntimeException('storage.invalid_tombstone_scope');
        self::check($kind,$accountId,$parentId,$keys);
        return $keys;
    }

    private static function uuid(string $value):bool
    {
        return preg_match(
            '/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/D',
            $value,
        )===1;
    }
}
