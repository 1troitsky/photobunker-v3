<?php
declare(strict_types=1);

namespace App\Media;

use App\Identity\Protocol as P;
use App\Photo\PhotoSync;

/** Signed upload envelope. Only media type/lengths and ciphertext hashes
 * are observable; filename, MIME and user text are AEAD-encrypted metadata. */
final class MediaContract
{
    public const CHUNK_BYTES=1048576; // bounded, restartable upload unit
    public const MAX_PLAIN_BYTES=134217728; // P1 Free/bootstrap 128 MiB per file
    public const MAX_CHUNKS=128;

    public static function verify(string $json,string $signature,
        string $deviceSpki,string $accountId):array
    {
        abort_unless(strlen($json)>=80&&strlen($json)<=80000,422);
        try{$c=json_decode($json,true,64,JSON_THROW_ON_ERROR);}
        catch(\Throwable){abort(422);}
        abort_unless(is_array($c)&&!array_is_list($c),422);
        P::exact($c,['version','accountId','mediaId','operationId','mediaType',
            'expiresAt','chunkBytes','plainBytes','wrappedDEK','chunks']);
        P::uuid($c['accountId']);P::uuid($c['mediaId']);P::uuid($c['operationId']);
        abort_unless($c['version']===1
            &&$c['accountId']===$accountId
            &&is_string($c['mediaType'])
            &&in_array($c['mediaType'],['photo','video','audio'],true)
            &&$c['chunkBytes']===self::CHUNK_BYTES
            &&is_int($c['plainBytes'])&&$c['plainBytes']>=128
            &&$c['plainBytes']<=self::MAX_PLAIN_BYTES
            &&is_int($c['expiresAt'])
            &&$c['expiresAt']>PhotoSync::nowMs()
            &&$c['expiresAt']<=PhotoSync::nowMs()
                +(int)config('photo_sync.bootstrap_free_retention_days',14)*86400000,422);
        $w=$c['wrappedDEK'];
        abort_unless(is_array($w)&&!array_is_list($w),422);
        P::exact($w,['iv','ciphertext']);
        abort_unless(is_string($w['iv'])&&is_string($w['ciphertext']),422);
        P::b64($w['iv'],12);
        P::b64($w['ciphertext'],48); // wrapped independent 32-byte DEK + GCM tag

        $count=(int)ceil($c['plainBytes']/self::CHUNK_BYTES);
        abort_unless($count>=1&&$count<=self::MAX_CHUNKS
            &&is_array($c['chunks'])&&array_is_list($c['chunks'])
            &&count($c['chunks'])===$count+1,422);
        $total=0;$seen=[];
        foreach($c['chunks'] as $i=>$chunk){
            abort_unless(is_array($chunk)&&!array_is_list($chunk),422);
            P::exact($chunk,['chunkId','index','kind','plainBytes','bytes','sha256','iv']);
            abort_unless(is_string($chunk['chunkId']),422);
            P::uuid($chunk['chunkId']);
            abort_unless(!isset($seen[$chunk['chunkId']]),422);
            $seen[$chunk['chunkId']]=true;
            $metadata=$i===$count;
            $expected=$metadata?null:min(self::CHUNK_BYTES,
                $c['plainBytes']-$i*self::CHUNK_BYTES);
            abort_unless($chunk['index']===$i
                &&$chunk['kind']===($metadata?'metadata':'data')
                &&is_int($chunk['plainBytes'])
                &&($metadata
                    ?($chunk['plainBytes']>=2 && $chunk['plainBytes']<=8192)
                    :$chunk['plainBytes']===$expected)
                &&is_int($chunk['bytes'])
                &&$chunk['bytes']===$chunk['plainBytes']+16
                &&is_string($chunk['sha256'])
                &&preg_match('/^[a-f0-9]{64}$/D',$chunk['sha256'])===1
                &&is_string($chunk['iv']),422);
            P::b64($chunk['iv'],12);
            $total+=$chunk['bytes'];
        }
        abort_unless(json_encode($c,JSON_UNESCAPED_SLASHES|JSON_THROW_ON_ERROR)===$json,422);
        abort_unless(P::verify($deviceSpki,"pb3.media.v1\n".$json,$signature),401);
        $c['totalCipherBytes']=$total;
        return $c;
    }
}
