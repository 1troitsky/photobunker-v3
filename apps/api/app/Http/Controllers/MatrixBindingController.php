<?php
declare(strict_types=1);

namespace App\Http\Controllers;

use App\Identity\Protocol as P;
use App\Photo\PhotoSync;
use Illuminate\Database\QueryException;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Http;

/**
 * P2-02A: explicit Matrix identity proof, NOT Matrix auth or message delivery.
 * Matrix access token is used in memory for one /whoami and NEVER persisted,
 * logged or returned. Homeserver origin comes only from operator config.
 */
final class MatrixBindingController extends Controller
{
    public function __construct(private readonly PhotoSync $sync) {}

    private function origin():string
    {
        $raw=config('matrix.homeserver_url');
        // No caller-controlled URL, redirects, localhost, credentials, query,
        // fragments, or non-TLS transport. Dedicated BYO Matrix is a later gate.
        abort_unless(is_string($raw) && strlen($raw)<=255
            &&preg_match('~^https://[a-z0-9][a-z0-9.-]*(?::443)?$~D',$raw)===1
            &&str_contains(parse_url($raw,PHP_URL_HOST) ?: '', '.')
            &&filter_var(parse_url($raw,PHP_URL_HOST),FILTER_VALIDATE_IP)===false,503);
        return $raw;
    }

    public function mine(Request $request)
    {
        [$account,$device]=$this->sync->actor($request);
        $config=$this->origin();
        $record=DB::table('matrix_account_bindings_v1')
            ->where('account_id',$account->id)->first();
        $bound=$record ? DB::table('matrix_device_bindings_v1')
            ->where('pb3_device_id',$device->id)
            ->where('account_id',$account->id)->first() : null;
        return $this->sync->json([
            'configured'=>true,
            'bound'=>$bound!==null,
            'homeserverUrl'=>$config,
            'matrixUserId'=>$record?->matrix_user_id,
            'deviceBinding'=>$bound?[
                'contract'=>$bound->contract_json,
                'accountSignature'=>$bound->account_signature,
                'deviceSignature'=>$bound->device_signature,
            ]:null,
        ]);
    }

    public function bind(Request $request)
    {
        $this->sync->origin($request);
        [$account,$device]=$this->sync->actor($request);
        $homeserver=$this->origin();
        $input=P::exact($request->json()->all(),
            ['contract','accountSignature','deviceSignature','accessToken']);
        abort_unless(is_string($input['contract'])&&strlen($input['contract'])<2048
            &&is_string($input['accountSignature'])
            &&is_string($input['deviceSignature'])
            &&is_string($input['accessToken'])
            &&strlen($input['accessToken'])>=16
            &&strlen($input['accessToken'])<=4096
            &&preg_match('/^[\x21-\x7e]+$/D',$input['accessToken'])===1,422);
        try{$contract=json_decode($input['contract'],true,12,JSON_THROW_ON_ERROR);}
        catch(\Throwable){abort(422);}
        abort_unless(is_array($contract)&&!array_is_list($contract),422);
        P::exact($contract,['version','operationId','accountId','pb3DeviceId',
            'homeserverUrl','matrixUserId','matrixDeviceId']);
        abort_unless(($contract['version']??null)===1
            &&($contract['accountId']??null)===$account->id
            &&($contract['pb3DeviceId']??null)===$device->id
            &&($contract['homeserverUrl']??null)===$homeserver
            &&is_string($contract['matrixUserId'])
            &&is_string($contract['matrixDeviceId'])
            &&preg_match('/^@[a-zA-Z0-9._=+\\/-]{1,120}:[a-zA-Z0-9.-]{1,100}$/D',
                $contract['matrixUserId'])===1
            &&preg_match('/^[\x21-\x7e]{1,128}$/D',$contract['matrixDeviceId'])===1
            &&json_encode($contract,JSON_UNESCAPED_SLASHES|JSON_THROW_ON_ERROR)
                ===$input['contract'],422);
        P::uuid($contract['operationId']);
        $domain="pb3.matrix-binding.v1\n".$input['contract'];
        abort_unless(P::verify($account->account_spki,$domain,$input['accountSignature'])
            &&P::verify($device->signing_spki,$domain,$input['deviceSignature']),401);

        // Do not persist or disclose the token or the remote response body.
        try {
            $response=Http::withoutRedirecting()
                ->connectTimeout(2)->timeout(5)
                ->withToken($input['accessToken'])
                ->acceptJson()->get($homeserver.'/_matrix/client/v3/account/whoami');
        } catch (\Throwable) {abort(503,'matrix.identity_unavailable');}
        abort_unless($response->ok(),401);
        try{$who=$response->json();}
        catch(\Throwable){abort(401);}
        abort_unless(is_array($who)
            &&($who['user_id']??null)===$contract['matrixUserId']
            &&($who['device_id']??null)===$contract['matrixDeviceId']
            &&($who['is_guest']??false)===false,401);
        $digest=hash('sha256',$input['contract']);

        try {
            return DB::transaction(function () use ($account,$device,$contract,$input,$homeserver,$digest) {
                DB::table('identity_accounts')->where('id',$account->id)
                    ->lockForUpdate()->first();
                $oldAccount=DB::table('matrix_account_bindings_v1')
                    ->where('account_id',$account->id)->first();
                if ($oldAccount) {
                    abort_unless($oldAccount->homeserver_url===$homeserver
                        &&$oldAccount->matrix_user_id===$contract['matrixUserId'],409);
                } else {
                    abort_if(DB::table('matrix_account_bindings_v1')
                        ->where('homeserver_url',$homeserver)
                        ->where('matrix_user_id',$contract['matrixUserId'])
                        ->exists(),409);
                    DB::table('matrix_account_bindings_v1')->insert([
                        'account_id'=>$account->id,
                        'homeserver_url'=>$homeserver,
                        'matrix_user_id'=>$contract['matrixUserId'],
                        'created_at'=>now(),'updated_at'=>now(),
                    ]);
                }
                $old=DB::table('matrix_device_bindings_v1')
                    ->where('pb3_device_id',$device->id)->first();
                if ($old) {
                    abort_unless($old->account_id===$account->id
                        &&hash_equals($old->contract_hash,$digest)
                        &&hash_equals($old->account_signature,$input['accountSignature'])
                        &&hash_equals($old->device_signature,$input['deviceSignature']),409);
                    return $this->sync->json(['bound'=>true,'unchanged'=>true]);
                }
                abort_if(DB::table('matrix_device_bindings_v1')
                    ->where('account_id',$account->id)
                    ->where('matrix_device_id',$contract['matrixDeviceId'])->exists(),409);
                DB::table('matrix_device_bindings_v1')->insert([
                    'pb3_device_id'=>$device->id,'account_id'=>$account->id,
                    'matrix_device_id'=>$contract['matrixDeviceId'],
                    'operation_id'=>$contract['operationId'],
                    'contract_hash'=>$digest,'contract_json'=>$input['contract'],
                    'account_signature'=>$input['accountSignature'],
                    'device_signature'=>$input['deviceSignature'],
                    'created_at'=>now(),'updated_at'=>now(),
                ]);
                return $this->sync->json(['bound'=>true,'unchanged'=>false],201);
            },3);
        } catch(QueryException $e) {
            if (in_array((string)$e->getCode(),['23000','23505'],true))
                abort(409,'matrix.binding_conflict');
            throw $e;
        }
    }
}
