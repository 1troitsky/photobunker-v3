<?php
declare(strict_types=1);
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Route;
// Do not expose account, media, or admin APIs until their security flows are implemented.
Route::get('/api/healthz', static fn()=>response()->json(['status'=>'ok']));
Route::get('/api/readyz', static function(){
 try { DB::select('SELECT 1'); return response()->json(['status'=>'ready']); }
 catch (Throwable) {return response()->json(['status'=>'unavailable'],503);}
});
