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
 * Product FILE counts follow the verified versioned entitlement snapshot.
 * PAID byte units are deliberately UNRESOLVED (GB vs GiB). Until approved,
 * preserve the exact existing Free/bootstrap technical ciphertext guard
 * for every plan; never treat snapshot byteCeiling=null as unlimited bytes.
 */
final class QuotaAdmission
{
    public function __construct(
        private readonly EntitlementLedger $ledger,
        private readonly AccountUsage $usage,
    ) {}

    /**
     * @return array{planId:string,revision:int,filesUsed:int,fileLimit:?int,recordedCipherBytes:int,technicalByteGuard:int}
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
        $storage=$limits['storage'];
        if(($storage['unitPolicy']??null)!=='OPEN_GB_VS_GIB'
            ||!array_key_exists('byteCeiling',$storage)
            ||$storage['byteCeiling']!==null) {
            // Future owner-approved byte ceilings require a separately
            // versioned policy and acceptance; no implicit unit conversion.
            throw new RuntimeException('quota.unapproved_byte_policy');
        }

        // AccountUsage is read-only on the public billing endpoint. Only THIS
        // transaction (under identity row lock) gives its counts atomic
        // admission semantics for both signed upload protocols.
        $measured=$this->usage->measure($accountId);
        $files=(int)$measured['activeLogicalMediaFiles'];
        $bytes=(int)$measured['recordedCipherBytes'];
        if($files<0||$bytes<0)throw new RuntimeException('quota.invalid_usage');

        if($countLimit!==null && $files >= $countLimit) abort(413,'quota.file_limit');
        $guard=config('photo_sync.bootstrap_free_byte_cap');
        if(!is_int($guard)||$guard<1)
            throw new RuntimeException('quota.invalid_bootstrap_guard');
        // Overflow-safe subtraction; pending/active ciphertext is reserved
        // once at insert and not charged a second time during finalize/retry.
        if($requestedCipherBytes>$guard||$bytes>$guard-$requestedCipherBytes)
            abort(413,'quota.technical_storage_guard');

        return [
            'planId'=>(string)$entitlement['effectivePlanId'],
            'revision'=>(int)$entitlement['revision'],
            'filesUsed'=>$files,
            'fileLimit'=>$countLimit,
            'recordedCipherBytes'=>$bytes,
            'technicalByteGuard'=>$guard,
        ];
    }
}
