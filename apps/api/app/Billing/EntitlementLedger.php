<?php
declare(strict_types=1);

namespace App\Billing;

use App\Plans\PlanCatalog;
use App\Plans\PlanDefinition;
use Carbon\CarbonImmutable;
use Illuminate\Support\Facades\DB;
use RuntimeException;

/**
 * Append-only account-owned entitlement ledger, with a single CAS head.
 *
 * This has NO public mutation endpoint. advanceTrusted() is a narrow internal
 * primitive for a future verified settlement or MFA-audited operator event;
 * it MUST NOT be called directly from a client-supplied plan ID, invoice or
 * payment callback before that independent proof is verified (#225/#227).
 */
final class EntitlementLedger
{
    public function __construct(private readonly PlanCatalog $catalog) {}

    private static function utc(CarbonImmutable $at):string
    {
        return $at->utc()->format('Y-m-d\TH:i:s\Z');
    }

    private static function date(?string $value):?CarbonImmutable
    {
        return $value===null?null:CarbonImmutable::parse($value,'UTC')->utc();
    }

    private static function rowHash(
        string $accountId,int $revision,PlanDefinition $definition,
        string $startsAt,?string $endsAt,?string $graceEndsAt,
        string $source,string $eventHash,?string $previousHash,
    ):string {
        $identity=[
            'domain'=>'pb3.billing.entitlement.v1','accountId'=>$accountId,
            'revision'=>$revision,'planId'=>$definition->id,
            'catalogVersion'=>$definition->version,
            'definitionSha256'=>$definition->sha256,
            'startsAt'=>$startsAt,'endsAt'=>$endsAt,'graceEndsAt'=>$graceEndsAt,
            'source'=>$source,'eventHash'=>$eventHash,'previousHash'=>$previousHash,
        ];
        return hash('sha256',json_encode($identity,
            JSON_UNESCAPED_SLASHES|JSON_THROW_ON_ERROR));
    }

    private function insertSnapshot(
        string $accountId,int $revision,PlanDefinition $definition,
        CarbonImmutable $startsAt,?CarbonImmutable $endsAt,
        string $source,string $verifiedEventHash,?string $previousHash,
    ):int {
        $graceDays=$definition->value['limits']['graceDays'];
        $graceEnds=$endsAt&&is_int($graceDays)
            ?$endsAt->addDays($graceDays):null;
        $startsUtc=self::utc($startsAt);
        $endsUtc=$endsAt?self::utc($endsAt):null;
        $graceUtc=$graceEnds?self::utc($graceEnds):null;
        return (int)DB::table('billing_entitlement_snapshots_v1')->insertGetId([
            'account_id'=>$accountId,'revision'=>$revision,
            'plan_id'=>$definition->id,
            'catalog_version'=>$definition->version,
            'definition_sha256'=>$definition->sha256,
            'definition_json'=>$definition->json,
            'starts_at'=>$startsAt->utc(),
            'ends_at'=>$endsAt?->utc(),
            'grace_ends_at'=>$graceEnds?->utc(),
            'source'=>$source,'verified_event_hash'=>$verifiedEventHash,
            'previous_hash'=>$previousHash,
            'snapshot_hash'=>self::rowHash($accountId,$revision,$definition,
                $startsUtc,$endsUtc,$graceUtc,$source,$verifiedEventHash,$previousHash),
            'created_at'=>CarbonImmutable::now('UTC'),
        ]);
    }

    /** Account row is locked in the caller's transaction. */
    private function ensureFree(string $accountId,CarbonImmutable $now):object
    {
        $head=DB::table('billing_entitlement_heads_v1')
            ->where('account_id',$accountId)->first();
        if($head)return $head;
        // A newly enrolled account is ALWAYS Free. Never infer paid status
        // from a client cookie, a tariff view or a provisional invoice.
        $free=$this->catalog->get('free');
        $event=hash('sha256',"pb3.billing.free-bootstrap.v1\n".$accountId);
        $id=$this->insertSnapshot($accountId,1,$free,$now,null,
            'free_bootstrap',$event,null);
        DB::table('billing_entitlement_heads_v1')->insert([
            'account_id'=>$accountId,'snapshot_id'=>$id,'revision'=>1,
            'updated_at'=>$now,
        ]);
        return (object)['account_id'=>$accountId,'snapshot_id'=>$id,'revision'=>1];
    }

    private function verify(object $row):array
    {
        $json=(string)$row->definition_json;
        $hash=(string)$row->definition_sha256;
        if(!hash_equals($hash,hash('sha256',$json))) {
            throw new RuntimeException('billing.snapshot_integrity_failed');
        }
        try{$d=json_decode($json,true,64,JSON_THROW_ON_ERROR);}
        catch(\Throwable){throw new RuntimeException('billing.snapshot_integrity_failed');}
        if(!is_array($d)
            ||($d['schemaVersion']??null)!==1
            ||($d['planId']??null)!==$row->plan_id
            ||($d['catalogVersion']??null)!==$row->catalog_version
            ||!is_array($d['featureFlags']??null)
            ||!is_array($d['limits']??null)) {
            throw new RuntimeException('billing.snapshot_integrity_failed');
        }
        // Recompute the row commitment from its stored (immutable)
        // definition, NOT today's potentially changed config.
        $stored=PlanDefinition::fromConfig((string)$row->plan_id,[
            'schema_version'=>1,'currency'=>'USD',
            'catalog_version'=>$row->catalog_version,
            'effective_at'=>$d['effectiveAt']??null,
            // Verify the exact policy committed to the immutable historical
            // definition, not the newly deployed public price catalog.
            'storage_unit_policy'=>$d['limits']['storage']['unitPolicy']??null,
        ],self::unmapForIntegrity($d));
        if($stored->json!==$json || $stored->sha256!==$hash) {
            throw new RuntimeException('billing.snapshot_integrity_failed');
        }
        $starts=self::date((string)$row->starts_at);
        $ends=self::date($row->ends_at);
        $grace=self::date($row->grace_ends_at);
        $expected=self::rowHash(
            (string)$row->account_id,(int)$row->revision,$stored,
            self::utc($starts),$ends?self::utc($ends):null,
            $grace?self::utc($grace):null,
            (string)$row->source,(string)$row->verified_event_hash,
            $row->previous_hash,
        );
        if(!hash_equals((string)$row->snapshot_hash,$expected)
            ||(($row->previous_hash===null)!==((int)$row->revision===1))) {
            throw new RuntimeException('billing.snapshot_integrity_failed');
        }
        if((int)$row->revision>1) {
            $previous=DB::table('billing_entitlement_snapshots_v1')
                ->where('account_id',$row->account_id)
                ->where('revision',(int)$row->revision-1)->first();
            if(!$previous
                ||!hash_equals((string)$row->previous_hash,
                    (string)$previous->snapshot_hash)) {
                throw new RuntimeException('billing.snapshot_chain_failed');
            }
        }
        return $d;
    }

    /**
     * Integrity round-trip to prevent a stored row from acquiring extra
     * feature flags/limits beyond a canonical catalog definition.
     * The original plan version remains immutable even if config changes.
     */
    private static function unmapForIntegrity(array $d):array
    {
        $l=$d['limits'];
        $f=$d['featureFlags'];
        return [
            'monthly_price_cents'=>$d['monthlyPriceCents']??null,
            'period_prices_cents'=>$d['periodPricesCents']??null,
            'assignment_creations_per_month'=>$l['assignmentCreationsPerMonth']??null,
            'max_media_files'=>$l['maxMediaFiles']??null,
            'storage_quota'=>[
                'amount'=>$l['storage']['amount']??null,
                'unit'=>$l['storage']['unit']??null,
            ],
            'max_retention'=>$l['retention']??null,
            'manual_backup_updates_per_week'=>$l['manualBackupUpdatesPerWeek']??null,
            'auto_backup_updates'=>$l['autoBackupUpdates']??null,
            'encrypted_cloud_backup'=>$f['encryptedCloudBackup']??null,
            'emergency_pin'=>$f['emergencyPin']??null,
            'remote_emergency'=>$f['remoteEmergency']??null,
            'grace_days'=>$l['graceDays']??null,
            'priority_support'=>$f['prioritySupport']??null,
            'matrix_e2ee_messages'=>$f['matrixE2eeMessages']??null,
            'own_matrix_homeserver'=>$f['ownMatrixHomeserver']??null,
            'byo_s3'=>$f['byoS3']??null,
        ];
    }

    private function requireReady(string $accountId):void
    {
        $account=DB::table('identity_accounts')->where('id',$accountId)
            ->lockForUpdate()->first();
        abort_unless($account && $account->status==='ready',401);
    }

    /** Current server-only, account-scoped snapshot; never accepts planId. */
    public function current(string $accountId,?CarbonImmutable $at=null):array
    {
        $at=($at??CarbonImmutable::now('UTC'))->utc();
        return DB::transaction(function()use($accountId,$at){
            $this->requireReady($accountId);
            $head=$this->ensureFree($accountId,$at);
            $row=DB::table('billing_entitlement_snapshots_v1')
                ->where('id',$head->snapshot_id)
                ->where('account_id',$accountId)->first();
            if(!$row||(int)$row->revision!==(int)$head->revision) {
                throw new RuntimeException('billing.snapshot_head_invalid');
            }
            $definition=$this->verify($row);
            $ends=self::date($row->ends_at);
            $grace=self::date($row->grace_ends_at);
            $starts=self::date((string)$row->starts_at);
            $status=$at->lessThan($starts)?'pending'
                :($ends===null||$at->lessThan($ends)?'active'
                :($grace!==null&&$at->lessThan($grace)?'grace':'expired'));
            // Not an entitlement extension: after paid expiry, the read-only
            // preview reports Free's available privileges. Existing ciphertext
            // retention and write admission have independent P1/P3 gates.
            $effective=$status==='active'?$definition:$this->catalog->get('free')->value;
            return [
                'schemaVersion'=>1,
                'revision'=>(int)$row->revision,
                'snapshotSha256'=>(string)$row->snapshot_hash,
                'planId'=>(string)$row->plan_id,
                'catalogVersion'=>(string)$row->catalog_version,
                'definitionSha256'=>(string)$row->definition_sha256,
                'definition'=>$definition,
                'status'=>$status,
                'startsAt'=>self::utc($starts),
                'endsAt'=>$ends?self::utc($ends):null,
                'graceEndsAt'=>$grace?self::utc($grace):null,
                'effectivePlanId'=>$effective['planId'],
                'paidPrivilegesActive'=>$status==='active'&&$row->plan_id!=='free',
                'effectiveLimits'=>$effective['limits'],
                'effectiveFeatureFlags'=>$effective['featureFlags'],
                'source'=>$row->source,
            ];
        },3);
    }

    /**
     * INTERNAL ONLY. Call only *after* independently verifying settlement
     * finality or MFA-approved+audited admin action. This class does NOT
     * verify an invoice itself and no public billing mutation route exists.
     *
     * Event SHA is the identifier of VERIFIED evidence (not a bearer token).
     * Account row serialization + expectedRevision CAS gives exactly-one
     * authoritative head, with idempotent Lost ACK retries.
     */
    public function advanceTrusted(
        string $accountId,string $planId,int $expectedRevision,
        string $verifiedEventHash,string $source,
        CarbonImmutable $startsAt,?CarbonImmutable $endsAt,
    ):array {
        if(!preg_match('/^[a-f0-9]{64}$/D',$verifiedEventHash)
            ||!in_array($source,['settlement_verified','admin_mfa_approved'],true)
            ||$expectedRevision<1) {
            throw new RuntimeException('billing.unverified_transition');
        }
        $now=CarbonImmutable::now('UTC');
        $startsAt=$startsAt->utc();
        $endsAt=$endsAt?->utc();
        if($startsAt->greaterThan($now)
            ||($endsAt!==null&&!$endsAt->greaterThan($startsAt))
            ||($planId!=='free'&&$endsAt===null)) {
            throw new RuntimeException('billing.invalid_transition_period');
        }
        $definition=$this->catalog->get($planId);
        return DB::transaction(function()use(
            $accountId,$planId,$expectedRevision,$verifiedEventHash,$source,
            $startsAt,$endsAt,$now,$definition
        ){
            $this->requireReady($accountId);
            $head=$this->ensureFree($accountId,$now);
            $old=DB::table('billing_entitlement_snapshots_v1')
                ->where('id',$head->snapshot_id)
                ->where('account_id',$accountId)->first();
            if(!$old||(int)$old->revision!==(int)$head->revision) {
                throw new RuntimeException('billing.snapshot_head_invalid');
            }
            $this->verify($old);
            $existing=DB::table('billing_entitlement_snapshots_v1')
                ->where('account_id',$accountId)
                ->where('verified_event_hash',$verifiedEventHash)->first();
            if($existing){
                $this->verify($existing);
                abort_unless($existing->plan_id===$planId
                    &&$existing->source===$source
                    &&self::utc(self::date((string)$existing->starts_at))===self::utc($startsAt)
                    &&($existing->ends_at===null?null
                        :self::utc(self::date($existing->ends_at)))
                        ===($endsAt?self::utc($endsAt):null),409);
                return ['revision'=>(int)$existing->revision,'unchanged'=>true];
            }
            abort_unless((int)$head->revision===$expectedRevision,409);
            $id=$this->insertSnapshot($accountId,$expectedRevision+1,$definition,
                $startsAt,$endsAt,$source,$verifiedEventHash,(string)$old->snapshot_hash);
            $updated=DB::table('billing_entitlement_heads_v1')
                ->where('account_id',$accountId)
                ->where('revision',$expectedRevision)
                ->update([
                    'snapshot_id'=>$id,'revision'=>$expectedRevision+1,
                    'updated_at'=>$now,
                ]);
            abort_unless($updated===1,409);
            return ['revision'=>$expectedRevision+1,'unchanged'=>false];
        },3);
    }
}
