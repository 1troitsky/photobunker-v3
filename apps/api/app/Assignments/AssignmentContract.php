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
     * Amendments retain the immutable root. v1 is photo-goal only;
     * v2 adds photo capture requirements; v3 explicitly opts into video
     * and/or audio; v4 adds independent, optional video/audio progress goals; v5 adds
     * per-kind public requirement flags (never actual private fields);
     * v6 adds PUBLIC allowed-category vocabulary and required tag vocabulary.
     * Never broaden older photo-only signed policy implicitly.
     */
    public static function policyAmendment(array $d,string $owner,string $assignment):void
    {
        abort_unless(in_array($d['version'],[1,2,3,4,5,6],true)
            &&$d['assignmentId']===$assignment
            &&$d['ownerAccountId']===$owner
            &&is_int($d['fromPolicyRevision'])
            &&$d['fromPolicyRevision']>=1&&$d['fromPolicyRevision']<1001
            &&$d['toPolicyRevision']===$d['fromPolicyRevision']+1
            &&self::allowedMedia($d['allowedMedia'],$d['version']>=3),422);
        foreach(['assignmentId','ownerAccountId','operationId'] as $key)
            self::uuid($d,$key);
        foreach(['rootPolicyHash','previousPolicyHash'] as $key){
            abort_unless(is_string($d[$key])
                &&preg_match('/^[a-f0-9]{64}$/D',$d[$key])===1,422);
        }
        abort_unless($d['photoGoal']===null
            ||(is_int($d['photoGoal'])&&$d['photoGoal']>=1
                &&$d['photoGoal']<=9999),422);
        if($d['version']>=2){
            // These are PUBLIC booleans and a length threshold, not
            // plaintext GPS, private description or actual category.
            abort_unless(is_bool($d['requiredCategory'])
                &&is_bool($d['requiredGps'])
                &&is_int($d['descriptionMinLength'])
                &&$d['descriptionMinLength']>=0
                &&$d['descriptionMinLength']<=4000,422);
        }
        if($d['version']>=4){
            // Target counts are progress indicators, never upload ceilings.
            // Earlier signed policy versions intentionally have no goals
            // for video/audio and must not acquire them implicitly.
            foreach(['video'=>'videoGoal','audio'=>'audioGoal'] as $kind=>$field){
                $goal=$d[$field];
                abort_unless($goal===null ||
                    (in_array($kind,$d['allowedMedia'],true)
                        &&is_int($goal)&&$goal>=1&&$goal<=999),422);
            }
        }
        if($d['version']>=5){
            foreach(['video'=>'videoRequirements','audio'=>'audioRequirements'] as $kind=>$field){
                $rules=$d[$field]??null;
                abort_unless(is_array($rules)
                    &&array_keys($rules)===['requiredCategory','descriptionMinLength','requiredGps']
                    &&is_bool($rules['requiredCategory'])
                    &&is_int($rules['descriptionMinLength'])
                    &&$rules['descriptionMinLength']>=0
                    &&$rules['descriptionMinLength']<=4000
                    &&is_bool($rules['requiredGps']),422);
                // Disabled kinds cannot retain misleading "mandatory" flags.
                if(!in_array($kind,$d['allowedMedia'],true)){
                    abort_unless($rules===[
                        'requiredCategory'=>false,'descriptionMinLength'=>0,
                        'requiredGps'=>false,
                    ],422);
                }
            }
        }
        if($d['version']===6){
            $empty=['allowedCategories'=>[],'requiredTags'=>[]];
            foreach(['photo'=>'photoAdvanced','video'=>'videoAdvanced',
                'audio'=>'audioAdvanced'] as $kind=>$field){
                $v=$d[$field]??null;
                abort_unless(is_array($v)&&!array_is_list($v)
                    &&array_keys($v)===['allowedCategories','requiredTags'],422);
                foreach(['allowedCategories'=>16,'requiredTags'=>12] as $name=>$limit){
                    $items=$v[$name];
                    abort_unless(is_array($items)&&array_is_list($items)
                        &&count($items)<=$limit,422);
                    $seen=[];
                    foreach($items as $label){
                        $max=$name==='allowedCategories'?64:48;
                        abort_unless(is_string($label)&&strlen($label)>0
                            &&strlen($label)<=$max
                            &&trim($label)===$label
                            &&preg_match('//u',$label)===1
                            &&preg_match('/[\\x00-\\x1f\\x7f,]/',$label)===0
                            &&!isset($seen[$label]),422);
                        $seen[$label]=true;
                    }
                }
                if(!in_array($kind,$d['allowedMedia'],true)){
                    abort_unless($v===$empty,422);
                }
            }
        }
    }

    /**
     * Current original policy is photo-only. Owner-signed v3 amendments may
     * enable video/audio with a stable canonical order; the platform must
     * not infer permission from an accepted invitation alone.
     */
    public static function allowedMedia(mixed $value,bool $extended):bool
    {
        if(!is_array($value)||!array_is_list($value))return false;
        if(!$extended)return $value===['photo'];
        return in_array($value,[
            ['photo'],['photo','video'],['photo','audio'],
            ['photo','video','audio'],
        ],true);
    }

    public static function mediaSubmission(array $d,string $contributor,
        string $assignment):void
    {
        abort_unless(in_array($d['version'],[1,2],true)
            &&in_array($d['kind'],['video','audio'],true)
            &&$d['assignmentId']===$assignment
            &&$d['contributorAccountId']===$contributor
            &&is_int($d['policyRevision'])
            &&$d['policyRevision']>=2&&$d['policyRevision']<=1001,422);
        foreach(['submissionId','operationId','assignmentId',
            'contributorAccountId','mediaId','mediaGrantId'] as $field)
            self::uuid($d,$field);
        foreach(['policyHash','mediaContractHash'] as $field)
            abort_unless(is_string($d[$field])
                &&preg_match('/^[a-f0-9]{64}$/D',$d[$field])===1,422);
    }

    /**
     * Recording context is signed by the contributor's ACCOUNT before
     * durable ciphertext upload. The clock remains client-declared; it
     * does NOT attest real time, hardware origin or location.
     */
    public static function mediaCapture(array $d,string $account,
        string $assignment):void
    {
        abort_unless(($d['version']??null)===1
            &&($d['contributorAccountId']??null)===$account
            &&($d['assignmentId']??null)===$assignment
            &&in_array($d['mediaType']??null,['video','audio'],true)
            &&is_int($d['policyRevision']??null)
            &&$d['policyRevision']>=2&&$d['policyRevision']<=1001,422);
        foreach(['assignmentId','ownerAccountId','contributorAccountId',
            'mediaId'] as $key)self::uuid($d,$key);
        foreach(['policyHash','mediaContractHash'] as $key)
            abort_unless(is_string($d[$key])
                &&preg_match('/^[a-f0-9]{64}$/D',$d[$key])===1,422);
        $start=self::millis($d['startedAt']);
        $end=self::millis($d['finishedAt']);
        abort_unless($end>$start &&$end-$start<=3*60000
            &&$end<=PhotoSync::nowMs()+120000,422);
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
