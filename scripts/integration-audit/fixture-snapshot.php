<?php
declare(strict_types=1);
if(getenv('APP_ENV')!=='testing'||getenv('DB_DATABASE')!=='pb3_ci_p0'||getenv('PB3_ISOLATED_STORAGE_SMOKE')!=='1')exit(1);
require 'vendor/autoload.php';$app=require 'bootstrap/app.php';$app->make(Illuminate\Contracts\Console\Kernel::class)->bootstrap();
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;
$out=[];
foreach(['photo_access_grants','media_recipient_grants_v1','photo_records','photo_objects','storage_locations','media_files_v1','media_chunks_v1','media_chunk_locations_v1'] as $table){
 $rows=DB::table($table)->orderBy('id')->get()->map(function($row){$a=(array)$row;unset($a['assignment_id']);return $a;})->all();
 $entry=['count'=>count($rows),'stableRowsSha256'=>hash('sha256',json_encode($rows,JSON_THROW_ON_ERROR))];
 if(in_array($table,['photo_access_grants','media_recipient_grants_v1'],true)){
  $entry['assignmentColumn']=Schema::hasColumn($table,'assignment_id');
  $entry['scopeNullCount']=$entry['assignmentColumn']?DB::table($table)->whereNull('assignment_id')->count():null;
 }
 $out[$table]=$entry;
}
echo json_encode($out,JSON_THROW_ON_ERROR),PHP_EOL;
