<?php
use Illuminate\Contracts\Console\Kernel;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Storage;
use Illuminate\Support\Str;
require '/app/vendor/autoload.php';
$app=require '/app/bootstrap/app.php';$app->make(Kernel::class)->bootstrap();
if(config('database.default')!=='pgsql'||config('database.connections.pgsql.database')!=='pb3_upgrade_audit'
 ||config('database.connections.pgsql.host')!=='127.0.0.1'||config('filesystems.disks.ciphertext.bucket')!=='pb3-ci-p0')throw new RuntimeException('unsafe upgrade fixture');
$fixture='/audit/upgrade-private.json';$disk=Storage::disk('ciphertext');
if(($argv[1]??'')==='seed'){
 if(is_file($fixture))throw new RuntimeException('refuse overwrite');
 $a=(string)Str::uuid();$d=(string)Str::uuid();$p=(string)Str::uuid();$asset=(string)Str::uuid();$assignment=(string)Str::uuid();$location=(string)Str::uuid();$now=now();
 $bytes=random_bytes(4096);$sha=hash('sha256',$bytes);$key='cipher/v1/'.$a.'/'.$p.'/'.$asset;
 DB::table('identity_accounts')->insert(['id'=>$a,'operation_id'=>(string)Str::uuid(),'prepare_hash'=>str_repeat('a',64),'status'=>'ready','reserved_until'=>now()->addDay(),'created_at'=>$now,'updated_at'=>$now]);
 DB::table('identity_devices')->insert(['id'=>$d,'account_id'=>$a,'signing_spki'=>'synthetic-upgrade-only','created_at'=>$now,'updated_at'=>$now]);
 DB::table('photo_records')->insert(['id'=>$p,'account_id'=>$a,'device_id'=>$d,'operation_id'=>(string)Str::uuid(),'state'=>'active','expires_at'=>now()->addDays(2)->getTimestampMs(),'contract_hash'=>str_repeat('c',64),'contract_json'=>'{}','signature'=>'synthetic-upgrade-only','created_at'=>$now,'updated_at'=>$now]);
 DB::table('photo_objects')->insert(['id'=>$asset,'photo_id'=>$p,'kind'=>'master','revision'=>1,'bytes'=>strlen($bytes),'sha256'=>$sha,'manifest_json'=>'{}','object_key'=>$key,'state'=>'active','created_at'=>$now,'updated_at'=>$now]);
 DB::table('storage_locations')->insert(['id'=>$location,'asset_id'=>$asset,'provider'=>'app_s3','object_key'=>$key,'bytes'=>strlen($bytes),'sha256'=>$sha,'state'=>'verified','created_at'=>$now,'updated_at'=>$now]);
 DB::table('assignment_records_v1')->insert(['id'=>$assignment,'owner_account_id'=>$a,'operation_id'=>(string)Str::uuid(),'contract_hash'=>str_repeat('d',64),'contract_json'=>'{}','owner_signature'=>'synthetic-upgrade-only','private_envelope_json'=>'{}','state'=>'active','starts_at'=>$now->getTimestampMs(),'created_at'=>$now,'updated_at'=>$now]);
 if(!$disk->put($key,$bytes))throw new RuntimeException('put failed');
 $rows=[];
 foreach(['identity_accounts'=>$a,'identity_devices'=>$d,'photo_records'=>$p,'photo_objects'=>$asset,'storage_locations'=>$location,'assignment_records_v1'=>$assignment] as $table=>$id){
  $row=(array)DB::table($table)->where('id',$id)->first();$rows[$table]=['id'=>$id,'columns'=>array_keys($row),'hash'=>hash('sha256',json_encode($row))];
 }
 file_put_contents($fixture,json_encode(['rows'=>$rows,'key'=>$key,'sha'=>$sha,'assignment'=>$assignment]));
 echo "Seeded 6 original main rows + real Garage object; synthetic bytes, not crypto attestation\n";
}else{
 $f=json_decode(file_get_contents($fixture),true,32,JSON_THROW_ON_ERROR);
 foreach($f['rows'] as $table=>$saved){
  $row=(array)DB::table($table)->select($saved['columns'])->where('id',$saved['id'])->first();
  if(hash('sha256',json_encode($row))!==$saved['hash'])throw new RuntimeException('changed old row '.$table);
 }
 if(hash('sha256',$disk->get($f['key']))!==$f['sha'])throw new RuntimeException('lost object');
 $row=DB::table('assignment_creation_meter_v1')->where('assignment_id',$f['assignment'])->first();
 $original=DB::table('assignment_records_v1')->where('id',$f['assignment'])->first();
 if(!$row||$row->owner_account_id!==$original->owner_account_id||$row->operation_id!==$original->operation_id||$row->created_at!==$original->created_at)throw new RuntimeException('invalid meter backfill');
 echo "PASS: 6/6 original rows unchanged, stable IDs/expiry/signature/envelope/reference, real Garage SHA preserved, assignment meter backfill correct\n";
}
