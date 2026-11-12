<?php
declare(strict_types=1);

namespace App\Billing;

use Carbon\CarbonImmutable;
use Illuminate\Support\Facades\DB;

/**
 * Read-only server measurement. This is NOT an atomic quota reservation:
 * #192/#200/#203 must enforce limits at the actual write transaction.
 */
final class AccountUsage
{
    public function measure(string $accountId,?CarbonImmutable $at=null):array
    {
        $at=($at??CarbonImmutable::now('UTC'))->utc();
        $from=$at->startOfMonth();
        $to=$from->addMonth();
        $nowMs=((int)$at->format('U'))*1000;
        // Append-only metering is the source of truth even when a signed
        // assignment was later physically deleted after retention/GC.
        $assignments=(int)DB::table('assignment_creation_meter_v1')
            ->where('owner_account_id',$accountId)
            ->where('created_at','>=',$from)
            ->where('created_at','<',$to)->count();
        $photos=(int)DB::table('photo_records')
            ->where('account_id',$accountId)
            ->where('state','!=','deleting')
            ->where('expires_at','>',$nowMs)->count();
        $media=(int)DB::table('media_files_v1')
            ->where('account_id',$accountId)
            ->where('state','!=','deleting')
            ->where('expires_at','>',$nowMs)->count();
        $photoBytes=(int)DB::table('photo_objects as o')
            ->join('photo_records as p','p.id','=','o.photo_id')
            ->where('p.account_id',$accountId)
            ->where('p.state','!=','deleting')
            ->where('p.expires_at','>',$nowMs)->sum('o.bytes');
        $mediaBytes=(int)DB::table('media_files_v1')
            ->where('account_id',$accountId)
            ->where('state','!=','deleting')
            ->where('expires_at','>',$nowMs)->sum('cipher_bytes');
        return [
            'asOfUtc'=>$at->format('Y-m-d\TH:i:s\Z'),
            'utcMonthStart'=>$from->format('Y-m-d\TH:i:s\Z'),
            'utcMonthEndExclusive'=>$to->format('Y-m-d\TH:i:s\Z'),
            'assignmentsCreatedThisUtcMonth'=>$assignments,
            'activeLogicalMediaFiles'=>$photos+$media,
            'recordedCipherBytes'=>$photoBytes+$mediaBytes,
            'measurement'=>'read_only_non_atomic',
            'enforcedByteCeiling'=>null,
            'byteUnitPolicy'=>'OPEN_GB_VS_GIB',
        ];
    }
}
