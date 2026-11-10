<?php
declare(strict_types=1);

namespace App\Http\Controllers;

use App\Identity\Protocol as P;
use App\Photo\PhotoSync;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;

/**
 * Account-signed ECDH directory. The backend stores only public SPKI and an
 * encrypted private-key envelope; it never receives raw ECDH/DEK/Recovery Keys.
 */
final class RecipientKeyController extends Controller
{
    public function __construct(private readonly PhotoSync $sync) {}

    private function directory(string $accountId): object
    {
        P::uuid($accountId);
        $row=DB::table('account_exchange_keys as k')
            ->join('identity_accounts as a','a.id','=','k.account_id')
            ->where('k.account_id',$accountId)->where('a.status','ready')
            ->select('k.*','a.account_spki')->first();
        abort_unless($row,404);
        return $row;
    }

    public function show(Request $request,string $accountId) {
        $this->sync->actor($request);
        $k=$this->directory($accountId);
        return $this->sync->json([
            'accountId'=>$accountId,'accountSpki'=>$k->account_spki,
            'descriptor'=>$k->descriptor,'signature'=>$k->account_signature,
            'descriptorHash'=>$k->descriptor_hash,
        ]);
    }

    public function mine(Request $request) {
        [$a]=$this->sync->actor($request);
        $row=DB::table('account_exchange_keys')->where('account_id',$a->id)->first();
        if (!$row) return $this->sync->json(['present'=>false]);
        return $this->sync->json([
            'present'=>true,'descriptor'=>$row->descriptor,
            'signature'=>$row->account_signature,
            'sealedPrivate'=>json_decode($row->sealed_private,true,8,JSON_THROW_ON_ERROR),
        ]);
    }

    public function publish(Request $request) {
        $this->sync->origin($request);
        [$actor]=$this->sync->actor($request);
        $input=P::exact($request->json()->all(),['descriptor','signature','sealedPrivate']);
        abort_unless(is_string($input['descriptor'])&&is_string($input['signature'])
            &&strlen($input['descriptor'])<=2048,422);
        try{$d=json_decode($input['descriptor'],true,12,JSON_THROW_ON_ERROR);}
        catch(\Throwable){abort(422);}
        abort_unless(is_array($d)&&!array_is_list($d),422);
        P::exact($d,['version','accountId','exchangeSpki','sealedDigest']);
        abort_unless($d['version']===1 && $d['accountId']===$actor->id
            &&is_string($d['exchangeSpki'])&&is_string($d['sealedDigest'])
            &&preg_match('/^[a-f0-9]{64}$/D',$d['sealedDigest']),422);
        P::spki($d['exchangeSpki']);
        abort_unless(json_encode($d,JSON_UNESCAPED_SLASHES|JSON_THROW_ON_ERROR)
            ===$input['descriptor'],422);
        abort_unless(is_array($input['sealedPrivate']),422);
        P::exact($input['sealedPrivate'],['iv','ciphertext']);
        P::b64($input['sealedPrivate']['iv'],12);
        $encrypted=P::b64($input['sealedPrivate']['ciphertext']);
        abort_unless(strlen($encrypted)>=32 && strlen($encrypted)<=500,422);
        $seal=json_encode($input['sealedPrivate'],JSON_UNESCAPED_SLASHES|JSON_THROW_ON_ERROR);
        abort_unless(hash_equals($d['sealedDigest'],hash('sha256',$seal)),422);
        abort_unless(P::verify($actor->account_spki,
            "pb3.recipient-key.v1\n".$input['descriptor'],$input['signature']),401);
        $hash=hash('sha256',$input['descriptor']);
        return DB::transaction(function()use($actor,$input,$hash,$seal){
            DB::table('identity_accounts')->where('id',$actor->id)->lockForUpdate()->first();
            $old=DB::table('account_exchange_keys')->where('account_id',$actor->id)->first();
            if ($old){
                abort_unless(hash_equals($old->descriptor_hash,$hash)
                    &&hash_equals($old->account_signature,$input['signature']),409);
                return $this->sync->json(['published'=>true,'unchanged'=>true]);
            }
            DB::table('account_exchange_keys')->insert([
                'account_id'=>$actor->id,'descriptor'=>$input['descriptor'],
                'account_signature'=>$input['signature'],'descriptor_hash'=>$hash,
                'sealed_private'=>$seal,'created_at'=>now(),'updated_at'=>now(),
            ]);
            return $this->sync->json(['published'=>true,'unchanged'=>false],201);
        },3);
    }
}
