<?php
declare(strict_types=1);

namespace App\Billing;

use Illuminate\Support\Facades\DB;
use RuntimeException;

/**
 * Shared atomic signed-reservation admission for Photo/v1 + MediaFile/v1.
 *
 * Must run INSIDE the caller's DB::transaction(), before any parent/chunks
 * are inserted. The identity account row is the serialization mutex for both
 * protocols and every device belonging to that account.
 *
 * Product file/byte limits come from a verified immutable entitlement:
 * DECIMAL_GB_TB_V1 (10^9/10^12 bytes). Legacy OPEN_GB_VS_GIB
 * snapshots remain on the prior Free technical byte guard until replaced
 * by an independently verified new entitlement event. Never reinterpret a
 * null byteCeiling as unbounded physical storage.
 */
final class QuotaAdmission
{
    public function __construct(
        private readonly EntitlementLedger $ledger,
        private readonly AccountUsage $usage,
    ) {}

    /**
     * The same resolved bound is used by admission and read-only billing UI.
     * Both derive from the trusted account's current effective entitlement.
     *
     * @return array{enforcedByteCeiling:int,unitPolicy:string,source:string,technicalByteGuard:?int}
     */
    public static function storagePolicy(array $entitlement):array
    {
        $storage=$entitlement['effectiveLimits']['storage']??null;
        $plan=$entitlement['effectivePlanId']??null;
        if(!is_array($storage)||!is_string($plan)
            ||!in_array($plan,['free','go','pro','unlimited','unlimited_plus'],true))
            throw new RuntimeException('quota.invalid_entitlement');
        $legacy=config('photo_sync.bootstrap_free_byte_cap');
        if(!is_int($legacy)||$legacy<1)
            throw new RuntimeException('quota.invalid_bootstrap_guard');

        $policy=$storage['unitPolicy']??null;
        $ceiling=$storage['byteCeiling']??null;
        if($policy==='OPEN_GB_VS_GIB'&&$ceiling===null){
            return [
                'enforcedByteCeiling'=>$legacy,'unitPolicy'=>$policy,
                'source'=>'legacy_technical_guard','technicalByteGuard'=>$legacy,
            ];
        }
        if($policy!=='DECIMAL_GB_TB_V1'
            ||!is_int($ceiling)||$ceiling<1
            ||!is_int($storage['amount']??null)||$storage['amount']<1
            ||!in_array($storage['unit']??null,['GB','TB'],true))
            throw new RuntimeException('quota.invalid_byte_policy');

        $factor=$storage['unit']==='GB'?1000000000:1000000000000;
        if($storage['amount']>intdiv(PHP_INT_MAX,$factor)
            ||$ceiling!==$storage['amount']*$factor)
            throw new RuntimeException('quota.invalid_byte_policy');

        // A stricter operator Free safety limit remains an independent bound
        // only on Free; paid plans use their approved commercial ceiling.
        $free=$plan==='free';
        return [
            'enforcedByteCeiling'=>$free?min($ceiling,$legacy):$ceiling,
            'unitPolicy'=>$policy,
            'source'=>$free?'plan_plus_free_technical_guard':'plan_entitlement',
            'technicalByteGuard'=>$free?$legacy:null,
        ];
    }

    /**
     * @return array{planId:string,revision:int,filesUsed:int,fileLimit:?int,recordedCipherBytes:int,enforcedByteCeiling:int,byteUnitPolicy:string,quotaSource:string,technicalByteGuard:?int}
     */
    public function admit(string $accountId,int $requestedCipherBytes):array
    {
        abort_unless($requestedCipherBytes>0,422);

        // Acquiring this lock *before* any count ensures that concurrent
        // Photo and Media reservations cannot both admit the last slot.
        $account=DB::table('identity_accounts')->where('id',$accountId)
            ->lockForUpdate()->first();
        abort_unless($account&&$account->status==='ready',401);

        // Fail closed on missing/corrupt entitlement chain, and never accept
        // a caller-supplied planId, file count or measured byte count.
        $entitlement=$this->ledger->current($accountId);
        $limits=$entitlement['effectiveLimits']??null;
        if(!is_array($limits)||!array_key_exists('maxMediaFiles',$limits)
            ||!is_array($limits['storage']??null)) {
            throw new RuntimeException('quota.invalid_entitlement');
        }
        $countLimit=$limits['maxMediaFiles'];
        if($countLimit!==null&&(!is_int($countLimit)||$countLimit<0)) {
            throw new RuntimeException('quota.invalid_entitlement');
        }
        // The Free bootstrap file cap is also an independent technical
        // admission ceiling (the pre-existing tests may set it lower than
        // the published Free=50). Preserve the stricter legacy behavior
        // without accidentally capping confirmed Go/Pro file entitlements.
        if($entitlement['effectivePlanId']==='free'){
            $freeGuard=config('photo_sync.bootstrap_free_file_cap');
            if(!is_int($freeGuard)||$freeGuard<0)
                throw new RuntimeException('quota.invalid_bootstrap_guard');
            $countLimit=$countLimit===null
                ?$freeGuard:min($countLimit,$freeGuard);
        }
        $policy=self::storagePolicy($entitlement);

        // AccountUsage is read-only on the public billing endpoint. Only THIS
        // transaction (under identity row lock) gives its counts atomic
        // admission semantics for both signed upload protocols.
        $measured=$this->usage->measure($accountId);
        $files=(int)$measured['activeLogicalMediaFiles'];
        $bytes=(int)$measured['recordedCipherBytes'];
        if($files<0||$bytes<0)throw new RuntimeException('quota.invalid_usage');

        if($countLimit!==null && $files >= $countLimit) abort(413,'quota.file_limit');
        $ceiling=$policy['enforcedByteCeiling'];
        // Overflow-safe subtraction; pending/active ciphertext is reserved
        // exactly once. A signed lost-ACK replay never reserves another file.
        if($requestedCipherBytes>$ceiling||$bytes>$ceiling-$requestedCipherBytes)
            abort(413,'quota.storage_limit');

        return [
            'planId'=>(string)$entitlement['effectivePlanId'],
            'revision'=>(int)$entitlement['revision'],
            'filesUsed'=>$files,
            'fileLimit'=>$countLimit,
            'recordedCipherBytes'=>$bytes,
            'enforcedByteCeiling'=>$ceiling,
            'byteUnitPolicy'=>$policy['unitPolicy'],
            'quotaSource'=>$policy['source'],
            'technicalByteGuard'=>$policy['technicalByteGuard'],
        ];
    }
}
