<?php
declare(strict_types=1);

namespace App\Http\Controllers;

use App\Assignments\AssignmentContract as C;
use App\Photo\PhotoSync;
use App\Identity\Protocol as P;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;

/**
 * Owner-signed archive preference CAS. These flags express USER intent, not
 * operator permission to run GC or modify source media TTL.
 */
final class BrowserArchivePreferencesController extends Controller
{
    private const DOMAIN='pb3.browser-archive-preferences.v1';
    private const FIELDS=[
        'version','accountId','writerDeviceId','operationId',
        'expectedRevision','useArchive','autoDeleteAfter7Days',
    ];

    public static function settings(string $accountId):array
    {
        $r=DB::table('browser_archive_preferences_v1')
            ->where('account_id',$accountId)->first();
        return [
            'revision'=>$r?(int)$r->revision:0,
            'useArchive'=>$r?(bool)$r->use_archive:true,
            'autoDeleteAfter7Days'=>$r?(bool)$r->auto_delete_after_7_days:true,
        ];
    }

    public function show(Request $request)
    {
        [$account]=$this->identity->actor($request);
        return $this->identity->json(self::settings($account->id)+[
            'writeEnabled'=>(bool)config('browser_archive.write_enabled',false),
            'autoCleanupEnabled'=>(bool)config('browser_archive.auto_cleanup_enabled',false),
        ]);
    }

    public function __construct(private readonly PhotoSync $identity) {}

    public function update(Request $request)
    {
        $this->identity->origin($request);
        [$account,$device]=$this->identity->actor($request);
        $body=P::exact($request->json()->all(),['contract','signature']);
        abort_unless(is_string($body['contract'])
            &&is_string($body['signature']),422);
        $c=C::signed($body['contract'],$body['signature'],
            $account->account_spki,self::DOMAIN,self::FIELDS,10000);
        abort_unless($c['version']===1
            &&$c['accountId']===$account->id
            &&$c['writerDeviceId']===$device->id
            &&is_int($c['expectedRevision'])&&$c['expectedRevision']>=0
            &&$c['expectedRevision']<100000000
            &&is_bool($c['useArchive'])
            &&is_bool($c['autoDeleteAfter7Days']),422);
        foreach(['accountId','writerDeviceId','operationId'] as $name)
            C::uuid($c,$name);
        $hash=hash('sha256',$body['contract']);

        return DB::transaction(function()use($account,$device,$body,$c,$hash){
            $owner=DB::table('identity_accounts')->where('id',$account->id)
                ->lockForUpdate()->first();
            abort_unless($owner&&$owner->status==='ready',401);
            $event=DB::table('browser_archive_preference_events_v1')
                ->where('operation_id',$c['operationId'])->first();
            if($event){
                abort_unless($event->account_id===$account->id
                    &&hash_equals($event->contract_hash,$hash)
                    &&hash_equals($event->account_signature,$body['signature']),409);
                return $this->identity->json([
                    'revision'=>(int)$event->to_revision,
                    'useArchive'=>$c['useArchive'],
                    'autoDeleteAfter7Days'=>$c['autoDeleteAfter7Days'],
                    'unchanged'=>true,
                ]);
            }
            $prior=DB::table('browser_archive_preferences_v1')
                ->where('account_id',$account->id)->lockForUpdate()->first();
            $revision=$prior?(int)$prior->revision:0;
            abort_unless($revision===$c['expectedRevision'],409);
            $next=$revision+1;
            $row=[
                'revision'=>$next,
                'use_archive'=>$c['useArchive'],
                'auto_delete_after_7_days'=>$c['autoDeleteAfter7Days'],
                'operation_id'=>$c['operationId'],
                'updated_at'=>now(),
            ];
            if($prior)DB::table('browser_archive_preferences_v1')
                ->where('account_id',$account->id)->update($row);
            else DB::table('browser_archive_preferences_v1')->insert([
                'account_id'=>$account->id,...$row,'created_at'=>now(),
            ]);
            DB::table('browser_archive_preference_events_v1')->insert([
                'operation_id'=>$c['operationId'],'account_id'=>$account->id,
                'writer_device_id'=>$device->id,
                'from_revision'=>$revision,'to_revision'=>$next,
                'contract_hash'=>$hash,'contract_json'=>$body['contract'],
                'account_signature'=>$body['signature'],'created_at'=>now(),
            ]);

            // Preference OFF does not destroy existing archive rows: it
            // merely disables the optional day-7 deadline. Source asset TTL
            // and existing tombstones continue independently.
            if(!$c['autoDeleteAfter7Days']){
                DB::table('browser_archive_entries_v1')
                    ->where('account_id',$account->id)->where('state','archived')
                    ->update(['archive_until_ms'=>null,'updated_at'=>now()]);
            }elseif(!$prior||!$prior->auto_delete_after_7_days){
                // Re-enable from this signed user action. Do not change
                // immutable asset TTL or revive any deleting object.
                $now=PhotoSync::nowMs();
                $cap=$now+((int)config('browser_archive.archive_days',7))*86400000;
                $entries=DB::table('browser_archive_entries_v1')
                    ->where('account_id',$account->id)->where('state','archived')
                    ->get(['id','asset_expires_at_ms']);
                foreach($entries as $entry){
                    DB::table('browser_archive_entries_v1')
                        ->where('id',$entry->id)->update([
                            'archive_until_ms'=>min($cap,(int)$entry->asset_expires_at_ms),
                            'updated_at'=>now(),
                        ]);
                }
            }
            return $this->identity->json([
                'revision'=>$next,'useArchive'=>$c['useArchive'],
                'autoDeleteAfter7Days'=>$c['autoDeleteAfter7Days'],
                'unchanged'=>false,
            ],201);
        },3);
    }
}
