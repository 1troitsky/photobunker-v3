<?php
declare(strict_types=1);
require __DIR__.'/vendor/autoload.php';
$app=require __DIR__.'/bootstrap/app.php';
$app->make(Illuminate\Contracts\Console\Kernel::class)->bootstrap();
$input=json_decode(file_get_contents(__DIR__.'/audit-media422.json'),true,32,JSON_THROW_ON_ERROR);
$c=json_decode($input['contract'],true,32,JSON_THROW_ON_ERROR);
$class=new ReflectionClass(App\Http\Controllers\MediaGrantController::class);
$object=$class->newInstanceWithoutConstructor();
$method=$class->getMethod('contract');$results=[];
foreach([-3,3]as $offset){
    Illuminate\Support\Carbon::setTestNow(Illuminate\Support\Carbon::createFromTimestampMs($c['expiresAt']-86400000+$offset));
    try{$method->invoke($object,$input['contract']);$status=200;}
    catch(Symfony\Component\HttpKernel\Exception\HttpExceptionInterface $e){$status=$e->getStatusCode();}
    $results[]=['serverOffsetFromClientGrantCreationMs'=>$offset,'contractValidationStatus'=>$status];
}
Illuminate\Support\Carbon::setTestNow();
echo json_encode(['contractSha256'=>hash('sha256',$input['contract']),'sameHistoricalBytes'=>true,
    'controlledClockResults'=>$results,'limit'=>'Contract validator only; historical server millisecond clock was not recorded.'],JSON_THROW_ON_ERROR)."\n";
if(array_column($results,'contractValidationStatus')!==[422,200])exit(1);
