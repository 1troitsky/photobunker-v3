<?php
declare(strict_types=1);

use App\Http\Controllers\IdentityController;
use App\Http\Controllers\NotificationEventsController;
use App\Http\Controllers\BillingV1Controller;
use App\Http\Controllers\BrowserFolderSyncController;
use App\Http\Controllers\BrowserArchiveController;
use App\Http\Controllers\BrowserArchivePreferencesController;
use App\Http\Controllers\PhotoSyncController;
use App\Http\Controllers\MediaV1Controller;
use App\Http\Controllers\MediaGrantController;
use App\Http\Controllers\MediaRevisionController;
use App\Http\Controllers\MediaFilePreviewPolicyController;
use App\Http\Controllers\RecipientKeyController;
use App\Http\Controllers\TeamV1Controller;
use App\Http\Controllers\TeamInvitationController;
use App\Http\Controllers\TeamMembershipController;
use App\Http\Controllers\TeamKeyEpochController;
use App\Http\Controllers\TeamEpochInvitationController;
use App\Http\Controllers\PhotoGrantController;
use App\Http\Controllers\AssignmentV1Controller;
use App\Http\Controllers\AssignmentPreviewCeilingController;
use App\Http\Controllers\SafeAssignmentEditorialLinkController;
use App\Http\Controllers\AssignmentMediaSubmissionController;
use App\Photo\Finalization;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Route;

Route::get('/api/healthz', static fn()=>response()->json(['status'=>'ok']));
Route::get('/api/readyz', static function(){
 try { DB::select('SELECT 1'); return response()->json(['status'=>'ready']); }
 catch (Throwable) { return response()->json(['status'=>'unavailable'],503); }
});

// Public, versioned plan definitions and strictly owner-scoped entitlements.
// Paid plan activation deliberately has NO browser route.
Route::prefix('billing/v1')->middleware('throttle:40,1')->group(function(){
    Route::get('/plans',[BillingV1Controller::class,'plans']);
    Route::get('/me',[BillingV1Controller::class,'me']);
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
    Route::post('/devices/{id}/revoke',[IdentityController::class,'revoke'])->whereUuid('id');
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

// P2: owner-only signed PREVIEW metadata ceilings. Never a public route,
// never a bearer token, never a wrapped DEK or an actual publication.
Route::prefix('media-file-preview/v1')->middleware('throttle:pb3-media')->group(function(){
    Route::post('/policies',[MediaFilePreviewPolicyController::class,'store']);
    Route::get('/policies/{safeMediaId}',[MediaFilePreviewPolicyController::class,'show'])
        ->whereUuid('safeMediaId');
});

// P2: authenticated owner-only signed EDITORIAL Safe→Assignment binding.
// No public URL, no anonymous access, no DEK and no contributor provenance.
Route::prefix('media-file-preview/v1/assignment-links')
    ->middleware('throttle:pb3-media')->group(function(){
    Route::post('/',[SafeAssignmentEditorialLinkController::class,'create']);
    Route::get('/{safeMediaId}',[SafeAssignmentEditorialLinkController::class,'show'])
        ->whereUuid('safeMediaId');
    Route::post('/{safeMediaId}/detach',
        [SafeAssignmentEditorialLinkController::class,'detach'])
        ->whereUuid('safeMediaId');
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
// Private owner-only future Public Card ceiling, never a publication URL.
Route::prefix('assignments/v1')->middleware('throttle:pb3-assignments')->group(function(){
    Route::get('/{assignmentId}/preview-ceiling',
        [AssignmentPreviewCeilingController::class,'show'])->whereUuid('assignmentId');
    Route::post('/{assignmentId}/preview-ceiling',
        [AssignmentPreviewCeilingController::class,'store'])->whereUuid('assignmentId');
});

Route::prefix('assignments/v1')->middleware('throttle:pb3-assignments')->group(function(){
    Route::get('/',[AssignmentV1Controller::class,'index']);
    Route::get('/usage',[AssignmentV1Controller::class,'usage']);
    Route::post('/',[AssignmentV1Controller::class,'create']);
    Route::get('/invites/received',[AssignmentV1Controller::class,'inbox']);
    Route::post('/{assignmentId}/state',[AssignmentV1Controller::class,'changeState'])->whereUuid('assignmentId');
    Route::post('/{assignmentId}/policy',[AssignmentV1Controller::class,'changePolicy'])->whereUuid('assignmentId');
    Route::get('/{assignmentId}/policy-history',[AssignmentV1Controller::class,'policyHistory'])->whereUuid('assignmentId');
    Route::post('/{assignmentId}/schedule',[AssignmentV1Controller::class,'changeSchedule'])->whereUuid('assignmentId');
    Route::get('/{assignmentId}/schedule-history',[AssignmentV1Controller::class,'scheduleHistory'])->whereUuid('assignmentId');
    Route::post('/{assignmentId}/retention',[AssignmentV1Controller::class,'changeRetention'])->whereUuid('assignmentId');
    Route::get('/{assignmentId}/retention-history',[AssignmentV1Controller::class,'retentionHistory'])->whereUuid('assignmentId');
    Route::get('/{assignmentId}/retention-status',[AssignmentV1Controller::class,'retentionStatus'])->whereUuid('assignmentId');
    Route::post('/{assignmentId}/private',[AssignmentV1Controller::class,'changePrivateText'])->whereUuid('assignmentId');
    Route::get('/{assignmentId}/private-history',[AssignmentV1Controller::class,'privateTextHistory'])->whereUuid('assignmentId');
    Route::get('/invites/removals',[AssignmentV1Controller::class,'removalNotices']);
    Route::get('/{assignmentId}/participants',[AssignmentV1Controller::class,'participants'])->whereUuid('assignmentId');
    Route::post('/{assignmentId}/invites',[AssignmentV1Controller::class,'invite'])->whereUuid('assignmentId');
    Route::post('/{assignmentId}/invites/{inviteId}/accept',
        [AssignmentV1Controller::class,'accept'])->whereUuid('assignmentId')->whereUuid('inviteId');
    Route::post('/{assignmentId}/invites/{inviteId}/remove',
        [AssignmentV1Controller::class,'removeMember'])->whereUuid('assignmentId')->whereUuid('inviteId');
    Route::post('/{assignmentId}/submissions',[AssignmentV1Controller::class,'submit'])->whereUuid('assignmentId');
    Route::get('/{assignmentId}/submissions',[AssignmentV1Controller::class,'submissions'])->whereUuid('assignmentId');
    Route::post('/{assignmentId}/media-submissions',
        [AssignmentMediaSubmissionController::class,'create'])->whereUuid('assignmentId');
    Route::get('/{assignmentId}/media-submissions',
        [AssignmentMediaSubmissionController::class,'index'])->whereUuid('assignmentId');
});

// P1-27: account-signed, encrypted team create/owner list. No implicit DEK grants.
Route::prefix('teams/v1')->middleware('throttle:pb3-assignments')->group(function(){
    Route::get('/',[TeamV1Controller::class,'index']);
    Route::post('/',[TeamV1Controller::class,'create']);
    Route::get('/{teamId}',[TeamV1Controller::class,'show'])->whereUuid('teamId');
});

// P1-28: team DEK invitation and independent recipient-signed consent.
// New members have zero implied assignment/file rights.
Route::prefix('teams/v1')->middleware('throttle:pb3-assignments')->group(function(){
    Route::get('/invites/received',[TeamInvitationController::class,'inbox']);
    Route::post('/{teamId}/invites',[TeamInvitationController::class,'invite'])
        ->whereUuid('teamId');
    Route::get('/{teamId}/participants',[TeamInvitationController::class,'participants'])
        ->whereUuid('teamId');
    Route::post('/{teamId}/invites/{inviteId}/accept',
        [TeamInvitationController::class,'accept'])
        ->whereUuid('teamId')->whereUuid('inviteId');
    Route::get('/{teamId}/member',[TeamInvitationController::class,'memberTeam'])
        ->whereUuid('teamId');
});

// P1-29A: serialized signed membership changes and fail-closed key-epoch quarantine.
Route::prefix('teams/v1')->middleware('throttle:pb3-assignments')->group(function(){
    Route::get('/{teamId}/membership-status',[TeamMembershipController::class,'status'])->whereUuid('teamId');
    Route::get('/{teamId}/membership-history',[TeamMembershipController::class,'history'])->whereUuid('teamId');
    Route::post('/{teamId}/membership',[TeamMembershipController::class,'mutate'])->whereUuid('teamId');
});

// P1-29B: owner-authenticated, signed and atomically roster-bound Team key epochs.
Route::prefix('teams/v1')->middleware('throttle:pb3-assignments')->group(function(){
    Route::get('/{teamId}/epoch/owner',[TeamKeyEpochController::class,'owner'])
        ->whereUuid('teamId');
    Route::get('/{teamId}/epoch/member',[TeamKeyEpochController::class,'recipient'])
        ->whereUuid('teamId');
    Route::get('/{teamId}/epoch/history',[TeamKeyEpochController::class,'history'])
        ->whereUuid('teamId');
    Route::post('/{teamId}/epoch',[TeamKeyEpochController::class,'rotate'])
        ->whereUuid('teamId');
});

// P1-29C: epoch-bound E2EE Team invitation and independent recipient consent.
Route::prefix('teams/v2')->middleware('throttle:pb3-assignments')->group(function(){
    Route::get('/invites/received',[TeamEpochInvitationController::class,'inbox']);
    Route::post('/{teamId}/invites',[TeamEpochInvitationController::class,'create'])
        ->whereUuid('teamId');
    Route::get('/{teamId}/participants',[TeamEpochInvitationController::class,'participants'])
        ->whereUuid('teamId');
    Route::post('/{teamId}/invites/{inviteId}/accept',
        [TeamEpochInvitationController::class,'accept'])
        ->whereUuid('teamId')->whereUuid('inviteId');
    Route::get('/{teamId}/member',[TeamEpochInvitationController::class,'member'])
        ->whereUuid('teamId');
});


// P2 Browser: authenticated account-signed opaque folder snapshots only.
// No plaintext metadata, implied shared-media grants or physical S3 deletes.
Route::prefix('folders/v1')->middleware('throttle:pb3-assignments')->group(function(){
    Route::get('/snapshot',[BrowserFolderSyncController::class,'show']);
    Route::post('/snapshot',[BrowserFolderSyncController::class,'store']);
    Route::get('/revisions/{revision}',[BrowserFolderSyncController::class,'revision'])
        ->whereNumber('revision');
});


// P2 Browser Archive: state-changing actions are account-signed and operator-
// gated. StorageManager tombstone/verified GC remain independent P1 safety.
Route::prefix('browser/v1/archive')->middleware('throttle:pb3-media')->group(function(){
    Route::get('/',[BrowserArchiveController::class,'index']);
    Route::post('/actions',[BrowserArchiveController::class,'mutate']);
    Route::post('/inspect',[BrowserArchiveController::class,'inspect']);
    Route::get('/preferences',[BrowserArchivePreferencesController::class,'show']);
    Route::post('/preferences',[BrowserArchivePreferencesController::class,'update']);
});

// P2 #198: read-only trusted event feed. No client emission, no server read ACK.
Route::get('/notifications/v1/events', [NotificationEventsController::class, 'index'])
    ->middleware('throttle:40,1');
