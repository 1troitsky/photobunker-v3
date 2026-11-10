<?php
declare(strict_types=1);

namespace App\Http\Controllers;

use App\Identity\Protocol as P;
use App\Photo\PhotoSync;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;

/**
 * P2-02D1: server-blind, account-signed escrow of a 32-byte Matrix 4S seed.
 * Never serves strangers. Does not assert a Matrix key-backup was created.
 */
final class MatrixRecoveryEscrowController extends Controller
{
    public function __construct(private readonly PhotoSync $sync) {}

    private function boundAccount(object $account):object {
        $binding=DB::table('matrix_account_bindings_v1')
            ->where('account_id',$account->id)->first();
        abort_unless($binding,409);
        return $binding;
    }

    public function mine(Request $request) {
        [$account]=$this->sync->actor($request);
        $binding=$this->boundAccount($account);
        $row=DB::table('matrix_recovery_escrows_v1')
            ->where('account_id',$account->id)->first();
        if(!$row) return $this->sync->json(['present'=>false]);
        // Recovery/key rotation may supersede the PB3 AKEK: no misleading
        // "saved" state from stale revisions or an altered Matrix account.
        abort_unless((int)$row->account_revision===(int)$account->revision,409);
        $contract=json_decode($row->contract_json,true,8,JSON_THROW_ON_ERROR);
        abort_unless(is_array($contract)
            &&($contract['homeserverUrl']??null)===$binding->homeserver_url
            &&($contract['matrixUserId']??null)===$binding->matrix_user_id,409);
        return $this->sync->json([
            'present'=>true,
            'contract'=>$row->contract_json,
            'signature'=>$row->account_signature,
        ]);
    }

    public function store(Request $request) {
        $this->sync->origin($request);
        [$account]=$this->sync->actor($request);
        $binding=$this->boundAccount($account);
        $data=P::exact($request->json()->all(),['contract','signature']);
        abort_unless(is_string($data['contract'])
            &&strlen($data['contract'])<=2048
            &&is_string($data['signature']),422);
        try{$c=json_decode($data['contract'],true,10,JSON_THROW_ON_ERROR);}
        catch(\Throwable){abort(422);}
        abort_unless(is_array($c)&&!array_is_list($c),422);
        P::exact($c,['version','operationId','accountId','accountRevision',
            'homeserverUrl','matrixUserId','purpose','keyId','iv','ciphertext']);
        abort_unless(is_string($c['operationId'])
            &&is_string($c['accountId'])
            &&is_string($c['homeserverUrl'])
            &&is_string($c['matrixUserId'])
            &&is_string($c['purpose']),422);
        P::uuid($c['operationId']);
        abort_unless($c['version']===1
            &&$c['accountId']===$account->id
            &&is_int($c['accountRevision'])
            &&$c['accountRevision']===(int)$account->revision
            &&$c['accountRevision']>=1
            &&$c['homeserverUrl']===$binding->homeserver_url
            &&$c['matrixUserId']===$binding->matrix_user_id
            &&$c['purpose']==='matrix-ssss-key'
            &&is_string($c['keyId'])
            &&is_string($c['iv'])
            &&is_string($c['ciphertext'])
            &&json_encode($c,JSON_UNESCAPED_SLASHES|JSON_THROW_ON_ERROR)
                ===$data['contract'],422);
        P::b64($c['keyId'],16);
        P::b64($c['iv'],12);
        // A 256-bit secret-storage key + 128-bit AES-GCM authentication tag.
        P::b64($c['ciphertext'],48);
        abort_unless(P::verify($account->account_spki,
            "pb3.matrix-ssss-escrow.v1\n".$data['contract'],$data['signature']),401);
        $hash=hash('sha256',$data['contract']);

        return DB::transaction(function()use($account,$binding,$data,$c,$hash){
            $fresh=DB::table('identity_accounts')
                ->where('id',$account->id)->lockForUpdate()->first();
            abort_unless($fresh &&$fresh->status==='ready'
                &&(int)$fresh->revision===(int)$account->revision
                &&hash_equals((string)$fresh->account_spki,
                    (string)$account->account_spki),401);
            $current=DB::table('matrix_account_bindings_v1')
                ->where('account_id',$account->id)->first();
            abort_unless($current
                &&$current->matrix_user_id===$binding->matrix_user_id
                &&$current->homeserver_url===$binding->homeserver_url,409);
            $old=DB::table('matrix_recovery_escrows_v1')
                ->where('account_id',$account->id)->first();
            if($old) {
                abort_unless($old->account_revision===(int)$c['accountRevision']
                    &&hash_equals($old->contract_hash,$hash)
                    &&hash_equals($old->account_signature,$data['signature']),409);
                return $this->sync->json(['stored'=>true,'unchanged'=>true]);
            }
            DB::table('matrix_recovery_escrows_v1')->insert([
                'account_id'=>$account->id,
                'account_revision'=>$c['accountRevision'],
                'operation_id'=>$c['operationId'],
                'contract_hash'=>$hash,
                'contract_json'=>$data['contract'],
                'account_signature'=>$data['signature'],
                'created_at'=>now(),'updated_at'=>now(),
            ]);
            return $this->sync->json(['stored'=>true,'unchanged'=>false],201);
        },3);
    }
}
