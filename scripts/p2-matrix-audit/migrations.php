<?php
declare(strict_types=1);
// ONLY the isolated audit DB. Does not use PHPUnit RefreshDatabase or reset data.
require '/app/vendor/autoload.php';
$app=require '/app/bootstrap/app.php';
$app->make(Illuminate\Contracts\Console\Kernel::class)->bootstrap();
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;
if(config('database.connections.pgsql.database')!=='pb3_audit')throw new RuntimeException('Wrong DB');
$files=['2026_11_11_000001_create_matrix_bindings_v1.php','2026_11_11_000002_create_matrix_recovery_escrows_v1.php'];
$tables=['matrix_account_bindings_v1','matrix_device_bindings_v1','matrix_recovery_escrows_v1'];
$snapshot=static function()use($tables){
 $out=[];
 foreach($tables as $t)$out[$t]=hash('sha256',json_encode(DB::table($t)->get()->toArray(),JSON_THROW_ON_ERROR));
 return $out;
};
$populated=DB::table($tables[0])->exists();
if(!$populated){
 foreach(array_reverse($files) as $f)(require '/app/database/migrations/'.$f)->down();
 foreach($files as $f)(require '/app/database/migrations/'.$f)->up();
 echo json_encode(['status'=>'PASS','case'=>'empty Matrix down/up','tablesRestored'=>count(array_filter($tables,fn($t)=>Schema::hasTable($t)))],JSON_THROW_ON_ERROR),"\n";
}else{
 $before=$snapshot();$guards=[];
 foreach(array_reverse($files) as $f){
  try{(require '/app/database/migrations/'.$f)->down();throw new RuntimeException('Expected guard missing');}
  catch(RuntimeException $e){if(!str_ends_with($e->getMessage(),'rollback_forbidden'))throw $e;$guards[]=$e->getMessage();}
 }
 if($before!==$snapshot())throw new RuntimeException('Live escrow changed');
 echo json_encode(['status'=>'PASS','case'=>'populated rollback refuses both','guards'=>$guards,'rowsAndCiphertextPreserved'=>true,'postgres'=>DB::selectOne('show server_version')->server_version],JSON_THROW_ON_ERROR),"\n";
}
