<?php
declare(strict_types=1);

use App\Http\Controllers\IdentityController;
use App\Http\Controllers\PhotoSyncController;
use App\Http\Controllers\MediaV1Controller;
use App\Http\Controllers\MediaGrantController;
use App\Http\Controllers\MediaRevisionController;
use App\Http\Controllers\RecipientKeyController;
use App\Http\Controllers\PhotoGrantController;
use App\Http\Controllers\AssignmentV1Controller;
use App\Http\Controllers\AssignmentMediaSubmissionController;
use App\Photo\Finalization;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Route;

Route::get('/api/healthz', static fn()=>response()->json(['status'=>'ok']));
Route::get('/api/readyz', static function(){
 try { DB::select('SELECT 1'); return response()->json(['status'=>'ready']); }
 catch (Throwable) { return response()->json(['status'=>'unavailable'],503); }
});

// Laravel 'web' middleware supplies encrypted sessions and CSRF.
// Mutating calls additionally check the exact browser Origin in the controllers.
// No pairing or password reset route: new devices require the Recovery Key.
Route::prefix('identity/v2')->middleware('throttle:40,1')->group(function(){
    Route::get('/csrf',[IdentityController::class,'csrf']);
    Route::post('/prepare',[IdentityController::class,'prepare']);
    Route::post('/challenges',[IdentityController::class,'challenge']);
    Route::post('/proof',[IdentityController::class,'proof']);
    Route::get('/recovery/{locator}',[IdentityController::class,'recovery'])
      ->where('locator','[A-Za-z0-9_-]{22}');
    Route::get('/me',[IdentityController::class,'me']);
    Route::get('/time',[IdentityController::class,'time']);
    Route::post('/logout',[IdentityController::class,'logout']);
    Route::get('/devices',[IdentityController::class,'devices']);
});

Route::prefix('photos/v1')->middleware('throttle:120,1')->group(function(){
    Route::get('/',[PhotoSyncController::class,'index']);
    Route::post('/reserve',[PhotoSyncController::class,'reserve']);
    Route::put('/{photoId}/objects/{assetId}',[PhotoSyncController::class,'upload'])
      ->whereUuid('photoId')->whereUuid('assetId');
    Route::get('/{photoId}/objects/{assetId}',[PhotoSyncController::class,'read'])
      ->whereUuid('photoId')->whereUuid('assetId');
    Route::post('/{photoId}/finalize',static function(
        \Illuminate\Http\Request $r,string $photoId, Finalization $finalization
    ){return response()->json($finalization->finalize($r,$photoId))->header('Cache-Control','no-store');})
      ->whereUuid('photoId');
    Route::get('/{photoId}/receipt',[PhotoSyncController::class,'receipt'])->whereUuid('photoId');
    Route::get('/{photoId}/manifests',[PhotoSyncController::class,'manifests'])->whereUuid('photoId');
});


// P1-10: E2EE personal photo/video/audio files with idempotent ciphertext
// chunk upload. No browser S3 credentials, public download or grant endpoints.
Route::prefix('media/v1')->middleware('throttle:pb3-media')->group(function(){
    Route::get('/',[MediaV1Controller::class,'index']);
    Route::post('/reserve',[MediaV1Controller::class,'reserve']);
    Route::post('/revisions',[MediaRevisionController::class,'create']);
    Route::get('/{rootMediaId}/revisions',[MediaRevisionController::class,'index'])
        ->whereUuid('rootMediaId');
    Route::put('/{mediaId}/chunks/{chunkId}',[MediaV1Controller::class,'upload'])
        ->whereUuid('mediaId')->whereUuid('chunkId');
    Route::get('/{mediaId}/chunks/{chunkId}',[MediaV1Controller::class,'read'])
        ->whereUuid('mediaId')->whereUuid('chunkId');
    Route::post('/{mediaId}/finalize',[MediaV1Controller::class,'finalize'])
        ->whereUuid('mediaId');
    Route::get('/{mediaId}/manifests',[MediaV1Controller::class,'manifests'])
        ->whereUuid('mediaId');
});

// P1-11: independently fingerprint-confirmed media recipient grants.
// No implicit access from contacts, team membership or assignment invite.
Route::prefix('media-shares/v1')->middleware('throttle:pb3-media')->group(function(){
    Route::get('/received',[MediaGrantController::class,'received']);
    Route::post('/grants',[MediaGrantController::class,'create']);
    Route::get('/grants/{grantId}',[MediaGrantController::class,'show'])
        ->whereUuid('grantId');
    Route::get('/grants/{grantId}/chunks/{chunkId}',[MediaGrantController::class,'read'])
        ->whereUuid('grantId')->whereUuid('chunkId');
    Route::post('/grants/{grantId}/revoke',[MediaGrantController::class,'revoke'])
        ->whereUuid('grantId');
});

// P1-03: all endpoints require an enrolled identity; mutating calls also
// require exact Origin + Laravel CSRF and signed root-account commands.
Route::prefix('shares/v1')->middleware('throttle:40,1')->group(function(){
    Route::get('/keys/me',[RecipientKeyController::class,'mine']);
    Route::post('/keys',[RecipientKeyController::class,'publish']);
    Route::get('/keys/{accountId}',[RecipientKeyController::class,'show'])->whereUuid('accountId');
    Route::get('/received',[PhotoGrantController::class,'received']);
    Route::post('/grants',[PhotoGrantController::class,'create']);
    Route::get('/grants/{grantId}',[PhotoGrantController::class,'show'])->whereUuid('grantId');
    Route::get('/grants/{grantId}/objects/{assetId}',[PhotoGrantController::class,'read'])
       ->whereUuid('grantId')->whereUuid('assetId');
    Route::post('/grants/{grantId}/revoke',[PhotoGrantController::class,'revoke'])->whereUuid('grantId');
});


// P1-04: signed, encrypted assignment + explicit recipient consent.
// No grants arise automatically from contacts or team membership.
Route::prefix('assignments/v1')->middleware('throttle:pb3-assignments')->group(function(){
    Route::get('/',[AssignmentV1Controller::class,'index']);
    Route::get('/usage',[AssignmentV1Controller::class,'usage']);
    Route::post('/',[AssignmentV1Controller::class,'create']);
    Route::get('/invites/received',[AssignmentV1Controller::class,'inbox']);
    Route::post('/{assignmentId}/state',[AssignmentV1Controller::class,'changeState'])->whereUuid('assignmentId');
    Route::post('/{assignmentId}/policy',[AssignmentV1Controller::class,'changePolicy'])->whereUuid('assignmentId');
    Route::get('/{assignmentId}/policy-history',[AssignmentV1Controller::class,'policyHistory'])->whereUuid('assignmentId');
    Route::post('/{assignmentId}/private',[AssignmentV1Controller::class,'changePrivateText'])->whereUuid('assignmentId');
    Route::get('/{assignmentId}/private-history',[AssignmentV1Controller::class,'privateTextHistory'])->whereUuid('assignmentId');
    Route::post('/{assignmentId}/invites',[AssignmentV1Controller::class,'invite'])->whereUuid('assignmentId');
    Route::post('/{assignmentId}/invites/{inviteId}/accept',
        [AssignmentV1Controller::class,'accept'])->whereUuid('assignmentId')->whereUuid('inviteId');
    Route::post('/{assignmentId}/submissions',[AssignmentV1Controller::class,'submit'])->whereUuid('assignmentId');
    Route::get('/{assignmentId}/submissions',[AssignmentV1Controller::class,'submissions'])->whereUuid('assignmentId');
    Route::post('/{assignmentId}/media-submissions',
        [AssignmentMediaSubmissionController::class,'create'])->whereUuid('assignmentId');
    Route::get('/{assignmentId}/media-submissions',
        [AssignmentMediaSubmissionController::class,'index'])->whereUuid('assignmentId');
});
