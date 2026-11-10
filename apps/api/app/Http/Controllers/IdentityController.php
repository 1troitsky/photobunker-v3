<?php
declare(strict_types=1);

namespace App\Http\Controllers;

use App\Identity\Protocol as P;
use Carbon\CarbonImmutable;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;

/**
 * Anonymous Identity v2. Browser requests run in Laravel's web middleware:
 * encrypted secure session cookies + CSRF + same-origin, never in stateless API.
 * No support reset, no server-side key material, no Matrix/photo dependencies.
 */
final class IdentityController extends Controller
{
    private function json(array $value, int $status = 200): JsonResponse {
        return response()->json($value,$status)->header('Cache-Control','no-store');
    }

    private function origin(Request $r): void {
        if (! in_array($r->method(),['GET','HEAD'],true)) {
            $origin = $r->headers->get('Origin');
            $expected = rtrim(config('app.url'),'/');
            abort_unless(is_string($origin) && hash_equals($expected, $origin),403);
        }
    }

    private function data(Request $r, array $names): array {
        $value = $r->json()->all();
        abort_unless(is_array($value),422);
        return P::exact($value,$names);
    }

    private function actor(Request $r): array {
        $id=$r->session()->get('identity_account');
        $deviceId=$r->session()->get('identity_device');
        $issued=$r->session()->get('identity_issued',0);
        abort_unless(is_string($id) && is_string($deviceId) && is_int($issued) && $issued+86400>time(),401);
        $account=DB::table('identity_accounts')->where('id',$id)->where('status','ready')->first();
        $device=DB::table('identity_devices')->where('id',$deviceId)->where('account_id',$id)->whereNull('revoked_at')->first();
        abort_unless($account && $device,401);
        return [$account,$device];
    }

    private function session(Request $r,string $accountId,string $deviceId): array {
        $r->session()->regenerate(true);
        $r->session()->put('identity_account',$accountId);
        $r->session()->put('identity_device',$deviceId);
        $r->session()->put('identity_issued',time());
        return ['accountId'=>$accountId,'deviceId'=>$deviceId,'expiresAt'=>now()->addDay()->utc()->toIso8601String()];
    }

    public function csrf(Request $r): JsonResponse {
        return $this->json(['csrfToken'=>csrf_token()]);
    }

    public function prepare(Request $r): JsonResponse {
        $this->origin($r);
        $d=$this->data($r,['operationId','reservationProof']);
        P::uuid($d['operationId']);
        P::b64($d['reservationProof'],32);
        $hash=hash('sha256',$d['reservationProof']);
        $row=DB::transaction(function () use ($d,$hash) {
            $record=DB::table('identity_accounts')->where('operation_id',$d['operationId'])->lockForUpdate()->first();
            if ($record) {
                abort_unless(hash_equals($record->prepare_hash,$hash),409);
                if ($record->status==='reserved' && now()->greaterThan($record->reserved_until)) {
                    DB::table('identity_accounts')->where('id',$record->id)->update([
                        'reserved_until'=>now()->addMinutes(15),'updated_at'=>now(),
                    ]);
                    return DB::table('identity_accounts')->find($record->id);
                }
                return $record;
            }
            $id=(string) Str::uuid();
            DB::table('identity_accounts')->insertOrIgnore([
                'id'=>$id,'operation_id'=>$d['operationId'],'prepare_hash'=>$hash,'status'=>'reserved',
                'reserved_until'=>now()->addMinutes(15),'revision'=>1,'created_at'=>now(),'updated_at'=>now(),
            ]);
            $created=DB::table('identity_accounts')->where('operation_id',$d['operationId'])->lockForUpdate()->first();
            abort_unless($created && hash_equals($created->prepare_hash,$hash),409);
            return $created;
        });
        return $this->json(['accountId'=>$row->id,'status'=>$row->status]);
    }

    public function challenge(Request $r): JsonResponse {
        $this->origin($r);
        $d=$this->data($r,['payload']);
        abort_unless(is_array($d['payload']),422);
        $p=$d['payload'];
        $purpose=$p['purpose']??null;
        abort_unless(is_string($purpose),422);
        $canon=P::payload($purpose,$p);
        $account=DB::table('identity_accounts')->where('id',$p['accountId'])->first();
        abort_unless($account,404);
        if ($purpose==='register') {
            abort_unless($account->status==='reserved' && now()->lessThan($account->reserved_until)
                && $account->operation_id===$p['operationId'],409);
            abort_if(DB::table('identity_accounts')->where('locator',$p['locator'])->exists(),409);
        } else {
            abort_unless($account->status==='ready',404);
            if (in_array($purpose,['recover','pair-enroll'],true)) abort_unless((string)$account->revision===$p['revision'],409);
            if ($purpose==='rotate') abort_unless((string)$account->revision===$p['expectedRevision'],409);
            if (in_array($purpose,['login','rotate'],true)) {
                abort_unless(DB::table('identity_devices')->where('id',$p['deviceId'])
                    ->where('account_id',$account->id)->whereNull('revoked_at')->exists(),401);
            }
        }
        $id=(string) Str::uuid();
        $nonce=P::encode(random_bytes(32));
        $expiry=now()->addSeconds(90)->startOfSecond();
        $expires=$expiry->utc()->format('Y-m-d\TH:i:s.v\Z');
        $row=(object)[
            'id'=>$id,'purpose'=>$purpose,'nonce'=>$nonce,'expires_at'=>$expires,
            'digest'=>hash('sha256',$canon),
        ];
        DB::table('identity_challenges')->insert([
            'id'=>$id,'account_id'=>$account->id,'purpose'=>$purpose,'payload'=>$canon,
            'digest'=>$row->digest,'nonce'=>$nonce,'expires_at'=>$expiry,
            'created_at'=>now(),'updated_at'=>now(),
        ]);
        return $this->json(['id'=>$id,'nonce'=>$nonce,'expiresAt'=>$expires,'digest'=>$row->digest,'message'=>P::challengeMessage($row)]);
    }

    public function proof(Request $r): JsonResponse {
        $this->origin($r);
        $d=$this->data($r,['challengeId','signature','deviceSignature','envelope']);
        P::uuid($d['challengeId']);
        abort_unless(is_string($d['signature']) && (is_string($d['deviceSignature']) || $d['deviceSignature']===null),422);
        // Laravel's ConvertEmptyStringsToNull middleware converts the explicit
        // empty secondary signature used by device-only login.
        $d['deviceSignature'] ??= '';
        $answer=DB::transaction(function () use ($d) {
            $ch=DB::table('identity_challenges')->where('id',$d['challengeId'])->lockForUpdate()->first();
            abort_unless($ch && $ch->consumed_at===null && now()->lessThan($ch->expires_at),401);
            $p=json_decode($ch->payload,true,flags:JSON_THROW_ON_ERROR);
            $account=DB::table('identity_accounts')->where('id',$ch->account_id)->lockForUpdate()->first();
            abort_unless($account,401);
            $message=P::challengeMessage($ch);
            $purpose=$ch->purpose;
            $device=DB::table('identity_devices')->where('id',$p['deviceId'])->lockForUpdate()->first();
            if ($purpose==='login') {
                abort_unless($account->status==='ready' && $device && $device->account_id===$account->id && !$device->revoked_at,401);
                abort_unless(P::verify($device->signing_spki,$message,$d['signature']),401);
                abort_unless($d['deviceSignature']==='',422);
                abort_unless($d['envelope']===null,422);
            } elseif ($purpose==='register') {
                abort_unless($account->status==='reserved' && $account->operation_id===$p['operationId']
                    && now()->lessThan($account->reserved_until) && !$device,409);
                abort_unless(P::verify($p['accountSpki'],$message,$d['signature'])
                    && P::verify($p['deviceSpki'],$message,$d['deviceSignature']),401);
                $e=$this->checkedEnvelope($d['envelope'],$account->id,$p['locator'],1,$p['envelopeHash']);
                abort_if(DB::table('identity_accounts')->where('locator',$p['locator'])->exists(),409);
                DB::table('identity_accounts')->where('id',$account->id)->update([
                    'account_spki'=>$p['accountSpki'],'locator'=>$p['locator'],'recovery_envelope'=>$e,
                    'status'=>'ready','updated_at'=>now(),
                ]);
                $this->insertDevice($account->id,$p['deviceId'],$p['deviceSpki']);
            } elseif (in_array($purpose,['recover','pair-enroll'],true)) {
                $sameDevice=$device && $device->account_id===$account->id
                    && hash_equals($device->signing_spki,$p['deviceSpki']) && !$device->revoked_at;
                abort_unless($account->status==='ready' && (string)$account->revision===$p['revision']
                    && (!$device || $purpose==='recover' && $sameDevice),409);
                abort_unless(P::verify($account->account_spki,$message,$d['signature'])
                    && P::verify($p['deviceSpki'],$message,$d['deviceSignature']),401);
                abort_unless($d['envelope']===null,422);
                if ($purpose==='pair-enroll') {
                    $pair=DB::table('identity_pairings')->where('id',$p['pairingId'])->lockForUpdate()->first();
                    abort_unless($pair && $pair->account_id===$account->id && $pair->device_id===$p['deviceId']
                        && $pair->device_spki===$p['deviceSpki'] && $pair->approved_by && !$pair->consumed_at
                        && now()->lessThan($pair->expires_at),401);
                    abort_unless(DB::table('identity_devices')->where('id',$pair->approved_by)
                        ->where('account_id',$account->id)->whereNull('revoked_at')->exists(),401);
                    DB::table('identity_pairings')->where('id',$pair->id)->update(['consumed_at'=>now()]);
                }
                if (! $device) $this->insertDevice($account->id,$p['deviceId'],$p['deviceSpki']);
            } elseif ($purpose==='rotate') {
                abort_unless($account->status==='ready' && (string)$account->revision===$p['expectedRevision'],409);
                $device=DB::table('identity_devices')->where('id',$p['deviceId'])
                    ->where('account_id',$account->id)->whereNull('revoked_at')->first();
                abort_unless($device && P::verify($account->account_spki,$message,$d['signature'])
                    && P::verify($device->signing_spki,$message,$d['deviceSignature']),401);
                $e=$this->checkedEnvelope($d['envelope'],$account->id,$p['locator'],$account->revision+1,$p['envelopeHash']);
                abort_if(DB::table('identity_accounts')->where('locator',$p['locator'])
                    ->where('id','!=',$account->id)->exists(),409);
                $updated=DB::table('identity_accounts')->where('id',$account->id)->where('revision',$account->revision)->update([
                    'locator'=>$p['locator'],'recovery_envelope'=>$e,'revision'=>$account->revision+1,
                    'rotation_op'=>$p['operationId'],'rotation_hash'=>$p['envelopeHash'],'updated_at'=>now(),
                ]);
                abort_unless($updated===1,409);
            } else abort(422);
            DB::table('identity_challenges')->where('id',$ch->id)->update(['consumed_at'=>now()]);
            return ['accountId'=>$account->id,'deviceId'=>$p['deviceId'],'purpose'=>$purpose];
        });
        $session = $this->session($r,$answer['accountId'],$answer['deviceId']);
        return $this->json([...$session,'purpose'=>$answer['purpose']]);
    }

    private function checkedEnvelope(mixed $value,string $account,string $locator,int $revision,string $hash): string {
        abort_unless(is_array($value),422);
        $encoded=P::envelope($value,$account,$locator,'recovery', $revision);
        abort_unless(hash_equals($hash,hash('sha256',$encoded)),422);
        return $encoded;
    }

    private function insertDevice(string $account,string $id,string $spki): void {
        P::uuid($id); P::spki($spki);
        DB::table('identity_devices')->insert([
            'id'=>$id,'account_id'=>$account,'signing_spki'=>$spki,'created_at'=>now(),'updated_at'=>now(),
        ]);
    }

    public function recovery(Request $r,string $locator): JsonResponse {
        P::b64($locator,16);
        $a=DB::table('identity_accounts')->where('locator',$locator)->where('status','ready')->first();
        abort_unless($a,404);
        return $this->json(['accountId'=>$a->id,'accountSpki'=>$a->account_spki,'revision'=>$a->revision,
            'envelope'=>json_decode($a->recovery_envelope,true,flags:JSON_THROW_ON_ERROR)]);
    }

    public function time(Request $r): JsonResponse {
        $this->actor($r);
        return $this->json(['serverUtc'=>now()->utc()->format('Y-m-d\TH:i:s.v\Z')]);
    }

    public function me(Request $r): JsonResponse {
        [$account,$device]=$this->actor($r);
        return $this->json(['accountId'=>$account->id,'deviceId'=>$device->id,'revision'=>$account->revision]);
    }

    public function logout(Request $r): JsonResponse {
        $this->origin($r);
        $r->session()->invalidate(); $r->session()->regenerateToken();
        return $this->json(['signedOut'=>true]);
    }

    public function rotationStatus(Request $r): JsonResponse {
        $this->origin($r);
        [$a]=$this->actor($r);
        $d=$this->data($r,['operationId','envelopeHash']);
        P::uuid($d['operationId']);
        abort_unless(is_string($d['envelopeHash']) && preg_match('/^[a-f0-9]{64}$/D',$d['envelopeHash'])===1,422);
        return $this->json(['committed'=>$a->rotation_op===$d['operationId'] && hash_equals($a->rotation_hash??'', $d['envelopeHash']),
            'revision'=>$a->revision]);
    }

    public function devices(Request $r): JsonResponse {
        [$a]=$this->actor($r);
        return $this->json(['devices'=>DB::table('identity_devices')->where('account_id',$a->id)
            ->get(['id','created_at','revoked_at'])->toArray()]);
    }

    public function revoke(Request $r,string $id): JsonResponse {
        $this->origin($r);
        [$a,$actor]=$this->actor($r); P::uuid($id);
        $count=DB::table('identity_devices')->where('id',$id)->where('account_id',$a->id)
            ->whereNull('revoked_at')->update(['revoked_at'=>now(),'updated_at'=>now()]);
        abort_unless($count===1,404);
        if ($id===$actor->id) { $r->session()->invalidate(); $r->session()->regenerateToken(); }
        return $this->json(['revoked'=>true]);
    }

    public function pairStart(Request $r): JsonResponse {
        $this->origin($r);
        $d=$this->data($r,['pairingId','accountId','deviceId','deviceSpki','ecdhSpki','fingerprint','requestToken']);
        P::uuid($d['pairingId']); P::uuid($d['accountId']); P::uuid($d['deviceId']);
        P::spki($d['deviceSpki']); P::spki($d['ecdhSpki']);
        P::b64($d['requestToken'],32);
        abort_unless(preg_match('/^[a-f0-9]{64}$/D',$d['fingerprint'])===1,422);
        abort_unless(DB::table('identity_accounts')->where('id',$d['accountId'])->where('status','ready')->exists(),404);
        abort_if(DB::table('identity_devices')->where('id',$d['deviceId'])->exists(),409);
        $tokenHash=hash('sha256',$d['requestToken']);
        $row=DB::transaction(function () use ($d,$tokenHash) {
            $existing=DB::table('identity_pairings')->where('id',$d['pairingId'])->lockForUpdate()->first();
            if($existing){
                abort_unless($existing->account_id===$d['accountId'] && $existing->device_id===$d['deviceId']
                    && hash_equals($existing->device_spki,$d['deviceSpki'])
                    && hash_equals($existing->ecdh_spki,$d['ecdhSpki'])
                    && hash_equals($existing->fingerprint,$d['fingerprint'])
                    && hash_equals($existing->token_hash,$tokenHash) && !$existing->consumed_at
                    && now()->lessThan($existing->expires_at),409);
                return $existing;
            }
            DB::table('identity_pairings')->insert([
                'id'=>$d['pairingId'],'account_id'=>$d['accountId'],'device_id'=>$d['deviceId'],
                'device_spki'=>$d['deviceSpki'],'ecdh_spki'=>$d['ecdhSpki'],
                'fingerprint'=>$d['fingerprint'],'token_hash'=>$tokenHash,
                'expires_at'=>now()->addMinutes(5),'created_at'=>now(),'updated_at'=>now(),
            ]);
            return DB::table('identity_pairings')->find($d['pairingId']);
        });
        return $this->json(['pairingId'=>$row->id,'expiresAt'=>CarbonImmutable::parse($row->expires_at)->utc()->toIso8601String()]);
    }

    public function pairList(Request $r): JsonResponse {
        [$a]=$this->actor($r);
        return $this->json(['pairings'=>DB::table('identity_pairings')
            ->where('account_id',$a->id)->whereNull('approved_by')->whereNull('consumed_at')
            ->where('expires_at','>',now())->get(['id','device_id','device_spki','ecdh_spki','fingerprint','expires_at'])->toArray()]);
    }

    public function pairApprove(Request $r,string $id): JsonResponse {
        $this->origin($r);
        [$a,$device]=$this->actor($r); P::uuid($id);
        $d=$this->data($r,['envelope','approverEcdhSpki','fingerprint']);
        P::spki($d['approverEcdhSpki']);
        abort_unless(preg_match('/^[a-f0-9]{64}$/D',$d['fingerprint'])===1,422);
        abort_unless(is_array($d['envelope']) && strlen(json_encode($d['envelope']))<16384,422);
        DB::transaction(function () use ($id,$a,$device,$d) {
            $pair=DB::table('identity_pairings')->where('id',$id)->lockForUpdate()->first();
            abort_unless($pair && $pair->account_id===$a->id && $pair->device_id!==$device->id &&
                !$pair->consumed_at && !$pair->approved_by && now()->lessThan($pair->expires_at)
                && hash_equals($pair->fingerprint,$d['fingerprint']),409);
            DB::table('identity_pairings')->where('id',$id)->update([
                'envelope'=>json_encode(['envelope'=>$d['envelope'],'approverEcdhSpki'=>$d['approverEcdhSpki']],JSON_THROW_ON_ERROR),
                'approved_by'=>$device->id,'updated_at'=>now(),
            ]);
        });
        return $this->json(['approved'=>true]);
    }

    public function pairPoll(Request $r,string $id): JsonResponse {
        $this->origin($r); P::uuid($id);
        $d=$this->data($r,['requestToken']);
        P::b64($d['requestToken'],32);
        $pair=DB::table('identity_pairings')->where('id',$id)->whereNull('consumed_at')->first();
        abort_unless($pair && now()->lessThan($pair->expires_at)
            && hash_equals($pair->token_hash,hash('sha256',$d['requestToken'])),404);
        return $this->json(['status'=>$pair->approved_by?'approved':'pending',
            'accountId'=>$pair->account_id,
            'envelope'=>$pair->approved_by?json_decode($pair->envelope,true,flags:JSON_THROW_ON_ERROR):null]);
    }
}
