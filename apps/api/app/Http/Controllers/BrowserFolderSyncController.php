<?php
declare(strict_types=1);

namespace App\Http\Controllers;

use App\Assignments\AssignmentContract as C;
use App\Identity\Protocol as P;
use App\Photo\PhotoSync;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;

/**
 * Signed revision-CAS transport for one account's opaque encrypted folder tree.
 * GET is limited to an authenticated owner device. Nothing is decrypted here.
 * Both writes and replays are account bound and signed by account P-256 key.
 */
final class BrowserFolderSyncController extends Controller
{
    private const DOMAIN='pb3.browser-folders.v1';
    private const FIELDS=[
        'version','accountId','writerDeviceId','operationId','fromRevision',
        'toRevision','keyRevision','envelope',
    ];

    public function __construct(private readonly PhotoSync $identity) {}

    public function show(Request $request)
    {
        [$account]=$this->identity->actor($request);
        $row=DB::table('browser_folder_snapshots_v1')
            ->where('account_id',$account->id)->first();
        if(!$row)return $this->identity->json([
            'revision'=>0,'contract'=>null,'signature'=>null,
        ]);
        return $this->identity->json([
            'revision'=>(int)$row->revision,
            'contract'=>$row->contract_json,
            'signature'=>$row->account_signature,
        ]);
    }

    /**
     * Authenticated, account-scoped immutable history to verify the exact
     * common ancestor for three-way E2EE merge on the client. The server
     * never sees folder names or decrypted file membership.
     */
    public function revision(Request $request,string $revision)
    {
        [$account]=$this->identity->actor($request);
        abort_unless(ctype_digit($revision)
            &&preg_match('/^[1-9][0-9]{0,7}$/D',$revision)===1,422);
        $row=DB::table('browser_folder_events_v1')
            ->where('account_id',$account->id)
            ->where('to_revision',(int)$revision)->first();
        abort_unless($row,404);
        return $this->identity->json([
            'revision'=>(int)$row->to_revision,
            'contract'=>$row->contract_json,
            'signature'=>$row->account_signature,
        ]);
    }

    /** Validate base64url without invoking P::b64's 8 KiB protocol limit. */
    private static function encryptedBytes(mixed $value):string
    {
        abort_unless(is_string($value)&&strlen($value)>=22
            &&strlen($value)<=160100
            &&preg_match('/^[A-Za-z0-9_-]+$/D',$value)===1,422);
        $decoded=base64_decode(strtr($value,'-_','+/')
            .str_repeat('=',(4-strlen($value)%4)%4),true);
        abort_unless($decoded!==false && strlen($decoded)>=16
            &&strlen($decoded)<=120016
            &&P::encode($decoded)===$value,422);
        return $decoded;
    }

    public function store(Request $request)
    {
        $this->identity->origin($request);
        [$account,$device]=$this->identity->actor($request);
        $body=P::exact($request->json()->all(),['contract','signature']);
        abort_unless(is_string($body['contract'])
            &&is_string($body['signature']),422);
        $d=C::signed($body['contract'],$body['signature'],
            $account->account_spki,self::DOMAIN,self::FIELDS,190000);
        abort_unless($d['version']===1
            &&$d['accountId']===$account->id
            &&$d['writerDeviceId']===$device->id
            &&is_int($d['fromRevision'])&&$d['fromRevision']>=0
            &&$d['fromRevision']<100000000
            &&is_int($d['toRevision'])&&$d['toRevision']===$d['fromRevision']+1
            &&is_int($d['keyRevision'])&&$d['keyRevision']>=1
            &&$d['keyRevision']<100000000,422);
        C::uuid($d,'accountId');
        C::uuid($d,'writerDeviceId');
        C::uuid($d,'operationId');
        $env=$d['envelope'];
        abort_unless(is_array($env)&&!array_is_list($env),422);
        P::exact($env,['version','iv','ciphertext','wrappedKey']);
        abort_unless($env['version']===1
            &&is_string($env['iv'])
            &&is_string($env['ciphertext'])
            &&is_array($env['wrappedKey'])
            &&!array_is_list($env['wrappedKey']),422);
        P::exact($env['wrappedKey'],['iv','ciphertext']);
        abort_unless(is_string($env['wrappedKey']['iv']??null)
            &&is_string($env['wrappedKey']['ciphertext']??null),422);
        P::b64($env['iv'],12);
        P::b64($env['wrappedKey']['iv'],12);
        P::b64($env['wrappedKey']['ciphertext'],48);
        self::encryptedBytes($env['ciphertext']);
        $hash=hash('sha256',$body['contract']);

        return DB::transaction(function()use($account,$device,$body,$d,$hash){
            // Serialize account writers and accept same signed op after Lost ACK.
            $lockedAccount=DB::table('identity_accounts')
                ->where('id',$account->id)->lockForUpdate()->first();
            abort_unless($lockedAccount && $lockedAccount->status==='ready',401);
            $already=DB::table('browser_folder_events_v1')
                ->where('operation_id',$d['operationId'])->first();
            if($already){
                abort_unless($already->account_id===$account->id
                    &&hash_equals($already->contract_hash,$hash)
                    &&hash_equals($already->account_signature,$body['signature']),409);
                return $this->identity->json([
                    'revision'=>(int)$already->to_revision,'unchanged'=>true,
                ]);
            }
            // An old device may not publish a snapshot under a stale AKEK
            // after signed Recovery Key rotation. Exact logged Lost ACK
            // replays remain accepted ABOVE this check.
            abort_unless($d['keyRevision']===(int)$lockedAccount->revision,409);
            $current=DB::table('browser_folder_snapshots_v1')
                ->where('account_id',$account->id)->lockForUpdate()->first();
            $revision=$current?(int)$current->revision:0;
            abort_unless($revision===$d['fromRevision'],409);
            $record=[
                'revision'=>$d['toRevision'],
                'key_revision'=>$d['keyRevision'],
                'writer_device_id'=>$device->id,
                'operation_id'=>$d['operationId'],
                'contract_hash'=>$hash,
                'contract_json'=>$body['contract'],
                'account_signature'=>$body['signature'],
                'updated_at'=>now(),
            ];
            if($current){
                DB::table('browser_folder_snapshots_v1')
                    ->where('account_id',$account->id)->update($record);
            }else{
                DB::table('browser_folder_snapshots_v1')->insert([
                    'account_id'=>$account->id,...$record,'created_at'=>now(),
                ]);
            }
            DB::table('browser_folder_events_v1')->insert([
                'operation_id'=>$d['operationId'],
                'account_id'=>$account->id,
                'writer_device_id'=>$device->id,
                'from_revision'=>$d['fromRevision'],
                'to_revision'=>$d['toRevision'],
                'contract_hash'=>$hash,
                'contract_json'=>$body['contract'],
                'account_signature'=>$body['signature'],
                'created_at'=>now(),
            ]);
            return $this->identity->json([
                'revision'=>$d['toRevision'],'unchanged'=>false,
            ],201);
        },3);
    }
}
