<?php
declare(strict_types=1);

namespace App\Media;

use App\Assignments\AssignmentGrantScope;
use App\Identity\Protocol as P;
use App\Photo\PhotoSync;
use Illuminate\Support\Facades\DB;

/**
 * Effective recipient grant = account + current key + signed scope +
 * source/derivative media + archive state + TTL + assignment membership.
 *
 * Server never sees plaintext or DEKs. This is NOT a public-card policy:
 * public token format, file policy and public key transport remain CLOSED.
 */
final class MediaGrantEffectiveAccess
{
    public static function requireReadable(object $g):void
    {
        $now=PhotoSync::nowMs();
        abort_if($g->state!=='active'
            ||(int)$g->expires_at<=$now
            ||$g->media_state!=='active'
            ||(int)$g->media_expires<=$now
            ||!hash_equals($g->media_contract_hash,$g->actual_media_hash),410);

        $owner=DB::table('identity_accounts')
            ->where('id',$g->owner_account_id)
            ->where('status','ready')->first();
        $recipient=DB::table('identity_accounts')
            ->where('id',$g->recipient_account_id)
            ->where('status','ready')->first();
        $directory=DB::table('account_exchange_keys')
            ->where('account_id',$g->recipient_account_id)->first();
        abort_if(!$owner||!$recipient||!$directory
            ||!hash_equals($directory->descriptor_hash,
                $g->recipient_key_digest),410);

        // Validate DB binding to the exact canonical ACCOUNT-SIGNED grant.
        // Neither a changed source_id nor a manufactured grant scope may
        // expose a different DEK after initial successful creation.
        $json=$g->contract_json;
        if(!is_string($json)||!hash_equals(
            $g->contract_hash,hash('sha256',$json)))abort(410);
        try{$signed=json_decode($json,true,32,JSON_THROW_ON_ERROR);}
        catch(\Throwable){abort(410);}
        if(!is_array($signed)||array_is_list($signed))abort(410);
        $v=$signed['version']??null;
        if(!in_array($v,[1,2,3],true)
            ||json_encode($signed,JSON_UNESCAPED_SLASHES|JSON_THROW_ON_ERROR)!==$json
            ||($signed['grantId']??null)!==$g->id
            ||($signed['mediaId']??null)!==$g->media_id
            ||($signed['ownerAccountId']??null)!==$g->owner_account_id
            ||($signed['recipientAccountId']??null)!==$g->recipient_account_id
            ||($signed['recipientKeyDigest']??null)!==$g->recipient_key_digest
            ||($signed['mediaContractHash']??null)!==$g->media_contract_hash
            ||($signed['expiresAt']??null)!==(int)$g->expires_at
            ||($signed['scope']??null)!==($v===3?'safe_read':'read')
            ||!P::verify($owner->account_spki,
                "pb3.media-grant.v".$v."\n".$json,
                $g->account_signature))abort(410);

        // Archive/physical deletion is a denial even before file TTL.
        abort_if(DB::table('browser_archive_entries_v1')
            ->where('kind','media')->where('asset_id',$g->media_id)
            ->whereIn('state',['archived','deleting'])->exists(),410);

        if($v===3){
            if($g->assignment_id!==null
                ||!is_string($g->source_media_id)
                ||!is_string($g->source_contract_hash)
                ||($signed['sourceMediaId']??null)!==$g->source_media_id
                ||($signed['sourceContractHash']??null)!==$g->source_contract_hash
                ||$g->source_media_id===$g->media_id
                ||$g->actual_media_type!=='photo')abort(410);
            $source=DB::table('media_files_v1')
                ->where('id',$g->source_media_id)
                ->where('account_id',$g->owner_account_id)->first();
            abort_if(!$source
                ||$source->state!=='active'
                ||$source->media_type!=='photo'
                ||$source->expires_at<=$now
                ||!hash_equals($source->contract_hash,
                    $g->source_contract_hash)
                ||DB::table('browser_archive_entries_v1')
                    ->where('kind','media')
                    ->where('asset_id',$g->source_media_id)
                    ->whereIn('state',['archived','deleting'])->exists(),410);
        }else{
            if($g->source_media_id!==null
                ||$g->source_contract_hash!==null
                ||isset($signed['sourceMediaId'])
                ||isset($signed['sourceContractHash']))abort(410);
            if($v===2){
                if(!is_string($g->assignment_id)
                    ||($signed['assignmentId']??null)!==$g->assignment_id)
                    abort(410);
                // Assignment file access is limited by live membership,
                // ownership and signed retention. Finishing an assignment
                // alone must not erase its still-valid file access.
                AssignmentGrantScope::requireReadable($g->assignment_id);
                $a=DB::table('assignment_records_v1')
                    ->where('id',$g->assignment_id)->first();
                abort_if(!$a
                    ||$a->owner_account_id!==$g->recipient_account_id,410);
                AssignmentGrantScope::requireAccepted(
                    $g->assignment_id,$g->recipient_account_id,
                    $g->owner_account_id);
            }elseif($g->assignment_id!==null
                ||isset($signed['assignmentId']))abort(410);
        }
    }
}
