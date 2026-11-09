<?php
declare(strict_types=1);

namespace App\Assignments;

use App\Identity\Protocol as P;
use App\Photo\PhotoSync;

/**
 * Strict, signed, versioned transport contracts. Private assignment content
 * remains opaque AEAD ciphertext; server validates only public policy ceilings.
 */
final class AssignmentContract
{
    public static function signed(string $raw,string $sig,string $spki,string $domain,array $keys,int $max=30000):array
    {
        abort_unless(strlen($raw)>=64&&strlen($raw)<=$max,422);
        try{$data=json_decode($raw,true,32,JSON_THROW_ON_ERROR);}catch(\Throwable){abort(422);}
        abort_unless(is_array($data)&&!array_is_list($data),422);
        P::exact($data,$keys);
        abort_unless(json_encode($data,JSON_UNESCAPED_SLASHES|JSON_THROW_ON_ERROR)===$raw,422);
        abort_unless(P::verify($spki,$domain."\n".$raw,$sig),401);
        return $data;
    }

    public static function uuid(array $data,string $key):string
    {
        abort_unless(is_string($data[$key]??null),422);
        return P::uuid($data[$key]);
    }

    public static function millis(mixed $value):int
    {
        abort_unless(is_int($value)&&$value>1_500_000_000_000
          &&$value<10_000_000_000_000,422);
        return $value;
    }

    public static function envelope(array $value):string
    {
        P::exact($value,['version','iv','ciphertext','wrappedKey']);
        abort_unless($value['version']===1 &&is_array($value['wrappedKey']),422);
        P::exact($value['wrappedKey'],['iv','ciphertext']);
        P::b64($value['iv'],12);
        P::b64($value['wrappedKey']['iv'],12);
        P::b64($value['wrappedKey']['ciphertext']);
        abort_unless(is_string($value['ciphertext'])
          &&preg_match('/^[A-Za-z0-9_-]{22,32768}$/D',$value['ciphertext'])===1,422);
        $raw=base64_decode(strtr($value['ciphertext'],'-_','+/').
          str_repeat('=',(4-strlen($value['ciphertext'])%4)%4),true);
        abort_unless($raw!==false&&strlen($raw)>=16&&strlen($raw)<=24000
          &&P::encode($raw)===$value['ciphertext'],422);
        return json_encode($value,JSON_UNESCAPED_SLASHES|JSON_THROW_ON_ERROR);
    }

    public static function creation(array $data,string $owner):void
    {
        abort_unless($data['version']===1&&$data['revision']===1
          &&$data['policyRevision']===1&&$data['state']==='active'
          &&$data['ownerAccountId']===$owner
          &&$data['allowedMedia']===['photo'],422);
        foreach(['assignmentId','operationId','ownerAccountId'] as $name)self::uuid($data,$name);
        $start=self::millis($data['startsAt']);
        abort_unless($start<=PhotoSync::nowMs()+120000
          &&$start>=PhotoSync::nowMs()-24*3600000,422);
        if($data['endsAt']!==null){
            $end=self::millis($data['endsAt']);
            abort_unless($end>$start,422);
        }
        abort_unless($data['photoGoal']===null ||
          (is_int($data['photoGoal'])&&$data['photoGoal']>=1&&$data['photoGoal']<=9999),422);
        abort_unless(is_array($data['privateEnvelope']),422);
        self::envelope($data['privateEnvelope']);
    }

    /**
     * A signed policy amendment changes only the public photo target.
     * Capture requirements, dates, E2EE envelope and root policy stay fixed.
     */
    public static function policyAmendment(array $d,string $owner,string $assignment):void
    {
        abort_unless($d['version']===1
            &&$d['assignmentId']===$assignment
            &&$d['ownerAccountId']===$owner
            &&is_int($d['fromPolicyRevision'])
            &&$d['fromPolicyRevision']>=1&&$d['fromPolicyRevision']<1000000
            &&$d['toPolicyRevision']===$d['fromPolicyRevision']+1
            &&$d['allowedMedia']===['photo'],422);
        foreach(['assignmentId','ownerAccountId','operationId'] as $key)
            self::uuid($d,$key);
        foreach(['rootPolicyHash','previousPolicyHash'] as $key){
            abort_unless(is_string($d[$key])
                &&preg_match('/^[a-f0-9]{64}$/D',$d[$key])===1,422);
        }
        abort_unless($d['photoGoal']===null
            ||(is_int($d['photoGoal'])&&$d['photoGoal']>=1
                &&$d['photoGoal']<=9999),422);
    }

    public static function invite(array $d,string $owner,string $assignment):void
    {
        abort_unless($d['version']===1&&$d['ownerAccountId']===$owner
          &&$d['assignmentId']===$assignment&&$d['role']==='contributor',422);
        foreach(['inviteId','assignmentId','ownerAccountId','recipientAccountId'] as $key)
            self::uuid($d,$key);
        abort_unless($owner!==$d['recipientAccountId'],422);
        $expiry=self::millis($d['expiresAt']);
        abort_unless($expiry>PhotoSync::nowMs()
          &&$expiry<=PhotoSync::nowMs()+7*86400000,422);
        abort_unless(is_string($d['recipientKeyDigest'])
          &&preg_match('/^[a-f0-9]{64}$/D',$d['recipientKeyDigest'])===1,422);
        abort_unless(is_array($d['envelope']),422);
        P::exact($d['envelope'],['ephemeralSpki','salt','iv','ciphertext']);
        P::spki($d['envelope']['ephemeralSpki']);
        P::b64($d['envelope']['salt'],16);P::b64($d['envelope']['iv'],12);
        P::b64($d['envelope']['ciphertext'],48);
    }

    public static function acceptance(array $d,string $recipient,string $assignment,string $invite):void
    {
        abort_unless($d['version']===1&&$d['action']==='accept'
          &&$d['assignmentId']===$assignment&&$d['inviteId']===$invite
          &&$d['recipientAccountId']===$recipient,422);
        foreach(['assignmentId','inviteId','operationId','recipientAccountId'] as $key)
            self::uuid($d,$key);
    }

    /**
     * Only a tiny signed lifecycle vertical: finish/resume. Never delete
     * contributor-owned photos or mutate the original signed capture policy.
     */
    public static function stateChange(array $d,string $owner,string $assignment):void
    {
        abort_unless($d['version']===1
            &&$d['assignmentId']===$assignment
            &&$d['ownerAccountId']===$owner
            &&$d['policyRevision']===1
            &&is_int($d['fromRevision'])&&$d['fromRevision']>=1
            &&$d['fromRevision']<1000000
            &&$d['toRevision']===$d['fromRevision']+1,422);
        foreach(['assignmentId','ownerAccountId','operationId'] as $key)
            self::uuid($d,$key);
        abort_unless(is_string($d['policyHash'])
            &&preg_match('/^[a-f0-9]{64}$/D',$d['policyHash'])===1,422);
        abort_unless(($d['action']==='finish'&&$d['state']==='finished')
            ||($d['action']==='resume'&&$d['state']==='active'),422);
    }

    public static function submission(array $d,string $contributor,string $assignment):void
    {
        abort_unless($d['version']===1&&$d['kind']==='photo'
          &&$d['assignmentId']===$assignment&&$d['contributorAccountId']===$contributor
          &&is_int($d['policyRevision'])
          &&$d['policyRevision']>=1&&$d['policyRevision']<=1000000,422);
        foreach(['submissionId','assignmentId','contributorAccountId','photoId',
                 'photoGrantId','operationId'] as $key)self::uuid($d,$key);
    }
}
