<?php
declare(strict_types=1);

namespace App\Plans;

use RuntimeException;

/**
 * One server-owned catalog. Revisions are explicit; no tariff constants in
 * controllers, Vue or database migrations. Stored snapshots survive updates.
 */
final class PlanCatalog
{
    /** @return array<string,PlanDefinition> */
    public function definitions(): array
    {
        $catalog=config('plans');
        if(!is_array($catalog)||!is_array($catalog['plans']??null)
            ||array_keys($catalog['plans'])!==[
                'free','go','pro','unlimited','unlimited_plus',
            ])throw new RuntimeException('billing.catalog_invalid_plans');
        $out=[];
        foreach($catalog['plans'] as $id=>$value){
            if(!is_array($value))throw new RuntimeException('billing.catalog_invalid_plan');
            $out[$id]=PlanDefinition::fromConfig($id,$catalog,$value);
        }
        return $out;
    }

    public function get(string $id): PlanDefinition
    {
        $plans=$this->definitions();
        if(!isset($plans[$id]))throw new RuntimeException('billing.catalog_unknown_plan');
        return $plans[$id];
    }

    public function publicCatalog():array
    {
        $plans=$this->definitions();
        return [
            'schemaVersion'=>1,
            'catalogVersion'=>$plans['free']->version,
            'effectiveAt'=>$plans['free']->effectiveAt,
            'currency'=>'USD',
            'unitPolicy'=>'OPEN_GB_VS_GIB',
            'plans'=>array_values(array_map(static fn(PlanDefinition $p)=>
                [...$p->value,'definitionSha256'=>$p->sha256],$plans)),
        ];
    }
}
