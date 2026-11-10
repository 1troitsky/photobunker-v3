<?php
declare(strict_types=1);
require __DIR__.'/vendor/autoload.php';
$app=require __DIR__.'/bootstrap/app.php';
$app->make(Illuminate\Contracts\Console\Kernel::class)->bootstrap();
use Illuminate\Support\Facades\DB;
use Illuminate\Http\Request;
use Symfony\Component\HttpKernel\Exception\HttpExceptionInterface;

if(!app()->environment('testing')||DB::connection()->getDriverName()!=='pgsql'
    ||config('database.connections.pgsql.host')!=='127.0.0.1')
    throw new RuntimeException('Disposable local PostgreSQL only');
$mode=$argv[1]??'';
$scope=json_decode(file_get_contents(__DIR__.'/audit-scope.json'),true,32,JSON_THROW_ON_ERROR);
$team=DB::table('team_records_v1')->where('id',$scope['teamId'])
    ->where('owner_account_id',$scope['ownerAccountId'])->first();
if(!$team)throw new RuntimeException('Missing owned synthetic fixture');
if($mode==='hold'){
    DB::beginTransaction();
    try{
        DB::table('team_records_v1')->where('id',$team->id)->lockForUpdate()->first();
        file_put_contents(__DIR__.'/audit-lock-ready','ready');
        $deadline=microtime(true)+12;
        while(!is_file(__DIR__.'/audit-lock-release')){
            if(microtime(true)>$deadline)throw new RuntimeException('Bounded fixture lock timed out');
            usleep(10000);
        }
    }finally{DB::rollBack();}
    echo "released\n";exit;
}
if($mode==='waiters'){
    $row=DB::selectOne("SELECT count(*) AS n FROM pg_stat_activity WHERE datname=current_database() AND wait_event_type='Lock' AND query LIKE '%team_records_v1%'");
    echo json_encode(['waiters'=>(int)$row->n])."\n";exit;
}
if($mode==='tie-role-time'){
    $invite=DB::table('team_invites_v2')->where('id',$scope['inviteId'])->first();
    $event=DB::table('team_membership_events_v1')->where('team_id',$team->id)
        ->where('target_account_id',$scope['recipientAccountId'])->where('action','change_role')
        ->where('invite_id','!=',$invite->id)->orderByDesc('to_revision')->first();
    if(!$event||!$invite->accepted_at)throw new RuntimeException('Missing genuine prior signed role');
    file_put_contents(__DIR__.'/audit-role-original.json',json_encode(['id'=>$event->operation_id,'created_at'=>$event->created_at],JSON_THROW_ON_ERROR));
    DB::table('team_membership_events_v1')->where('operation_id',$event->operation_id)->update(['created_at'=>$invite->accepted_at]);
    echo json_encode(['sameTimestamp'=>true,'signedContractPreserved'=>true,'oldInvite'=>true])."\n";exit;
}
if($mode==='restore-role-time'){
    $old=json_decode(file_get_contents(__DIR__.'/audit-role-original.json'),true,8,JSON_THROW_ON_ERROR);
    DB::table('team_membership_events_v1')->where('operation_id',$old['id'])->update(['created_at'=>$old['created_at']]);
    echo "restored\n";exit;
}
if($mode==='snapshot'){
    $counts=[];
    foreach(['photo_access_grants','media_recipient_grants_v1','assignment_invites_v1']as $table)
        $counts[$table]=DB::table($table)->where('owner_account_id',$scope['ownerAccountId'])->count();
    $current=DB::table('team_records_v1')->where('id',$team->id)->first();
    echo json_encode(['keyEpoch'=>(int)$current->key_epoch,'quarantined'=>(bool)$current->rotation_required,
        'epochRecords'=>DB::table('team_key_epochs_v1')->where('team_id',$team->id)->count(),
        'pendingV2'=>DB::table('team_invites_v2')->where('team_id',$team->id)->where('state','pending')->count(),
        'implicitGrants'=>$counts],JSON_THROW_ON_ERROR)."\n";exit;
}
if(!in_array($mode,['rotate','accept'],true))throw new RuntimeException('Unknown fixture mode');
$owner=$mode==='rotate';
$actor=$scope[$owner?'ownerAccountId':'recipientAccountId'];
$device=$scope[$owner?'ownerDeviceId':'recipientDeviceId'];
$payload=$scope[$owner?'rotation':'consent'];
$url=$owner?'/teams/v1/'.$team->id.'/epoch':'/teams/v2/'.$team->id.'/invites/'.$scope['inviteId'].'/accept';
$request=Request::create($url,'POST',[],[],[],[
    'CONTENT_TYPE'=>'application/json','HTTP_ACCEPT'=>'application/json','HTTP_ORIGIN'=>config('app.url'),
],json_encode($payload,JSON_THROW_ON_ERROR));
$session=new Illuminate\Session\Store('audit',new Illuminate\Session\ArraySessionHandler(120));
$session->put(['identity_account'=>$actor,'identity_device'=>$device,'identity_issued'=>time()]);
$request->setLaravelSession($session);
try{
    $controller=$app->make($owner?App\Http\Controllers\TeamKeyEpochController::class:App\Http\Controllers\TeamEpochInvitationController::class);
    $response=$owner?$controller->rotate($request,$team->id):$controller->accept($request,$team->id,$scope['inviteId']);
    $status=$response->getStatusCode();
}catch(HttpExceptionInterface $e){$status=$e->getStatusCode();}
echo json_encode(['status'=>$status],JSON_THROW_ON_ERROR)."\n";
