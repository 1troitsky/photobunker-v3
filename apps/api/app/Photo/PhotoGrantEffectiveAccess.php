<?php
declare(strict_types=1);

namespace App\Photo;

use App\Assignments\AssignmentGrantScope;
use App\Identity\Protocol as P;
use Illuminate\Support\Facades\DB;

/**
 * P1 ciphertext grant read authority: live account/key + immutable signed
 * recipient-specific contract + photo/archive TTL + optional Fieldwork scope.
 * Does not make server plaintext/DEKs or an independent personal grant public.
 */
final class PhotoGrantEffectiveAccess
{
    public static function requireReadable(object $g):void
    {
        $now=PhotoSync::nowMs();
        abort_if($g->state!=='active'
            ||(int)$g->expires_at<=$now
            ||$g->photo_state!=='active'
            ||(int)$g->photo_expires<=$now,410);

        $owner=DB::table('identity_accounts')
            ->where('id',$g->owner_account_id)
            ->where('status','ready')->first();
        $recipient=DB::table('identity_accounts')
            ->where('id',$g->recipient_account_id)
            ->where('status','ready')->first();
        $directory=DB::table('account_exchange_keys')
            ->where('account_id',$g->recipient_account_id)->first();
        abort_if(!$owner||!$recipient||!$directory
            ||!is_string($g->recipient_key_digest)
            ||!hash_equals($directory->descriptor_hash,
                $g->recipient_key_digest),410);

        // Independently revalidate immutable P1 signed grant on EVERY read.
        // A fabricated DB scope or changed recipient cannot disclose media.
        $raw=$g->contract_json;
        abort_if(!is_string($raw)||strlen($raw)<150||strlen($raw)>30000
            ||!is_string($g->contract_hash)
            ||!hash_equals($g->contract_hash,hash('sha256',$raw)),410);
        try{$c=json_decode($raw,true,32,JSON_THROW_ON_ERROR);}
        catch(\Throwable){abort(410);}
        abort_if(!is_array($c)||array_is_list($c),410);
        $v=$c['version']??null;
        abort_unless(in_array($v,[1,2],true),410);
        $keys=['version','grantId','photoId','ownerAccountId',
            'recipientAccountId',...($v===2?['assignmentId']:[]),
            'recipientKeyDigest','scope','expiresAt','assets'];
        $actual=array_keys($c);
        sort($actual,SORT_STRING);sort($keys,SORT_STRING);
        abort_if($actual!==$keys
            ||json_encode($c,JSON_UNESCAPED_SLASHES|JSON_THROW_ON_ERROR)!==$raw
            ||($c['grantId']??null)!==$g->id
            ||($c['photoId']??null)!==$g->photo_id
            ||($c['ownerAccountId']??null)!==$g->owner_account_id
            ||($c['recipientAccountId']??null)!==$g->recipient_account_id
            ||($c['recipientKeyDigest']??null)!==$g->recipient_key_digest
            ||($c['scope']??null)!=='read'
            ||($c['expiresAt']??null)!==(int)$g->expires_at,410);
        abort_if(!is_array($c['assets'])||!array_is_list($c['assets'])
            ||count($c['assets'])<2||count($c['assets'])>3,410);
        // All uploaded object IDs are immutable. Signed grant must bind
        // exactly its original objects, with no duplicates/extra keys.
        $seen=[];
        foreach($c['assets'] as $asset){
            abort_if(!is_array($asset)||array_is_list($asset),410);
            $assetKeys=['assetId','ephemeralSpki','salt','iv','ciphertext'];
            $actualKeys=array_keys($asset);
            sort($actualKeys,SORT_STRING);sort($assetKeys,SORT_STRING);
            abort_if($actualKeys!==$assetKeys
                ||!is_string($asset['assetId'])
                ||isset($seen[$asset['assetId']]),410);
            $seen[$asset['assetId']]=true;
        }
        if($v===1){
            abort_if($g->assignment_id!==null
                ||array_key_exists('assignmentId',$c),410);
        }else{
            abort_if(!is_string($g->assignment_id)
                ||($c['assignmentId']??null)!==$g->assignment_id,410);
        }
        abort_if(!is_string($g->account_signature),410);
        try{
            $verified=P::verify($owner->account_spki,
                "pb3.photo-grant.v".$v."\n".$raw,
                $g->account_signature);
        }catch(\Throwable){abort(410);}
        abort_unless($verified,410);

        // Defense-in-depth: archive UX currently rejects any historical
        // grant, but stale database / migration rows must not bypass read ACL.
        abort_if(DB::table('browser_archive_entries_v1')
            ->where('kind','photo')->where('asset_id',$g->photo_id)
            ->whereIn('state',['archived','deleting'])->exists(),410);

        if($v===2){
            $a=DB::table('assignment_records_v1')
                ->where('id',$g->assignment_id)->first();
            abort_if(!$a
                ||$a->owner_account_id!==$g->recipient_account_id,410);
            AssignmentGrantScope::requireReadable($g->assignment_id);
        }
    }
}
