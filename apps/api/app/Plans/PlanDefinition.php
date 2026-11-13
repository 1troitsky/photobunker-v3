<?php
declare(strict_types=1);

namespace App\Plans;

use RuntimeException;

/**
 * Immutable *value* snapshot of the owner-approved plans.php revision.
 * The live catalog can change with a new catalog_version, but an already
 * committed account snapshot stores its original serialized definition.
 * Historic OPEN_GB_VS_GIB definitions remain byte-for-byte immutable.
 * Owner-approved DECIMAL_GB_TB_V1 is introduced only in catalog 2026-11-12.
 * No payment authority or retroactive entitlement upgrade is introduced.
 */
final readonly class PlanDefinition
{
    private function __construct(
        public string $id,
        public string $version,
        public string $effectiveAt,
        public array $value,
        public string $json,
        public string $sha256,
    ) {}

    public static function fromConfig(string $id, array $catalog, array $plan): self
    {
        $version=$catalog['catalog_version']??null;
        $effective=$catalog['effective_at']??null;
        $policy=$catalog['storage_unit_policy']??null;
        if (!is_string($version)||!preg_match('/^pb3-\d{4}-\d{2}-\d{2}$/D',$version)
            ||!is_string($effective)
            ||!preg_match('/^\d{4}-\d{2}-\d{2}T00:00:00Z$/D',$effective)
            ||($catalog['schema_version']??null)!==1
            ||($catalog['currency']??null)!=='USD'
            ||!in_array($policy,['OPEN_GB_VS_GIB','DECIMAL_GB_TB_V1'],true)) {
            throw new RuntimeException('billing.catalog_invalid_metadata');
        }
        // Bind policy to catalog version. Do not let an old signed definition
        // silently change byte units without a new immutable catalog version.
        if(($policy==='DECIMAL_GB_TB_V1'&&$version<'pb3-2026-11-12')
            ||($policy==='OPEN_GB_VS_GIB'&&$version>='pb3-2026-11-12'))
            throw new RuntimeException('billing.catalog_policy_version_mismatch');
        if (substr($version,4)!==substr($effective,0,10)) {
            throw new RuntimeException('billing.catalog_effective_date_mismatch');
        }
        $keys=[
            'monthly_price_cents','period_prices_cents','assignment_creations_per_month',
            'max_media_files','storage_quota','max_retention',
            'manual_backup_updates_per_week','auto_backup_updates',
            'encrypted_cloud_backup','emergency_pin','remote_emergency','grace_days',
            'priority_support','matrix_e2ee_messages','own_matrix_homeserver','byo_s3',
        ];
        if (array_diff($keys,array_keys($plan))!==[]
            ||array_diff(array_keys($plan),$keys)!==[]) {
            throw new RuntimeException('billing.catalog_invalid_fields');
        }
        foreach(['monthly_price_cents','assignment_creations_per_month','max_media_files',
            'manual_backup_updates_per_week','grace_days'] as $field) {
            if ($plan[$field]!==null && (!is_int($plan[$field])||$plan[$field]<0)) {
                throw new RuntimeException('billing.catalog_invalid_limit');
            }
        }
        foreach(['encrypted_cloud_backup','emergency_pin','remote_emergency',
            'priority_support','matrix_e2ee_messages','own_matrix_homeserver','byo_s3'] as $flag) {
            if(!is_bool($plan[$flag]))throw new RuntimeException('billing.catalog_invalid_flag');
        }
        $quota=$plan['storage_quota'];
        if(!is_array($quota)||!is_int($quota['amount']??null)||$quota['amount']<1
            ||!in_array($quota['unit']??null,['GB','TB'],true)) {
            throw new RuntimeException('billing.catalog_invalid_storage_quota');
        }
        $byteCeiling=null;
        if($policy==='DECIMAL_GB_TB_V1'){
            $multiplier=$quota['unit']==='GB'?1000000000:1000000000000;
            if($quota['amount']>intdiv(PHP_INT_MAX,$multiplier))
                throw new RuntimeException('billing.catalog_storage_overflow');
            $byteCeiling=$quota['amount']*$multiplier;
        }
        $periods=$plan['period_prices_cents'];
        if(!is_array($periods)||($periods[1]??null)!==$plan['monthly_price_cents']) {
            throw new RuntimeException('billing.catalog_invalid_prices');
        }
        foreach($periods as $months=>$price) {
            if(!in_array($months,[1,6,12],true)||!is_int($price)||$price<0) {
                throw new RuntimeException('billing.catalog_invalid_prices');
            }
        }
        $retention=$plan['max_retention'];
        if(!is_array($retention)
            ||!(isset($retention['days'])&&is_int($retention['days'])&&$retention['days']>0
                ||($retention['mode']??null)==='while_plan_active_with_assignment_policy')) {
            throw new RuntimeException('billing.catalog_invalid_retention');
        }
        $auto=$plan['auto_backup_updates'];
        if(!is_array($auto)
            ||!array_key_exists('per_week',$auto)||!array_key_exists('per_day',$auto)) {
            throw new RuntimeException('billing.catalog_invalid_backup');
        }
        foreach(['per_week','per_day'] as $key) {
            if($auto[$key]!==null&&(!is_int($auto[$key])||$auto[$key]<0)) {
                throw new RuntimeException('billing.catalog_invalid_backup');
            }
        }
        if($plan['matrix_e2ee_messages']!==true||$plan['emergency_pin']!==true
            ||(($plan['byo_s3']||$plan['own_matrix_homeserver'])
                &&$id!=='unlimited_plus')
            ||(($id==='unlimited_plus')
                &&(!$plan['byo_s3']||!$plan['own_matrix_homeserver']))) {
            throw new RuntimeException('billing.catalog_privilege_violation');
        }
        $value=[
            'schemaVersion'=>1,
            'planId'=>$id,
            'catalogVersion'=>$version,
            'effectiveAt'=>$effective,
            'currency'=>'USD',
            'monthlyPriceCents'=>$plan['monthly_price_cents'],
            'periodPricesCents'=>$periods,
            'limits'=>[
                'assignmentCreationsPerMonth'=>$plan['assignment_creations_per_month'],
                'maxMediaFiles'=>$plan['max_media_files'],
                'storage'=>[
                    'amount'=>$quota['amount'],'unit'=>$quota['unit'],
                    'byteCeiling'=>$byteCeiling,'unitPolicy'=>$policy,
                ],
                'retention'=>$retention,
                'manualBackupUpdatesPerWeek'=>$plan['manual_backup_updates_per_week'],
                'autoBackupUpdates'=>$auto,
                'graceDays'=>$plan['grace_days'],
            ],
            'featureFlags'=>[
                'encryptedCloudBackup'=>$plan['encrypted_cloud_backup'],
                'emergencyPin'=>$plan['emergency_pin'],
                'remoteEmergency'=>$plan['remote_emergency'],
                'prioritySupport'=>$plan['priority_support'],
                'matrixE2eeMessages'=>$plan['matrix_e2ee_messages'],
                'ownMatrixHomeserver'=>$plan['own_matrix_homeserver'],
                'byoS3'=>$plan['byo_s3'],
            ],
        ];
        $json=json_encode($value,JSON_UNESCAPED_SLASHES|JSON_THROW_ON_ERROR);
        return new self($id,$version,$effective,$value,$json,hash('sha256',$json));
    }
}
