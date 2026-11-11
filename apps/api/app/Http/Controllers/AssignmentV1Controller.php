<?php
declare(strict_types=1);

namespace App\Http\Controllers;

use App\Assignments\AssignmentContract as C;
use App\Assignments\AssignmentSchedule as S;
use App\Assignments\AssignmentRetention as R;
use App\Assignments\MonthlyCreationQuota;
use App\Identity\Protocol as P;
use App\Photo\PhotoSync;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;

/**
 * P1-04 narrow server vertical: encrypted assignment, signed invitation,
 * signed consent and photo/recipient-grant binding. No direct S3 access.
 */
final class AssignmentV1Controller extends Controller
{
    public function __construct(
        private readonly PhotoSync $sync,
        private readonly MonthlyCreationQuota $quota,
    ) {}

    private function signed(Request $r,object $account,string $domain,array $keys): array
    {
        $data=P::exact($r->json()->all(),['contract','signature']);
        abort_unless(is_string($data['contract'])&&is_string($data['signature']),422);
        return C::signed($data['contract'],$data['signature'],
          $account->account_spki,$domain,$keys);
    }

    private function assignment(string $id):object
    {
        P::uuid($id);
        $a=DB::table('assignment_records_v1')->where('id',$id)->first();
        abort_unless($a,404);
        R::requireAvailable($a);
        return $a;
    }

    /** Authenticated and current, never based on a browser-supplied month. */
    public function usage(Request $r)
    {
        [$actor]=$this->sync->actor($r);
        return $this->sync->json($this->quota->usage($actor->id));
    }

    public function create(Request $r)
    {
        $this->sync->origin($r);
        [$actor]=$this->sync->actor($r);
        $c=$this->signed($r,$actor,'pb3.assignment.v1',[
            'version','assignmentId','operationId','ownerAccountId',
            'revision','policyRevision','state','startsAt','endsAt',
            'photoGoal','allowedMedia','privateEnvelope',
        ]);
        C::creation($c,$actor->id);
        $hash=hash('sha256',$r->json('contract'));
        return DB::transaction(function()use($c,$actor,$hash,$r){
            // Serialize concurrent creation from the same owner.
            DB::table('identity_accounts')->where('id',$actor->id)->lockForUpdate()->first();
            $existing=DB::table('assignment_records_v1')
              ->where('id',$c['assignmentId'])->first();
            if($existing){
                abort_unless($existing->owner_account_id===$actor->id
                  &&hash_equals($existing->contract_hash,$hash),409);
                return $this->sync->json(['assignmentId'=>$existing->id,
                  'state'=>$existing->state,'revision'=>(int)$existing->revision,
                  'unchanged'=>true]);
            }
            abort_if(DB::table('assignment_records_v1')
              ->where('operation_id',$c['operationId'])->exists(),409);
            // A signed create replay above must still ACK after monthly quota
            // exhaustion. A genuinely NEW create is gated under the SAME
            // account row lock used by all concurrent create transactions.
            // The user's signed startsAt is never used to choose the month.
            $usage=$this->quota->usage($actor->id);
            if($usage['remaining']===0){
                return $this->sync->json([
                    'error'=>'assignment.monthly_quota_exceeded',
                    'limit'=>$usage['limit'],
                    'periodEnd'=>$usage['periodEnd'],
                ],403);
            }
            DB::table('assignment_records_v1')->insert([
                'id'=>$c['assignmentId'],'owner_account_id'=>$actor->id,
                'operation_id'=>$c['operationId'],'contract_hash'=>$hash,
                'contract_json'=>$r->json('contract'),'owner_signature'=>$r->json('signature'),
                'private_envelope_json'=>C::envelope($c['privateEnvelope']),
                'state'=>'active','revision'=>1,'policy_revision'=>1,
                'photo_goal'=>$c['photoGoal'],'starts_at'=>$c['startsAt'],
                'ends_at'=>$c['endsAt'],'created_at'=>now(),'updated_at'=>now(),
            ]);
            return $this->sync->json(['assignmentId'=>$c['assignmentId'],
              'state'=>'active','revision'=>1,'unchanged'=>false],201);
        },3);
    }

    /**
     * Owner-signed, append-only policy revisions. The immutable signed creation
     * policy is the trust root; previous revision bindings remain verifiable.
     */
    public function changePolicy(Request $r,string $assignmentId)
    {
        $this->sync->origin($r);
        [$actor]=$this->sync->actor($r);
        $raw=$r->json('contract');
        $shape=is_string($raw)?json_decode($raw,true,32):null;
        $policyVersion=is_array($shape)?($shape['version']??null):null;
        $withRequirements=in_array($policyVersion,[2,3,4,5,6],true);
        $keys=[
            'version','operationId','assignmentId','ownerAccountId',
            'rootPolicyHash','previousPolicyHash',
            'fromPolicyRevision','toPolicyRevision','photoGoal','allowedMedia',
        ];
        if($withRequirements)$keys=array_merge($keys,[
            'requiredCategory','descriptionMinLength','requiredGps',
        ]);
        if(in_array($policyVersion,[4,5,6],true))$keys=array_merge($keys,['videoGoal','audioGoal']);
        if(in_array($policyVersion,[5,6],true))$keys=array_merge($keys,['videoRequirements','audioRequirements']);
        if($policyVersion===6)$keys=array_merge($keys,['photoAdvanced','videoAdvanced','audioAdvanced']);
        $domain=match($policyVersion){
            6=>'pb3.assignment-policy.v6',
            5=>'pb3.assignment-policy.v5',
            4=>'pb3.assignment-policy.v4',
            3=>'pb3.assignment-policy.v3',
            2=>'pb3.assignment-policy.v2',
            default=>'pb3.assignment-policy.v1',
        };
        $c=$this->signed($r,$actor,$domain,$keys);
        C::policyAmendment($c,$actor->id,$assignmentId);
        $hash=hash('sha256',$r->json('contract'));
        return DB::transaction(function()use($c,$actor,$assignmentId,$r,$hash){
            $a=DB::table('assignment_records_v1')
                ->where('id',$assignmentId)->lockForUpdate()->first();
            abort_unless($a&&$a->owner_account_id===$actor->id,404);
            $root=hash('sha256',$a->contract_json);
            abort_unless(hash_equals($root,$c['rootPolicyHash']),409);
            $existing=DB::table('assignment_policy_events_v1')
                ->where('operation_id',$c['operationId'])->first();
            if($existing){
                abort_unless($existing->assignment_id===$a->id
                    &&hash_equals($existing->contract_hash,$hash),409);
                return $this->sync->json([
                    'assignmentId'=>$a->id,
                    'policyRevision'=>(int)$a->policy_revision,
                    'photoGoal'=>$a->photo_goal===null?null:(int)$a->photo_goal,
                    'unchanged'=>true,
                ]);
            }
            abort_unless($a->state==='active'
                &&R::filesOpen($a)
                &&(!S::current($a)['blockAfterEnd']
                    ||S::current($a)['endsAt']>PhotoSync::nowMs())
                &&(int)$a->policy_revision===$c['fromPolicyRevision']
                &&$c['toPolicyRevision']===(int)$a->policy_revision+1,409);
            $previousValues=$a->latest_policy_contract!==null
                ?json_decode($a->latest_policy_contract,true,32,JSON_THROW_ON_ERROR)
                :[];
            $oldVersion=(int)($previousValues['version']??1);
            // No signed client is allowed to downgrade away existing capture
            // requirements or newly granted media capabilities.
            abort_unless($c['version']>=$oldVersion,409);
            $oldRules=$oldVersion>=2;
            $currentCategory=$oldRules?$previousValues['requiredCategory']:false;
            $currentMinLength=$oldRules?$previousValues['descriptionMinLength']:0;
            $currentGps=$oldRules?$previousValues['requiredGps']:false;
            $currentMedia=$oldVersion>=3?$previousValues['allowedMedia']:['photo'];
            $differentRules=$c['version']>=2
                &&($c['requiredCategory']!==$currentCategory
                    ||$c['descriptionMinLength']!==$currentMinLength
                    ||$c['requiredGps']!==$currentGps);
            $differentMedia=$c['allowedMedia']!==$currentMedia;
            $currentVideoGoal=$oldVersion>=4?$previousValues['videoGoal']:null;
            $currentAudioGoal=$oldVersion>=4?$previousValues['audioGoal']:null;
            $differentGoals=$c['version']>=4
                &&($c['videoGoal']!==$currentVideoGoal
                    ||$c['audioGoal']!==$currentAudioGoal);
            $defaults=['requiredCategory'=>false,'descriptionMinLength'=>0,'requiredGps'=>false];
            $differentMediaRules=$c['version']>=5
                &&($c['videoRequirements']!==($oldVersion>=5?$previousValues['videoRequirements']:$defaults)
                    ||$c['audioRequirements']!==($oldVersion>=5?$previousValues['audioRequirements']:$defaults));
            $emptyAdvanced=['allowedCategories'=>[],'requiredTags'=>[]];
            $differentAdvanced=$c['version']===6 && (
                $c['photoAdvanced']!==($oldVersion>=6?$previousValues['photoAdvanced']:$emptyAdvanced)
                ||$c['videoAdvanced']!==($oldVersion>=6?$previousValues['videoAdvanced']:$emptyAdvanced)
                ||$c['audioAdvanced']!==($oldVersion>=6?$previousValues['audioAdvanced']:$emptyAdvanced));
            abort_unless($differentRules||$differentMedia||$differentGoals||$differentMediaRules||$differentAdvanced
                ||($a->photo_goal===null?null:(int)$a->photo_goal)!==$c['photoGoal'],409);
            $previous=hash('sha256',$a->latest_policy_contract??$a->contract_json);
            abort_unless(hash_equals($previous,$c['previousPolicyHash']),409);
            $at=PhotoSync::nowMs();
            DB::table('assignment_policy_events_v1')->insert([
                'operation_id'=>$c['operationId'],'assignment_id'=>$a->id,
                'from_revision'=>$c['fromPolicyRevision'],
                'to_revision'=>$c['toPolicyRevision'],
                'contract_hash'=>$hash,'contract_json'=>$r->json('contract'),
                'owner_signature'=>$r->json('signature'),
                'occurred_at_ms'=>$at,
                'created_at'=>\Carbon\CarbonImmutable::createFromTimestampMs($at,'UTC'),
            ]);
            DB::table('assignment_records_v1')->where('id',$a->id)->update([
                'policy_revision'=>$c['toPolicyRevision'],
                'photo_goal'=>$c['photoGoal'],
                'latest_policy_contract'=>$r->json('contract'),
                'latest_policy_signature'=>$r->json('signature'),
                'updated_at'=>now(),
            ]);
            return $this->sync->json([
                'assignmentId'=>$a->id,
                'policyRevision'=>$c['toPolicyRevision'],
                'photoGoal'=>$c['photoGoal'],'unchanged'=>false,
            ]);
        },3);
    }

    /**
     * P1-19: signed append-only AEAD ciphertext. Never rewrite the signed
     * creation envelope, reuse an AES-GCM nonce, or rotate the shared DEK:
     * otherwise existing accepted invitees lose access.
     */
    public function changePrivateText(Request $r,string $assignmentId)
    {
        $this->sync->origin($r);
        [$actor]=$this->sync->actor($r);
        $c=$this->signed($r,$actor,'pb3.assignment-private.v2',[
            'version','operationId','assignmentId','ownerAccountId',
            'rootPrivateHash','previousPrivateHash',
            'fromPrivateRevision','toPrivateRevision','privateEnvelope',
        ]);
        C::privateTextAmendment($c,$actor->id,$assignmentId);
        $hash=hash('sha256',$r->json('contract'));
        return DB::transaction(function()use($c,$actor,$assignmentId,$r,$hash){
            $a=DB::table('assignment_records_v1')->where('id',$assignmentId)
                ->lockForUpdate()->first();
            abort_unless($a&&$a->owner_account_id===$actor->id,404);
            abort_unless(hash_equals(hash('sha256',$a->private_envelope_json),
                $c['rootPrivateHash']),409);
            // Idempotent lost-ACK after a later revision or a finished state.
            $existing=DB::table('assignment_private_events_v1')
                ->where('operation_id',$c['operationId'])->first();
            if($existing){
                abort_unless($existing->assignment_id===$a->id
                    &&hash_equals($existing->contract_hash,$hash),409);
                return $this->sync->json([
                    'assignmentId'=>$a->id,
                    'privateRevision'=>(int)$a->private_revision,
                    'unchanged'=>true,
                ]);
            }
            abort_unless($a->state==='active'
                &&R::assignmentOpen($a)
                &&(!S::current($a)['blockAfterEnd']
                    ||S::current($a)['endsAt']>PhotoSync::nowMs())
                &&(int)$a->private_revision===$c['fromPrivateRevision'],409);
            $previous=$a->latest_private_contract??$a->private_envelope_json;
            abort_unless(hash_equals(hash('sha256',$previous),
                $c['previousPrivateHash']),409);
            $root=json_decode($a->private_envelope_json,true,16,JSON_THROW_ON_ERROR);
            $amendment=$c['privateEnvelope'];
            abort_unless($amendment['wrappedKey']===$root['wrappedKey'],409);
            // AES-GCM must never reuse a nonce with this unchanged DEK.
            abort_unless($amendment['iv']!==$root['iv'],409);
            abort_unless(!DB::table('assignment_private_events_v1')
                ->where('assignment_id',$a->id)
                ->where('cipher_iv',$amendment['iv'])->exists(),409);
            $when=PhotoSync::nowMs();
            DB::table('assignment_private_events_v1')->insert([
                'operation_id'=>$c['operationId'],'assignment_id'=>$a->id,
                'from_revision'=>$c['fromPrivateRevision'],
                'to_revision'=>$c['toPrivateRevision'],
                'contract_hash'=>$hash,'contract_json'=>$r->json('contract'),
                'owner_signature'=>$r->json('signature'),
                'cipher_iv'=>$amendment['iv'],'occurred_at_ms'=>$when,
                'created_at'=>\Carbon\CarbonImmutable::createFromTimestampMs($when,'UTC'),
            ]);
            DB::table('assignment_records_v1')->where('id',$a->id)->update([
                'private_revision'=>$c['toPrivateRevision'],
                'latest_private_contract'=>$r->json('contract'),
                'latest_private_signature'=>$r->json('signature'),
                'updated_at'=>now(),
            ]);
            return $this->sync->json([
                'assignmentId'=>$a->id,
                'privateRevision'=>$c['toPrivateRevision'],
                'unchanged'=>false,
            ]);
        },3);
    }

    /**
     * Owner or accepted member only. Returns signed AEAD event history, never
     * plaintext, keys, unaccepted invitees, filename, media or location.
     */
    public function privateTextHistory(Request $r,string $assignmentId)
    {
        [$actor]=$this->sync->actor($r);
        $a=$this->assignment($assignmentId);
        if($a->owner_account_id!==$actor->id){
            abort_unless(DB::table('assignment_invites_v1')
                ->where('assignment_id',$assignmentId)
                ->where('recipient_account_id',$actor->id)
                ->where('state','accepted')->exists(),404);
        }
        $events=DB::table('assignment_private_events_v1')
            ->where('assignment_id',$assignmentId)
            ->orderBy('to_revision')->limit(1001)
            ->get(['from_revision','to_revision','contract_hash',
                'contract_json','owner_signature','occurred_at_ms']);
        abort_unless($events->count()===(int)$a->private_revision-1,409);
        return $this->sync->json([
            'assignmentId'=>$assignmentId,
            'privateRevision'=>(int)$a->private_revision,
            'rootPrivateHash'=>hash('sha256',$a->private_envelope_json),
            'events'=>$events->map(fn($e)=>[
                'fromPrivateRevision'=>(int)$e->from_revision,
                'toPrivateRevision'=>(int)$e->to_revision,
                'contractHash'=>$e->contract_hash,
                'contract'=>$e->contract_json,
                'signature'=>$e->owner_signature,
                'occurredAtMs'=>(int)$e->occurred_at_ms,
            ])->values()->all(),
        ]);
    }

    /**
     * P1-21 owner-signed association/assignment access deadlines.
     * This is NOT physical deletion of contributor-owned media: the uploader
     * retains ownership and independent TTL, other grants and S3 locations.
     */
    public function changeRetention(Request $r,string $assignmentId)
    {
        $this->sync->origin($r);
        [$actor]=$this->sync->actor($r);
        $c=$this->signed($r,$actor,'pb3.assignment-retention.v1',[
            'version','operationId','assignmentId','ownerAccountId',
            'rootPolicyHash','previousRetentionHash',
            'fromRetentionRevision','toRetentionRevision',
            'filesAccessUntil','assignmentAccessUntil','deleteOriginals',
        ]);
        R::validate($c,$actor->id,$assignmentId);
        $hash=hash('sha256',$r->json('contract'));
        return DB::transaction(function()use($r,$actor,$c,$assignmentId,$hash){
            $a=DB::table('assignment_records_v1')
                ->where('id',$assignmentId)->lockForUpdate()->first();
            abort_unless($a&&$a->owner_account_id===$actor->id,404);
            abort_unless(hash_equals(hash('sha256',$a->contract_json),
                $c['rootPolicyHash']),409);
            $previousEvent=DB::table('assignment_retention_events_v1')
                ->where('operation_id',$c['operationId'])->first();
            if($previousEvent){
                abort_unless($previousEvent->assignment_id===$a->id
                    &&hash_equals($previousEvent->contract_hash,$hash),409);
                return $this->sync->json([
                    'assignmentId'=>$a->id,
                    'retentionRevision'=>(int)$a->retention_revision,
                    'unchanged'=>true,
                ]);
            }
            // Deadlines are immutable once reached: never resurrect an
            // assignment association or expose previously hidden receipts.
            abort_unless($a->state==='active'
                &&R::mayRevise($a)
                &&(int)$a->retention_revision===$c['fromRetentionRevision'],409);
            $previous=$a->latest_retention_contract??$a->contract_json;
            abort_unless(hash_equals(hash('sha256',$previous),
                $c['previousRetentionHash']),409);
            $old=R::current($a);
            $next=[
                'filesAccessUntil'=>$c['filesAccessUntil'],
                'assignmentAccessUntil'=>$c['assignmentAccessUntil'],
                'deleteOriginals'=>false,
            ];
            abort_unless($old!==$next,409);
            R::validateDeadlinesAgainstSchedule($next,S::current($a));
            $at=PhotoSync::nowMs();
            foreach(['filesAccessUntil','assignmentAccessUntil'] as $key){
                abort_unless($next[$key]===null||$next[$key]>$at,409);
            }
            DB::table('assignment_retention_events_v1')->insert([
                'operation_id'=>$c['operationId'],
                'assignment_id'=>$a->id,
                'from_revision'=>$c['fromRetentionRevision'],
                'to_revision'=>$c['toRetentionRevision'],
                'contract_hash'=>$hash,
                'contract_json'=>$r->json('contract'),
                'owner_signature'=>$r->json('signature'),
                'occurred_at_ms'=>$at,
                'created_at'=>\Carbon\CarbonImmutable::createFromTimestampMs($at,'UTC'),
            ]);
            DB::table('assignment_records_v1')->where('id',$a->id)->update([
                'retention_revision'=>$c['toRetentionRevision'],
                'files_access_until'=>$c['filesAccessUntil'],
                'assignment_access_until'=>$c['assignmentAccessUntil'],
                'latest_retention_contract'=>$r->json('contract'),
                'latest_retention_signature'=>$r->json('signature'),
                'updated_at'=>now(),
            ]);
            return $this->sync->json([
                'assignmentId'=>$a->id,
                'retentionRevision'=>$c['toRetentionRevision'],
                'unchanged'=>false,
            ]);
        },3);
    }

    /** Public deadlines and signatures only: no file IDs, private text or DEKs. */
    public function retentionHistory(Request $r,string $assignmentId)
    {
        [$actor]=$this->sync->actor($r);
        P::uuid($assignmentId);
        $a=DB::table('assignment_records_v1')->where('id',$assignmentId)->first();
        abort_unless($a,404);
        if($a->owner_account_id!==$actor->id){
            R::requireAvailable($a);
            abort_unless(DB::table('assignment_invites_v1')
                ->where('assignment_id',$assignmentId)
                ->where('recipient_account_id',$actor->id)
                ->where('state','accepted')->exists(),404);
        }
        $events=DB::table('assignment_retention_events_v1')
            ->where('assignment_id',$assignmentId)->orderBy('to_revision')
            ->limit(1001)->get(['from_revision','to_revision','contract_hash',
                'contract_json','owner_signature','occurred_at_ms']);
        abort_unless($events->count()===(int)$a->retention_revision-1,409);
        return $this->sync->json([
            'assignmentId'=>$assignmentId,
            'retentionRevision'=>(int)$a->retention_revision,
            'rootPolicyHash'=>hash('sha256',$a->contract_json),
            'events'=>$events->map(fn($e)=>[
                'fromRetentionRevision'=>(int)$e->from_revision,
                'toRetentionRevision'=>(int)$e->to_revision,
                'contractHash'=>$e->contract_hash,
                'contract'=>$e->contract_json,
                'signature'=>$e->owner_signature,
                'occurredAtMs'=>(int)$e->occurred_at_ms,
            ])->values()->all(),
        ]);
    }

    /**
     * Read-only owner maintenance receipt. A tombstone means DB cutoff was
     * recorded, NEVER that S3 ciphertext was physically removed.
     */
    public function retentionStatus(Request $r,string $assignmentId)
    {
        [$actor]=$this->sync->actor($r);
        P::uuid($assignmentId);
        $a=DB::table('assignment_records_v1')
            ->where('id',$assignmentId)
            ->where('owner_account_id',$actor->id)->first();
        abort_unless($a,404);
        $t=DB::table('assignment_retention_tombstones_v1')
            ->where('assignment_id',$assignmentId)->first();
        return $this->sync->json([
            'assignmentId'=>$assignmentId,
            'filesAccessExpired'=>!R::filesOpen($a),
            'assignmentAccessExpired'=>!R::assignmentOpen($a),
            'filesCutoffRecorded'=>$t!==null&&$t->files_marked_at!==null,
            'assignmentCutoffRecorded'=>$t!==null&&$t->assignment_marked_at!==null,
            'physicalDeletionConfirmed'=>false,
            'physicalStatus'=>'not_authorized',
        ]);
    }

    /**
     * Owner-signed, independently versioned schedule changes. Root creation
     * timestamps are immutable and always remain verifiable by recipients.
     * A schedule edit never expires or deletes stored media.
     */
    public function changeSchedule(Request $r,string $assignmentId)
    {
        $this->sync->origin($r);
        [$actor]=$this->sync->actor($r);
        $c=$this->signed($r,$actor,'pb3.assignment-schedule.v1',[
            'version','operationId','assignmentId','ownerAccountId',
            'rootPolicyHash','previousScheduleHash',
            'fromScheduleRevision','toScheduleRevision',
            'startsAt','endsAt','blockBeforeStart','blockAfterEnd',
        ]);
        S::validate($c,$actor->id,$assignmentId);
        $hash=hash('sha256',$r->json('contract'));
        return DB::transaction(function()use($r,$actor,$c,$assignmentId,$hash){
            $a=DB::table('assignment_records_v1')->where('id',$assignmentId)
                ->lockForUpdate()->first();
            abort_unless($a&&$a->owner_account_id===$actor->id,404);
            abort_unless(hash_equals(hash('sha256',$a->contract_json),
                $c['rootPolicyHash']),409);
            // Lost-ACK replay is idempotent even if the assignment was
            // subsequently finished, rescheduled, or another device changed it.
            $existing=DB::table('assignment_schedule_events_v1')
                ->where('operation_id',$c['operationId'])->first();
            if($existing){
                abort_unless($existing->assignment_id===$a->id
                    &&hash_equals($existing->contract_hash,$hash),409);
                return $this->sync->json([
                    'assignmentId'=>$a->id,
                    'scheduleRevision'=>(int)$a->schedule_revision,
                    'unchanged'=>true,
                ]);
            }
            abort_unless($a->state==='active'
                &&R::mayRevise($a)
                &&(int)$a->schedule_revision===$c['fromScheduleRevision'],409);
            $previous=$a->latest_schedule_contract??$a->contract_json;
            abort_unless(hash_equals(hash('sha256',$previous),
                $c['previousScheduleHash']),409);
            $old=S::current($a);
            R::validateDeadlinesAgainstSchedule(R::current($a),[
                'endsAt'=>$c['endsAt'],
            ]);
            abort_unless($old!==[
                'startsAt'=>$c['startsAt'],'endsAt'=>$c['endsAt'],
                'blockBeforeStart'=>$c['blockBeforeStart'],
                'blockAfterEnd'=>$c['blockAfterEnd'],
            ],409);
            $now=PhotoSync::nowMs();
            DB::table('assignment_schedule_events_v1')->insert([
                'operation_id'=>$c['operationId'],
                'assignment_id'=>$a->id,
                'from_revision'=>$c['fromScheduleRevision'],
                'to_revision'=>$c['toScheduleRevision'],
                'contract_hash'=>$hash,'contract_json'=>$r->json('contract'),
                'owner_signature'=>$r->json('signature'),
                'occurred_at_ms'=>$now,
                'created_at'=>\Carbon\CarbonImmutable::createFromTimestampMs($now,'UTC'),
            ]);
            DB::table('assignment_records_v1')->where('id',$a->id)->update([
                'schedule_revision'=>$c['toScheduleRevision'],
                'latest_schedule_contract'=>$r->json('contract'),
                'latest_schedule_signature'=>$r->json('signature'),
                'updated_at'=>now(),
            ]);
            return $this->sync->json([
                'assignmentId'=>$a->id,
                'scheduleRevision'=>$c['toScheduleRevision'],
                'unchanged'=>false,
            ]);
        },3);
    }

    /** Owner or previously accepted contributor; unsigned viewers get 404. */
    public function scheduleHistory(Request $r,string $assignmentId)
    {
        [$actor]=$this->sync->actor($r);
        $a=$this->assignment($assignmentId);
        if($a->owner_account_id!==$actor->id){
            abort_unless(DB::table('assignment_invites_v1')
                ->where('assignment_id',$assignmentId)
                ->where('recipient_account_id',$actor->id)
                ->where('state','accepted')->exists(),404);
        }
        $events=DB::table('assignment_schedule_events_v1')
            ->where('assignment_id',$assignmentId)
            ->orderBy('to_revision')->limit(1001)
            ->get(['from_revision','to_revision','contract_hash',
                'contract_json','owner_signature','occurred_at_ms']);
        abort_unless($events->count()===(int)$a->schedule_revision-1,409);
        return $this->sync->json([
            'assignmentId'=>$assignmentId,
            'scheduleRevision'=>(int)$a->schedule_revision,
            'rootPolicyHash'=>hash('sha256',$a->contract_json),
            'events'=>$events->map(fn($e)=>[
                'fromScheduleRevision'=>(int)$e->from_revision,
                'toScheduleRevision'=>(int)$e->to_revision,
                'contractHash'=>$e->contract_hash,
                'contract'=>$e->contract_json,
                'signature'=>$e->owner_signature,
                'occurredAtMs'=>(int)$e->occurred_at_ms,
            ])->values()->all(),
        ]);
    }

    /**
     * A finish/resume command changes server permissions without changing the
     * immutable owner-signed capture policy or deleting participants' media.
     * Every transition has a signed, revision-locked, append-only operation.
     */
    public function changeState(Request $r,string $assignmentId)
    {
        $this->sync->origin($r);
        [$actor]=$this->sync->actor($r);
        $c=$this->signed($r,$actor,'pb3.assignment-state.v1',[
            'version','operationId','assignmentId','ownerAccountId',
            'policyHash','policyRevision','fromRevision','toRevision',
            'action','state',
        ]);
        C::stateChange($c,$actor->id,$assignmentId);
        $hash=hash('sha256',$r->json('contract'));
        return DB::transaction(function()use($actor,$assignmentId,$c,$hash,$r){
            $a=DB::table('assignment_records_v1')
                ->where('id',$assignmentId)->lockForUpdate()->first();
            abort_unless($a&&$a->owner_account_id===$actor->id,404);
            abort_unless(hash_equals(hash('sha256',$a->contract_json),
                $c['policyHash']),409);
            $existing=DB::table('assignment_state_events_v1')
                ->where('operation_id',$c['operationId'])->first();
            if($existing){
                abort_unless($existing->assignment_id===$a->id
                    &&hash_equals($existing->contract_hash,$hash),409);
                return $this->sync->json([
                    'assignmentId'=>$a->id,'state'=>$a->state,
                    'revision'=>(int)$a->revision,'unchanged'=>true,
                ]);
            }
            abort_unless(R::assignmentOpen($a)
                &&(int)$a->revision===$c['fromRevision']
                &&$c['toRevision']===(int)$a->revision+1
                &&$c['policyRevision']===1,409);
            $expected=$c['action']==='finish'?'active':'finished';
            abort_unless($a->state===$expected,409);
            // A finished assignment cannot resume beyond its configured end.
            if($c['action']==='resume'){
                $schedule=S::current($a);
                abort_if($schedule['blockAfterEnd']
                    &&$schedule['endsAt']!==null
                    &&$schedule['endsAt']<=PhotoSync::nowMs(),409);
            }
            // The DB connection formats DateTime bindings to second precision.
            // Store the authoritative receipt instant as an integer as well,
            // derived from the same server clock/UTC instant as created_at.
            $occurredAtMs=PhotoSync::nowMs();
            DB::table('assignment_state_events_v1')->insert([
                'operation_id'=>$c['operationId'],'assignment_id'=>$a->id,
                'from_revision'=>$c['fromRevision'],
                'to_revision'=>$c['toRevision'],
                'state'=>$c['state'],'contract_hash'=>$hash,
                'contract_json'=>$r->json('contract'),
                'owner_signature'=>$r->json('signature'),
                'occurred_at_ms'=>$occurredAtMs,
                'created_at'=>\Carbon\CarbonImmutable::createFromTimestampMs(
                    $occurredAtMs,'UTC'),
            ]);
            DB::table('assignment_records_v1')->where('id',$a->id)->update([
                'state'=>$c['state'],'revision'=>$c['toRevision'],
                'latest_state_contract'=>$r->json('contract'),
                'latest_state_signature'=>$r->json('signature'),
                'updated_at'=>now(),
            ]);
            return $this->sync->json([
                'assignmentId'=>$a->id,'state'=>$c['state'],
                'revision'=>$c['toRevision'],'unchanged'=>false,
            ]);
        },3);
    }

    public function index(Request $r)
    {
        [$actor]=$this->sync->actor($r);
        $after=$r->query('after');
        if($after!==null){abort_unless(is_string($after),422);P::uuid($after);}
        $now=PhotoSync::nowMs();
        $q=DB::table('assignment_records_v1 as a')
          ->join('identity_accounts as owner','owner.id','=','a.owner_account_id')
          ->where(function($q)use($now){
              $q->whereNull('a.assignment_access_until')
                ->orWhere('a.assignment_access_until','>',$now);
          })
          ->where(function($query)use($actor){
              $query->where('a.owner_account_id',$actor->id)
                ->orWhereExists(function($sub)use($actor){
                    $sub->selectRaw('1')->from('assignment_invites_v1 as i')
                      ->whereColumn('i.assignment_id','a.id')
                      ->where('i.recipient_account_id',$actor->id)
                      ->where('i.state','accepted');
                });
          });
        if($after!==null)$q->where('a.id','>',$after);
        $columns=[
            'a.id','a.owner_account_id','a.state','a.revision',
            'a.policy_revision','a.photo_goal','a.starts_at','a.ends_at',
            'a.private_envelope_json','a.contract_json','a.owner_signature',
            'a.latest_state_contract','a.latest_state_signature',
            'a.latest_policy_contract','a.latest_policy_signature',
            'a.private_revision','a.latest_private_contract','a.latest_private_signature',
            'a.schedule_revision','a.latest_schedule_contract','a.latest_schedule_signature',
            'a.retention_revision','a.latest_retention_contract','a.latest_retention_signature',
            'a.files_access_until','a.assignment_access_until',
            'owner.account_spki as owner_account_spki',
        ];
        $now=PhotoSync::nowMs();
        // An authoritative receipt must still have an active, contributor-
        // owned photo and explicit E2EE grant to this assignment's owner.
        // Counting the submissions endpoint's first 50 rows is WRONG:
        // assignment targets can be 1..9999 with no upload limit from goals.
        $rows=$q->select($columns)->selectSub(function($sub)use($now){
            $sub->from('assignment_submissions_v1 as s')
                ->join('photo_records as p','p.id','=','s.photo_id')
                ->join('photo_access_grants as g','g.id','=','s.photo_grant_id')
                ->whereColumn('s.assignment_id','a.id')
                ->whereColumn('p.account_id','s.contributor_account_id')
                ->whereColumn('g.photo_id','s.photo_id')
                ->whereColumn('g.owner_account_id','s.contributor_account_id')
                ->whereColumn('g.recipient_account_id','a.owner_account_id')
                ->where('p.state','active')->where('p.expires_at','>',$now)
                ->where('g.state','active')->where('g.expires_at','>',$now)
                ->selectRaw('COUNT(*)');
        },'confirmed_photo_count');
        // The legacy photo_records and modern encrypted P2 Photo MediaFile
        // submission stores are distinct. Count both LIVE, assignment-scoped
        // ciphertext grants, never queued optimistic client entries.
        $rows->selectSub(function($sub)use($now){
            $sub->from('assignment_media_submissions_v1 as s')
                ->join('media_files_v1 as m','m.id','=','s.media_id')
                ->join('media_recipient_grants_v1 as g','g.id','=','s.media_grant_id')
                ->whereColumn('s.assignment_id','a.id')
                ->where('s.media_type','photo')
                ->where('m.media_type','photo')
                ->whereColumn('m.account_id','s.contributor_account_id')
                ->whereColumn('m.contract_hash','s.media_contract_hash')
                ->whereColumn('g.media_id','s.media_id')
                ->whereColumn('g.owner_account_id','s.contributor_account_id')
                ->whereColumn('g.recipient_account_id','a.owner_account_id')
                ->whereColumn('g.assignment_id','s.assignment_id')
                ->whereExists(function($members){
                    $members->selectRaw('1')->from('assignment_invites_v1 as i')
                        ->whereColumn('i.assignment_id','s.assignment_id')
                        ->whereColumn('i.recipient_account_id',
                            's.contributor_account_id')
                        ->where('i.role','contributor')
                        ->where('i.state','accepted');
                })
                ->where('m.state','active')->where('m.expires_at','>',$now)
                ->where('g.state','active')->where('g.expires_at','>',$now)
                // A signed archive disables grant reads before source TTL.
                // It must also remove this contribution from live progress.
                ->whereNotExists(static function($archive){
                    $archive->selectRaw('1')
                        ->from('browser_archive_entries_v1 as ba')
                        ->where('ba.kind','media')
                        ->whereColumn('ba.asset_id','s.media_id')
                        ->whereIn('ba.state',['archived','deleting']);
                })
                ->selectRaw('COUNT(*)');
        },'confirmed_p2_photo_count');
        // Independent and full server-derived counts. Never infer progress
        // from the first 50 paginated receipts or a client-reported count.
        foreach(['video','audio'] as $kind){
            $rows->selectSub(function($sub)use($now,$kind){
                $sub->from('assignment_media_submissions_v1 as s')
                    ->join('media_files_v1 as m','m.id','=','s.media_id')
                    ->join('media_recipient_grants_v1 as g','g.id','=','s.media_grant_id')
                    ->whereColumn('s.assignment_id','a.id')
                    ->where('s.media_type',$kind)
                    ->whereColumn('m.account_id','s.contributor_account_id')
                    ->whereColumn('m.contract_hash','s.media_contract_hash')
                    ->whereColumn('g.media_id','s.media_id')
                    ->whereColumn('g.owner_account_id','s.contributor_account_id')
                    ->whereColumn('g.recipient_account_id','a.owner_account_id')
                    ->where('m.state','active')->where('m.expires_at','>',$now)
                    ->where('g.state','active')->where('g.expires_at','>',$now)
                    ->whereNotExists(static function($archive){
                        $archive->selectRaw('1')
                            ->from('browser_archive_entries_v1 as ba')
                            ->where('ba.kind','media')
                            ->whereColumn('ba.asset_id','s.media_id')
                            ->whereIn('ba.state',['archived','deleting']);
                    })
                    ->selectRaw('COUNT(*)');
            },'confirmed_'.$kind.'_count');
        }
        $rows=$rows->orderBy('a.id')->limit(51)->get();
        $more=$rows->count()>50;
        $items=$rows->take(50)->map(fn($x)=>[
            'assignmentId'=>$x->id,'ownerAccountId'=>$x->owner_account_id,
            'state'=>$x->state,'revision'=>(int)$x->revision,
            'policyRevision'=>(int)$x->policy_revision,
            'photoGoal'=>$x->photo_goal===null?null:(int)$x->photo_goal,
            'videoGoal'=>(static function()use($x){
                $policy=$x->latest_policy_contract
                    ?json_decode($x->latest_policy_contract,true,32,JSON_THROW_ON_ERROR):null;
                return ($policy['version']??0)>=4?$policy['videoGoal']:null;
            })(),
            'audioGoal'=>(static function()use($x){
                $policy=$x->latest_policy_contract
                    ?json_decode($x->latest_policy_contract,true,32,JSON_THROW_ON_ERROR):null;
                return ($policy['version']??0)>=4?$policy['audioGoal']:null;
            })(),
            'confirmedPhotoCount'=>$x->files_access_until!==null
                &&(int)$x->files_access_until<=PhotoSync::nowMs()
                ?0:(int)$x->confirmed_photo_count+(int)$x->confirmed_p2_photo_count,
            'confirmedVideoCount'=>$x->files_access_until!==null
                &&(int)$x->files_access_until<=PhotoSync::nowMs()
                ?0:(int)$x->confirmed_video_count,
            'confirmedAudioCount'=>$x->files_access_until!==null
                &&(int)$x->files_access_until<=PhotoSync::nowMs()
                ?0:(int)$x->confirmed_audio_count,
            'startsAt'=>(int)$x->starts_at,
            'endsAt'=>$x->ends_at===null?null:(int)$x->ends_at,
            'privateEnvelope'=>json_decode($x->private_envelope_json,true,16,JSON_THROW_ON_ERROR),
            'privateRevision'=>(int)$x->private_revision,
            'privateAmendmentContract'=>$x->latest_private_contract,
            'privateAmendmentSignature'=>$x->latest_private_signature,
            'scheduleRevision'=>(int)$x->schedule_revision,
            'scheduleAmendmentContract'=>$x->latest_schedule_contract,
            'scheduleAmendmentSignature'=>$x->latest_schedule_signature,
            'retentionRevision'=>(int)$x->retention_revision,
            'retentionAmendmentContract'=>$x->latest_retention_contract,
            'retentionAmendmentSignature'=>$x->latest_retention_signature,
            'filesAccessUntil'=>$x->files_access_until===null?null:(int)$x->files_access_until,
            'assignmentAccessUntil'=>$x->assignment_access_until===null?null:(int)$x->assignment_access_until,
            // A client must verify this owner's original signed policy before
            // trusting capture constraints. Server metadata alone is not a signature.
            'policyContract'=>$x->contract_json,
            'policySignature'=>$x->owner_signature,
            'policyAmendmentContract'=>$x->latest_policy_contract,
            'policyAmendmentSignature'=>$x->latest_policy_signature,
            'stateContract'=>$x->latest_state_contract,
            'stateSignature'=>$x->latest_state_signature,
            'ownerAccountSpki'=>$x->owner_account_spki,
        ])->values()->all();
        return $this->sync->json(['items'=>$items,
            'nextCursor'=>$more&&$items?end($items)['assignmentId']:null]);
    }

    /**
     * Read-only owner-signed public revision history. The account must be the
     * owner or an accepted invitee, never merely a named recipient. No private
     * assignment fields, media bytes, keys or GPS are returned.
     */
    public function policyHistory(Request $r,string $assignmentId)
    {
        [$actor]=$this->sync->actor($r);
        $a=$this->assignment($assignmentId);
        if($a->owner_account_id!==$actor->id){
            abort_unless(DB::table('assignment_invites_v1')
                ->where('assignment_id',$assignmentId)
                ->where('recipient_account_id',$actor->id)
                ->where('state','accepted')->exists(),404);
        }
        $events=DB::table('assignment_policy_events_v1')
            ->where('assignment_id',$assignmentId)
            ->orderBy('to_revision')->limit(1001)
            ->get(['from_revision','to_revision','contract_hash',
                'contract_json','owner_signature','occurred_at_ms']);
        abort_unless($events->count()===(int)$a->policy_revision-1,409);
        return $this->sync->json([
            'assignmentId'=>$assignmentId,
            'policyRevision'=>(int)$a->policy_revision,
            'rootPolicyHash'=>hash('sha256',$a->contract_json),
            'events'=>$events->map(fn($e)=>[
                'fromPolicyRevision'=>(int)$e->from_revision,
                'toPolicyRevision'=>(int)$e->to_revision,
                'contractHash'=>$e->contract_hash,
                'contract'=>$e->contract_json,
                'signature'=>$e->owner_signature,
                'occurredAtMs'=>(int)$e->occurred_at_ms,
            ])->values()->all(),
        ]);
    }

    public function invite(Request $r,string $assignmentId)
    {
        $this->sync->origin($r);
        [$actor]=$this->sync->actor($r);
        $c=$this->signed($r,$actor,'pb3.assignment-invite.v1',[
            'version','inviteId','assignmentId','ownerAccountId',
            'recipientAccountId','recipientKeyDigest','role','expiresAt','envelope',
        ]);
        C::invite($c,$actor->id,$assignmentId);
        $hash=hash('sha256',$r->json('contract'));
        return DB::transaction(function()use($c,$actor,$assignmentId,$r,$hash){
            $a=DB::table('assignment_records_v1')
                ->where('id',$assignmentId)->lockForUpdate()->first();
            abort_unless($a&&$a->owner_account_id===$actor->id,404);
            // A lost ACK must remain replayable even after finish/expiry,
            // recipient rotation or a later change to the key directory.
            $other=DB::table('assignment_invites_v1')
                ->where('assignment_id',$assignmentId)
                ->where('recipient_account_id',$c['recipientAccountId'])->first();
            if($other){
                abort_unless($other->id===$c['inviteId']
                  &&hash_equals($other->contract_hash,$hash),409);
                return $this->sync->json(['inviteId'=>$other->id,
                  'state'=>$other->state,'unchanged'=>true]);
            }
            abort_unless($a->state==='active'&&R::filesOpen($a),409);
            $recipient=DB::table('identity_accounts')
              ->where('id',$c['recipientAccountId'])->where('status','ready')->first();
            abort_unless($recipient,404);
            $key=DB::table('account_exchange_keys')->where('account_id',$recipient->id)->first();
            abort_unless($key&&hash_equals($key->descriptor_hash,$c['recipientKeyDigest']),409);
            DB::table('assignment_invites_v1')->insert([
                'id'=>$c['inviteId'],'assignment_id'=>$assignmentId,
                'owner_account_id'=>$actor->id,
                'recipient_account_id'=>$recipient->id,'role'=>'contributor',
                'recipient_key_digest'=>$c['recipientKeyDigest'],
                'state'=>'pending','contract_hash'=>$hash,
                'contract_json'=>$r->json('contract'),
                'owner_signature'=>$r->json('signature'),
                'expires_at'=>$c['expiresAt'],'created_at'=>now(),'updated_at'=>now(),
            ]);
            return $this->sync->json(['inviteId'=>$c['inviteId'],
              'state'=>'pending','unchanged'=>false],201);
        },3);
    }

    /**
     * Owner-only authoritative invitation roster. This is a READ endpoint,
     * never a role grant or evidence that an existing media DEK is revoked.
     * Return the original owner-signed invite for independent client checks;
     * server-derived consent status is explicitly not owner-signed.
     */
    public function participants(Request $r,string $assignmentId)
    {
        [$actor]=$this->sync->actor($r);
        P::uuid($assignmentId);
        $a=DB::table('assignment_records_v1')
            ->where('id',$assignmentId)
            ->where('owner_account_id',$actor->id)->first();
        abort_unless($a,404); // never disclose other accounts' recipient graph
        R::requireAvailable($a);
        $after=$r->query('after');
        if($after!==null){
            abort_unless(is_string($after),422);
            P::uuid($after);
        }
        $now=PhotoSync::nowMs();
        $q=DB::table('assignment_invites_v1')
            ->where('assignment_id',$a->id);
        if($after!==null)$q->where('id','>',$after);
        $rows=$q->orderBy('id')->limit(51)->get([
            'id','recipient_account_id','role','state','expires_at',
            'contract_json','owner_signature',
        ]);
        $more=$rows->count()>50;
        $page=$rows->take(50);
        return $this->sync->json([
            'items'=>$page->map(static fn($x)=>[
                'inviteId'=>$x->id,
                'recipientAccountId'=>$x->recipient_account_id,
                'role'=>$x->role,'state'=>$x->state,
                'expiresAt'=>(int)$x->expires_at,
                'expired'=>$x->state==='pending'&&(int)$x->expires_at<=$now,
                'contract'=>$x->contract_json,
                'signature'=>$x->owner_signature,
            ])->all(),
            'nextCursor'=>$more?$page->last()->id:null,
            'serverNowMs'=>$now,
        ]);
    }

    public function inbox(Request $r)
    {
        [$actor]=$this->sync->actor($r);
        $rows=DB::table('assignment_invites_v1 as i')
            ->join('assignment_records_v1 as a','a.id','=','i.assignment_id')
            ->join('identity_accounts as o','o.id','=','i.owner_account_id')
            ->where('i.recipient_account_id',$actor->id)
            ->where(function($q):void {
                $q->whereNull('a.assignment_access_until')
                  ->orWhere('a.assignment_access_until','>',PhotoSync::nowMs());
            })
            ->where(function($q):void {
                $q->where('i.state','accepted')->orWhere(function($pending):void {
                    $pending->where('i.state','pending')
                        ->where('i.expires_at','>',PhotoSync::nowMs())
                        ->where('a.state','active')
                        ->where(function($w):void{
                            $w->whereNull('a.files_access_until')
                              ->orWhere('a.files_access_until','>',PhotoSync::nowMs());
                        });
                });
            })
            ->orderBy('i.id')->limit(50)
            ->get(['i.id','i.assignment_id','i.state','i.role',
              'i.contract_json','i.owner_signature','i.expires_at',
              'o.account_spki','i.owner_account_id']);
        return $this->sync->json(['items'=>$rows->map(fn($x)=>[
            'inviteId'=>$x->id,'assignmentId'=>$x->assignment_id,
            'ownerAccountId'=>$x->owner_account_id,
            'ownerAccountSpki'=>$x->account_spki,
            'role'=>$x->role,'state'=>$x->state,
            'expiresAt'=>(int)$x->expires_at,
            'contract'=>$x->contract_json,'signature'=>$x->owner_signature,
        ])->all()]);
    }

    public function accept(Request $r,string $assignmentId,string $inviteId)
    {
        $this->sync->origin($r);
        [$actor]=$this->sync->actor($r);
        $c=$this->signed($r,$actor,'pb3.assignment-accept.v1',[
            'version','action','inviteId','assignmentId','recipientAccountId','operationId',
        ]);
        C::acceptance($c,$actor->id,$assignmentId,$inviteId);
        return DB::transaction(function()use($actor,$c,$assignmentId,$inviteId,$r){
            $a=DB::table('assignment_records_v1')
                ->where('id',$assignmentId)->lockForUpdate()->first();
            abort_unless($a,404);
            $invite=DB::table('assignment_invites_v1')
                ->where('id',$inviteId)->where('assignment_id',$a->id)
                ->where('recipient_account_id',$actor->id)->lockForUpdate()->first();
            abort_unless($invite,404);
            // Accepted operation replay is idempotent even after the invite
            // expired or the assignment was finished; new consent is not.
            if($invite->state==='accepted'){
                abort_unless($invite->accepted_operation_id===$c['operationId']
                  &&hash_equals(hash('sha256',$invite->accepted_contract),
                    hash('sha256',$r->json('contract'))),409);
                return $this->sync->json(['inviteId'=>$inviteId,
                  'state'=>'accepted','unchanged'=>true]);
            }
            abort_unless($a->state==='active'&&R::filesOpen($a),409);
            abort_if($invite->expires_at<=PhotoSync::nowMs(),410);
            abort_unless($invite->state==='pending',409);
            DB::table('assignment_invites_v1')->where('id',$inviteId)->update([
                'state'=>'accepted','accepted_at'=>now(),
                'accepted_operation_id'=>$c['operationId'],
                'accepted_contract'=>$r->json('contract'),
                'accepted_signature'=>$r->json('signature'),
                'updated_at'=>now(),
            ]);
            return $this->sync->json(['inviteId'=>$inviteId,
              'state'=>'accepted','unchanged'=>false]);
        },3);
    }

    public function submit(Request $r,string $assignmentId)
    {
        $this->sync->origin($r);
        [$actor]=$this->sync->actor($r);
        $c=$this->signed($r,$actor,'pb3.assignment-submit.v1',[
            'version','submissionId','operationId','assignmentId',
            'contributorAccountId','photoId','photoGrantId','policyRevision','kind',
        ]);
        C::submission($c,$actor->id,$assignmentId);
        $hash=hash('sha256',$r->json('contract'));
        return DB::transaction(function()use($c,$actor,$hash,$r,$assignmentId){
            $a=DB::table('assignment_records_v1')
                ->where('id',$assignmentId)->lockForUpdate()->first();
            abort_unless($a,404);
            // An already-committed signed submission must ACK after finish,
            // expiry or later grant revocation. This returns only the caller's
            // receipt; it never restores ciphertext or revoked read grants.
            $existing=DB::table('assignment_submissions_v1')
                ->where('id',$c['submissionId'])->first();
            if($existing){
                abort_unless($existing->assignment_id===$assignmentId
                  &&$existing->contributor_account_id===$actor->id
                  &&hash_equals($existing->contract_hash,$hash),409);
                return $this->sync->json(['submissionId'=>$existing->id,'unchanged'=>true]);
            }
            abort_unless($a->state==='active'
                &&R::filesOpen($a)
                &&$c['policyRevision']<=(int)$a->policy_revision
                &&S::permitsNow($a),409);
            $joined=DB::table('assignment_invites_v1')->where('assignment_id',$a->id)
                ->where('recipient_account_id',$actor->id)->where('role','contributor')
                ->where('state','accepted')->first();
            abort_unless($joined,403);
            $photo=DB::table('photo_records')->where('id',$c['photoId'])
                ->where('account_id',$actor->id)->first();
            abort_unless($photo&&$photo->state==='active'
                &&$photo->expires_at>PhotoSync::nowMs(),404);
            $photoContract=json_decode($photo->contract_json,true,32,JSON_THROW_ON_ERROR);
            if(($photoContract['version']??null)===2){
                // An assignment-scoped capture must never be re-bound to an
                // unrelated assignment, even with an otherwise valid grant.
                $capture=$photoContract['capture']??[];
                $signedPolicy=$c['policyRevision']===1
                    ?$a->contract_json
                    :DB::table('assignment_policy_events_v1')
                        ->where('assignment_id',$assignmentId)
                        ->where('to_revision',$c['policyRevision'])
                        ->value('contract_json');
                abort_unless(is_string($signedPolicy)
                    &&($capture['assignmentId']??null)===$assignmentId
                    &&($capture['ownerAccountId']??null)===$a->owner_account_id
                    &&($capture['policyRevision']??null)===$c['policyRevision']
                    &&hash_equals(hash('sha256',$signedPolicy),
                        (string)($capture['policyHash']??'')),409);
            }
            $grant=DB::table('photo_access_grants')
                ->where('id',$c['photoGrantId'])->where('photo_id',$photo->id)
                ->where('owner_account_id',$actor->id)
                ->where('recipient_account_id',$a->owner_account_id)
                ->where('state','active')->first();
            abort_unless($grant&&$grant->expires_at>PhotoSync::nowMs()
                &&($grant->assignment_id===null
                    ||$grant->assignment_id===$assignmentId),403);
            abort_if(DB::table('assignment_submissions_v1')
                ->where('photo_id',$c['photoId'])->orWhere('operation_id',$c['operationId'])
                ->exists(),409);
            DB::table('assignment_submissions_v1')->insert([
                'id'=>$c['submissionId'],'assignment_id'=>$assignmentId,
                'contributor_account_id'=>$actor->id,'photo_id'=>$photo->id,
                'photo_grant_id'=>$grant->id,'operation_id'=>$c['operationId'],
                'policy_revision'=>$c['policyRevision'],'contract_hash'=>$hash,
                'contract_json'=>$r->json('contract'),'contributor_signature'=>$r->json('signature'),
                'created_at'=>now(),
            ]);
            return $this->sync->json(['submissionId'=>$c['submissionId'],
              'unchanged'=>false],201);
        },3);
    }

    public function submissions(Request $r,string $assignmentId)
    {
        [$actor]=$this->sync->actor($r);
        $assignment=$this->assignment($assignmentId);
        abort_unless($assignment->owner_account_id===$actor->id,404);
        abort_unless(R::filesOpen($assignment),404);
        $rows=DB::table('assignment_submissions_v1 as s')
            ->join('photo_records as p','p.id','=','s.photo_id')
            ->join('photo_access_grants as g','g.id','=','s.photo_grant_id')
            ->where('s.assignment_id',$assignmentId)
            ->whereColumn('p.account_id','s.contributor_account_id')
            ->whereColumn('g.photo_id','s.photo_id')
            ->whereColumn('g.owner_account_id','s.contributor_account_id')
            ->where('g.recipient_account_id',$assignment->owner_account_id)
            ->where('p.state','active')->where('p.expires_at','>',PhotoSync::nowMs())
            ->where('g.state','active')->where('g.expires_at','>',PhotoSync::nowMs())
            ->orderBy('s.id')->limit(50)
            ->get(['s.id','s.photo_id','s.photo_grant_id','s.contributor_account_id']);
        return $this->sync->json(['items'=>$rows->map(fn($x)=>[
            'submissionId'=>$x->id,'photoId'=>$x->photo_id,
            'photoGrantId'=>$x->photo_grant_id,
            'contributorAccountId'=>$x->contributor_account_id,
        ])->all()]);
    }
}
