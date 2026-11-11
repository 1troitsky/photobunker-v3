<?php
declare(strict_types=1);

namespace App\Http\Controllers;

use App\Identity\Protocol as P;
use App\Photo\PhotoSync;
use Illuminate\Database\QueryException;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;

/**
 * PB3-account-signed opaque Matrix 4S seed envelopes.
 * v1 is immutable; v2 is append-only, linked by the SHA-256 hash of the
 * preceding canonical signed contract. Neither table contains a seed or
 * Matrix access token. Previous revision is returned only to the current
 * authenticated owner for explicit rewrap; never as current recovery data.
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

    /** Highest server-stored account revision, including the legacy v1 root. */
    private function latest(string $accountId):?object {
        $v1=DB::table('matrix_recovery_escrows_v1')
            ->where('account_id',$accountId)->first();
        $v2=DB::table('matrix_recovery_escrow_revisions_v2')
            ->where('account_id',$accountId)
            ->orderByDesc('account_revision')->first();
        if(!$v1) return $v2;
        if(!$v2) return $v1;
        return (int)$v2->account_revision>(int)$v1->account_revision
            ?$v2:$v1;
    }

    private function checkedBinding(object $row,object $binding):void {
        $contract=json_decode($row->contract_json,true,8,JSON_THROW_ON_ERROR);
        abort_unless(is_array($contract)
            &&($contract['homeserverUrl']??null)===$binding->homeserver_url
            &&($contract['matrixUserId']??null)===$binding->matrix_user_id,409);
    }

    private function response(object $row):array {
        return [
            'present'=>true,
            'contract'=>$row->contract_json,
            'signature'=>$row->account_signature,
        ];
    }

    public function mine(Request $request) {
        [$account]=$this->sync->actor($request);
        $binding=$this->boundAccount($account);
        $row=$this->latest($account->id);
        if(!$row)return $this->sync->json(['present'=>false]);
        // Never accept a historical envelope as a CURRENT recovery receipt.
        abort_unless((int)$row->account_revision===(int)$account->revision,409);
        $this->checkedBinding($row,$binding);
        return $this->sync->json($this->response($row));
    }

    /** One-step rewrap source, accessible ONLY to current authenticated PB3
     * identity after revision advances. Caller MUST verify the root signature
     * and the AEAD using its own Recovery-Key-derived AKEK before new write.
     */
    public function previous(Request $request) {
        [$account]=$this->sync->actor($request);
        $binding=$this->boundAccount($account);
        $row=$this->latest($account->id);
        abort_unless($row &&(int)$row->account_revision<(int)$account->revision,409);
        $this->checkedBinding($row,$binding);
        return $this->sync->json($this->response($row));
    }

    public function store(Request $request) {
        $this->sync->origin($request);
        [$account]=$this->sync->actor($request);
        $binding=$this->boundAccount($account);
        $data=P::exact($request->json()->all(),['contract','signature']);
        abort_unless(is_string($data['contract'])
            &&strlen($data['contract'])<=2304
            &&is_string($data['signature']),422);
        try{$c=json_decode($data['contract'],true,10,JSON_THROW_ON_ERROR);}
        catch(\Throwable){abort(422);}
        abort_unless(is_array($c)&&!array_is_list($c),422);
        $version=$c['version']??null;
        abort_unless($version===1||$version===2,422);
        $fields=['version','operationId','accountId','accountRevision',
            'homeserverUrl','matrixUserId','purpose','keyId','iv','ciphertext'];
        if($version===2)$fields[]='previousContractHash';
        P::exact($c,$fields);
        abort_unless(is_string($c['operationId'])
            &&is_string($c['accountId'])
            &&is_string($c['homeserverUrl'])
            &&is_string($c['matrixUserId'])
            &&is_string($c['purpose']),422);
        P::uuid($c['operationId']);
        abort_unless($c['accountId']===$account->id
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
        if($version===2) {
            abort_unless($c['accountRevision']>=2
                &&is_string($c['previousContractHash'])
                &&preg_match('/^[a-f0-9]{64}$/D',$c['previousContractHash'])===1,422);
        }
        P::b64($c['keyId'],16);
        P::b64($c['iv'],12);
        P::b64($c['ciphertext'],48);
        $signatureDomain=$version===2
            ?"pb3.matrix-ssss-escrow.v2\n"
            :"pb3.matrix-ssss-escrow.v1\n";
        abort_unless(P::verify($account->account_spki,
            $signatureDomain.$data['contract'],$data['signature']),401);
        $hash=hash('sha256',$data['contract']);

        try{
            return DB::transaction(function()use($account,$binding,$data,$c,$hash,$version){
                // Synchronize with signed PB3 rotate and all escrow writers.
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

                $latest=$this->latest($account->id);
                if($latest &&(int)$latest->account_revision===(int)$c['accountRevision']) {
                    abort_unless(hash_equals($latest->contract_hash,$hash)
                        &&hash_equals($latest->account_signature,$data['signature']),409);
                    return $this->sync->json(['stored'=>true,'unchanged'=>true]);
                }
                if($version===1) {
                    // Immutable legacy row can be created only once. A later
                    // account revision must use a parent-linked v2 contract.
                    abort_unless(!$latest,409);
                    DB::table('matrix_recovery_escrows_v1')->insert([
                        'account_id'=>$account->id,
                        'account_revision'=>$c['accountRevision'],
                        'operation_id'=>$c['operationId'],
                        'contract_hash'=>$hash,
                        'contract_json'=>$data['contract'],
                        'account_signature'=>$data['signature'],
                        'created_at'=>now(),'updated_at'=>now(),
                    ]);
                }else{
                    abort_unless($latest
                        &&(int)$latest->account_revision<(int)$c['accountRevision']
                        &&hash_equals((string)$latest->contract_hash,
                            $c['previousContractHash']),409);
                    $this->checkedBinding($latest,$binding);
                    DB::table('matrix_recovery_escrow_revisions_v2')->insert([
                        'account_id'=>$account->id,
                        'account_revision'=>$c['accountRevision'],
                        'operation_id'=>$c['operationId'],
                        'parent_contract_hash'=>$c['previousContractHash'],
                        'contract_hash'=>$hash,
                        'contract_json'=>$data['contract'],
                        'account_signature'=>$data['signature'],
                        'created_at'=>now(),'updated_at'=>now(),
                    ]);
                }
                return $this->sync->json(['stored'=>true,'unchanged'=>false],201);
            },3);
        }catch(QueryException $e){
            if(in_array((string)$e->getCode(),['23000','23505'],true))
                abort(409,'matrix.recovery_revision_conflict');
            throw $e;
        }
    }
}
