<?php
declare(strict_types=1);

namespace App\Http\Controllers;

use App\Assignments\AssignmentContract as C;
use App\Identity\Protocol as P;
use App\Photo\PhotoSync;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;

/**
 * P1-29B: atomic owner-signed Team DEK epoch rotation.
 * No ciphertext/key material outside immutable signed JSON + active recipient
 * ECDH grants. Existing owner-only v1 root remains immutable historical data.
 */
final class TeamKeyEpochController extends Controller
{
    public function __construct(private readonly PhotoSync $sync) {}

    private function current(object $team):array
    {
        $epoch=(int)$team->key_epoch;
        if($epoch===1){
            return [
                'keyEpoch'=>1,'contract'=>$team->contract_json,
                'signature'=>$team->owner_signature,
                'contractHash'=>$team->contract_hash,
                'domain'=>'pb3.team-create.v1',
            ];
        }
        $row=DB::table('team_key_epochs_v1')->where('team_id',$team->id)
            ->where('epoch',$epoch)->first();
        abort_unless($row,409);
        return [
            'keyEpoch'=>$epoch,'contract'=>$row->contract_json,
            'signature'=>$row->owner_signature,
            'contractHash'=>$row->contract_hash,
            'domain'=>'pb3.team-key-epoch.v1',
        ];
    }

    public function owner(Request $r,string $teamId)
    {
        [$actor]=$this->sync->actor($r);
        P::uuid($teamId);
        $team=DB::table('team_records_v1')->where('id',$teamId)
            ->where('owner_account_id',$actor->id)->first();
        abort_unless($team,404);
        return $this->sync->json([
            'teamId'=>$teamId,'ownerAccountId'=>$actor->id,
            'membershipRevision'=>(int)$team->membership_revision,
            'rotationRequired'=>(bool)$team->rotation_required,
            ...$this->current($team),
        ]);
    }

    public function recipient(Request $r,string $teamId)
    {
        [$actor]=$this->sync->actor($r);
        P::uuid($teamId);
        $team=DB::table('team_records_v1')->where('id',$teamId)
            ->where('state','active')->first();
        abort_unless($team,404);
        $member=DB::table('team_members_v1')->where('team_id',$teamId)
            ->where('account_id',$actor->id)->where('state','active')
            ->whereIn('role',['curator','contributor','viewer'])->first();
        abort_unless($member,404);
        // Every recipient must be denied old Team DEK while a key epoch is
        // quarantined by member removal, even if they're still active.
        abort_unless(!$team->rotation_required,409);
        $root=$this->current($team);
        if($root['keyEpoch']===1)return $this->sync->json([
            'teamId'=>$teamId,'keyEpoch'=>1,
        ]);
        $grant=DB::table('team_epoch_grants_v1')
            ->where('team_id',$teamId)
            ->where('epoch',$root['keyEpoch'])
            ->where('recipient_account_id',$actor->id)->first();
        abort_unless($grant,409);
        // A later signed membership role change does not change the epoch's
        // historical ECDH AAD. Current role is returned separately.
        $latestRole=DB::table('team_membership_events_v1')
            ->where('team_id',$teamId)
            ->where('target_account_id',$actor->id)
            ->where('action','change_role')
            ->orderByDesc('to_revision')->first();
        // A recipient who rotated their ECDH directory since the epoch
        // must reconfirm/rekey, not receive stale-key ciphertext as current.
        $directory=DB::table('account_exchange_keys')
            ->where('account_id',$actor->id)->first();
        abort_unless($directory
            &&hash_equals($directory->descriptor_hash,
                $grant->recipient_key_digest),409);
        return $this->sync->json([
            'teamId'=>$teamId,
            'ownerAccountId'=>$team->owner_account_id,
            'membershipRevision'=>(int)$team->membership_revision,
            'effectiveRole'=>$member->role,
            'latestRoleEvent'=>$latestRole?[
                'contract'=>$latestRole->contract_json,
                'signature'=>$latestRole->owner_signature,
            ]:null,
            ...$root,
            'recipient'=>[
                'accountId'=>$actor->id,
                'role'=>$grant->role,
                'recipientKeyDigest'=>$grant->recipient_key_digest,
                'envelope'=>json_decode($grant->envelope_json,true,16,JSON_THROW_ON_ERROR),
            ],
        ]);
    }


    /** Bounded chain needed by returning members to verify successive epoch
     * rotations back to the immutable original owner-signed team root.
     */
    public function history(Request $r,string $teamId)
    {
        [$actor]=$this->sync->actor($r);
        P::uuid($teamId);
        $team=DB::table('team_records_v1')->where('id',$teamId)
            ->where('state','active')->first();
        abort_unless($team,404);
        $isOwner=$team->owner_account_id===$actor->id;
        if(!$isOwner){
            abort_unless(DB::table('team_members_v1')
                ->where('team_id',$teamId)->where('account_id',$actor->id)
                ->where('state','active')->exists(),404);
            abort_unless(!$team->rotation_required,409);
        }
        $after=$r->query('after');
        abort_unless($after===null
            ||(is_string($after)&&ctype_digit($after)),422);
        $cursor=$after===null?1:(int)$after;
        abort_unless($cursor>=1&&$cursor<=1000000,422);
        $rows=DB::table('team_key_epochs_v1')
            ->where('team_id',$teamId)->where('epoch','>',$cursor)
            ->orderBy('epoch')->limit(51)->get();
        $items=$rows->take(50)->map(static fn($e)=>[
            'keyEpoch'=>(int)$e->epoch,'contract'=>$e->contract_json,
            'signature'=>$e->owner_signature,'contractHash'=>$e->contract_hash,
        ])->values()->all();
        return $this->sync->json([
            'teamId'=>$teamId,'ownerAccountId'=>$team->owner_account_id,
            'membershipRevision'=>(int)$team->membership_revision,
            'keyEpoch'=>(int)$team->key_epoch,
            'rotationRequired'=>(bool)$team->rotation_required,
            'root'=>[
                'contract'=>$team->contract_json,
                'signature'=>$team->owner_signature,
                'contractHash'=>$team->contract_hash,
            ],
            'items'=>$items,
            'nextCursor'=>$rows->count()>50?$items[49]['keyEpoch']:null,
        ]);
    }

    public function rotate(Request $r,string $teamId)
    {
        $this->sync->origin($r);
        [$actor]=$this->sync->actor($r);
        P::uuid($teamId);
        $payload=P::exact($r->json()->all(),['contract','signature']);
        abort_unless(is_string($payload['contract'])
            &&is_string($payload['signature']),422);
        $c=C::signed($payload['contract'],$payload['signature'],
            $actor->account_spki,'pb3.team-key-epoch.v1',[
                'version','operationId','teamId','ownerAccountId',
                'fromEpoch','toEpoch','membershipRevision',
                'previousEpochHash','privateEnvelope','recipients',
            ],95000);
        abort_unless(($c['version']??null)===1
            &&$c['teamId']===$teamId
            &&$c['ownerAccountId']===$actor->id
            &&is_int($c['fromEpoch'])&&$c['fromEpoch']>=1
            &&$c['fromEpoch']<=1000000
            &&is_int($c['toEpoch'])&&$c['toEpoch']===$c['fromEpoch']+1
            &&is_int($c['membershipRevision'])
            &&$c['membershipRevision']>=2
            &&$c['membershipRevision']<=1000000,422);
        foreach(['teamId','operationId','ownerAccountId'] as $field)
            C::uuid($c,$field);
        abort_unless(is_string($c['previousEpochHash'])
            &&preg_match('/^[a-f0-9]{64}$/D',$c['previousEpochHash'])===1,422);
        abort_unless(is_array($c['privateEnvelope'])
            &&!array_is_list($c['privateEnvelope']),422);
        C::envelope($c['privateEnvelope']);
        P::b64($c['privateEnvelope']['wrappedKey']['ciphertext'],48);
        $sealed=P::b64($c['privateEnvelope']['ciphertext']);
        abort_unless(strlen($sealed)>=32&&strlen($sealed)<=4096,422);
        abort_unless(is_array($c['recipients'])&&array_is_list($c['recipients'])
            &&count($c['recipients'])<=100,422);
        $last='';
        foreach($c['recipients'] as $item){
            abort_unless(is_array($item)&&!array_is_list($item),422);
            P::exact($item,['accountId','role','recipientKeyDigest','envelope']);
            C::uuid($item,'accountId');
            abort_unless(strcmp($last,$item['accountId'])<0,422);
            $last=$item['accountId'];
            abort_unless(in_array($item['role'],['curator','contributor','viewer'],true)
                &&is_string($item['recipientKeyDigest'])
                &&preg_match('/^[a-f0-9]{64}$/D',$item['recipientKeyDigest'])===1,
                422);
            abort_unless(is_array($item['envelope'])
                &&!array_is_list($item['envelope']),422);
            P::exact($item['envelope'],
                ['ephemeralSpki','salt','iv','ciphertext']);
            $e=$item['envelope'];
            abort_unless(is_string($e['ephemeralSpki'])
                &&is_string($e['salt'])&&is_string($e['iv'])
                &&is_string($e['ciphertext']),422);
            P::spki($e['ephemeralSpki']);
            P::b64($e['salt'],16);
            P::b64($e['iv'],12);
            P::b64($e['ciphertext'],48);
        }
        $hash=hash('sha256',$payload['contract']);
        return DB::transaction(function()use($teamId,$actor,$payload,$c,$hash){
            $team=DB::table('team_records_v1')->where('id',$teamId)
                ->lockForUpdate()->first();
            abort_unless($team&&$team->owner_account_id===$actor->id,404);
            $previous=DB::table('team_key_epochs_v1')
                ->where('operation_id',$c['operationId'])->first();
            if($previous){
                abort_unless($previous->team_id===$teamId
                    &&hash_equals($previous->contract_hash,$hash)
                    &&hash_equals($previous->owner_signature,$payload['signature']),
                    409);
                return $this->sync->json([
                    'teamId'=>$teamId,'keyEpoch'=>(int)$previous->epoch,
                    'unchanged'=>true,
                ]);
            }
            abort_unless($team->state==='active'
                &&$team->rotation_required
                &&(int)$team->key_epoch===$c['fromEpoch']
                &&(int)$team->membership_revision===$c['membershipRevision'],
                409);
            $current=$this->current($team);
            abort_unless(hash_equals($current['contractHash'],
                $c['previousEpochHash']),409);
            // Locking the team row serializes all membership writes/consent
            // against this exact roster. No recipient may be omitted.
            $active=DB::table('team_members_v1 as m')
                ->join('identity_accounts as a','a.id','=','m.account_id')
                ->join('account_exchange_keys as k',
                    'k.account_id','=','m.account_id')
                ->where('m.team_id',$teamId)->where('m.state','active')
                ->where('m.role','!=','owner')
                ->select(['m.account_id','m.role','a.status',
                    'k.descriptor_hash'])->orderBy('m.account_id')->get();
            $count=DB::table('team_members_v1')->where('team_id',$teamId)
                ->where('state','active')->where('role','!=','owner')->count();
            abort_unless($count===$active->count()
                &&$active->count()===count($c['recipients']),409);
            foreach($active as $i=>$member){
                $item=$c['recipients'][$i];
                abort_unless($member->status==='ready'
                    &&$item['accountId']===$member->account_id
                    &&$item['role']===$member->role
                    &&hash_equals($member->descriptor_hash,
                        $item['recipientKeyDigest']),409);
            }
            DB::table('team_key_epochs_v1')->insert([
                'team_id'=>$teamId,'epoch'=>$c['toEpoch'],
                'operation_id'=>$c['operationId'],
                'membership_revision'=>$c['membershipRevision'],
                'previous_epoch_hash'=>$c['previousEpochHash'],
                'contract_hash'=>$hash,'contract_json'=>$payload['contract'],
                'owner_signature'=>$payload['signature'],
                'recipient_count'=>count($c['recipients']),
                'created_at'=>now(),'updated_at'=>now(),
            ]);
            foreach($c['recipients'] as $item){
                DB::table('team_epoch_grants_v1')->insert([
                    'team_id'=>$teamId,'epoch'=>$c['toEpoch'],
                    'recipient_account_id'=>$item['accountId'],
                    'role'=>$item['role'],
                    'recipient_key_digest'=>$item['recipientKeyDigest'],
                    'envelope_json'=>json_encode($item['envelope'],
                        JSON_UNESCAPED_SLASHES|JSON_THROW_ON_ERROR),
                    'created_at'=>now(),'updated_at'=>now(),
                ]);
            }
            // Outstanding v1 invitations carry the old Team DEK and cannot
            // be accepted once the new epoch has been committed.
            DB::table('team_invites_v1')->where('team_id',$teamId)
                ->where('state','pending')
                ->update(['state'=>'revoked','updated_at'=>now()]);
            DB::table('team_records_v1')->where('id',$teamId)->update([
                'key_epoch'=>$c['toEpoch'],'rotation_required'=>false,
                'updated_at'=>now(),
            ]);
            return $this->sync->json([
                'teamId'=>$teamId,'keyEpoch'=>$c['toEpoch'],
                'unchanged'=>false,
            ],201);
        },3);
    }
}
