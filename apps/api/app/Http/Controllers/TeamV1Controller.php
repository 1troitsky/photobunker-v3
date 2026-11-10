<?php
declare(strict_types=1);

namespace App\Http\Controllers;

use App\Assignments\AssignmentContract as C;
use App\Identity\Protocol as P;
use App\Photo\PhotoSync;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;

/**
 * P1-27: owner-only encrypted team creation/list. Other roles and invites
 * deliberately require separate signed membership/consent contracts.
 */
final class TeamV1Controller extends Controller
{
    public function __construct(private readonly PhotoSync $sync) {}

    private function publicRow(object $row):array
    {
        return [
            'teamId'=>$row->id,
            'ownerAccountId'=>$row->owner_account_id,
            'state'=>$row->state,
            'contract'=>$row->contract_json,
            'signature'=>$row->owner_signature,
            'memberCount'=>(int)$row->member_count,
        ];
    }

    public function create(Request $request)
    {
        $this->sync->origin($request);
        [$actor]=$this->sync->actor($request);
        $input=P::exact($request->json()->all(),['contract','signature']);
        abort_unless(is_string($input['contract'])&&is_string($input['signature']),422);
        $c=C::signed($input['contract'],$input['signature'],
            $actor->account_spki,'pb3.team-create.v1',[
                'version','teamId','operationId','ownerAccountId','privateEnvelope',
            ],9000);
        abort_unless($c['version']===1&&$c['ownerAccountId']===$actor->id,422);
        foreach(['teamId','operationId','ownerAccountId'] as $field)C::uuid($c,$field);
        $envelope=$c['privateEnvelope'];
        abort_unless(is_array($envelope)&&!array_is_list($envelope)
            &&($envelope['version']??null)===1
            &&is_string($envelope['iv']??null)
            &&is_string($envelope['ciphertext']??null)
            &&is_array($envelope['wrappedKey']??null)
            &&!array_is_list($envelope['wrappedKey'])
            &&is_string($envelope['wrappedKey']['iv']??null)
            &&is_string($envelope['wrappedKey']['ciphertext']??null),422);
        // Profile uses a team-specific DEK; AKEK only wraps the owner key.
        // Future invitations wrap this immutable DEK to independently
        // trusted members without re-encrypting the team profile.
        C::envelope($envelope);
        P::b64($envelope['wrappedKey']['ciphertext'],48);
        $bytes=P::b64($envelope['ciphertext']);
        abort_unless(strlen($bytes)>=32&&strlen($bytes)<=4096,422);
        $hash=hash('sha256',$input['contract']);

        return DB::transaction(function()use($actor,$c,$input,$hash){
            DB::table('identity_accounts')->where('id',$actor->id)->lockForUpdate()->first();
            $old=DB::table('team_records_v1')->where('id',$c['teamId'])->first();
            if($old){
                abort_unless($old->owner_account_id===$actor->id
                    &&hash_equals($old->contract_hash,$hash)
                    &&hash_equals($old->owner_signature,$input['signature']),409);
                return $this->sync->json(['teamId'=>$old->id,
                    'state'=>$old->state,'unchanged'=>true]);
            }
            abort_if(DB::table('team_records_v1')
                ->where('operation_id',$c['operationId'])->exists(),409);
            DB::table('team_records_v1')->insert([
                'id'=>$c['teamId'],'owner_account_id'=>$actor->id,
                'operation_id'=>$c['operationId'],'contract_hash'=>$hash,
                'contract_json'=>$input['contract'],
                'owner_signature'=>$input['signature'],'state'=>'active',
                'created_at'=>now(),'updated_at'=>now(),
            ]);
            DB::table('team_members_v1')->insert([
                'team_id'=>$c['teamId'],'account_id'=>$actor->id,
                'role'=>'owner','state'=>'active',
                'created_at'=>now(),'updated_at'=>now(),
            ]);
            return $this->sync->json([
                'teamId'=>$c['teamId'],'state'=>'active','unchanged'=>false,
            ],201);
        },3);
    }

    /** Only owner-readable for P1-27. Never infer a team membership from a contact. */
    public function index(Request $request)
    {
        [$actor]=$this->sync->actor($request);
        $after=$request->query('after');
        abort_unless($after===null||is_string($after),422);
        if($after!==null)P::uuid($after);
        $rows=DB::table('team_records_v1 as t')
            ->where('t.owner_account_id',$actor->id);
        if($after!==null)$rows->where('t.id','>',$after);
        $rows=$rows->select('t.*')
            ->selectSub(DB::table('team_members_v1')
                ->selectRaw('COUNT(*)')->whereColumn('team_id','t.id')
                ->where('state','active'),'member_count')
            ->orderBy('t.id')->limit(51)->get()->all();
        $page=array_slice($rows,0,50);
        return $this->sync->json([
            'items'=>array_map(fn($row)=>$this->publicRow($row),$page),
            'nextCursor'=>count($rows)>50?$page[49]->id:null,
        ]);
    }

    public function show(Request $request,string $teamId)
    {
        [$actor]=$this->sync->actor($request);
        P::uuid($teamId);
        $row=DB::table('team_records_v1 as t')
            ->where('t.id',$teamId)->where('t.owner_account_id',$actor->id)
            ->select('t.*')
            ->selectSub(DB::table('team_members_v1')
                ->selectRaw('COUNT(*)')->whereColumn('team_id','t.id')
                ->where('state','active'),'member_count')->first();
        abort_unless($row,404);
        return $this->sync->json($this->publicRow($row));
    }
}
