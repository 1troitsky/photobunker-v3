<?php
declare(strict_types=1);

namespace App\Storage;

use Illuminate\Support\Carbon;
use Illuminate\Support\Facades\DB;

/**
 * Database-backed S3 circuit breaker. No remote health calls, account lookup,
 * credentials, media data or secret-bearing exception text are persisted.
 * Half-open probes are leased across PHP workers (including after restart).
 */
final class StorageProviderHealth
{
    private function setup(string $provider):void
    {
        if($provider!=='app_s3')throw new \RuntimeException('storage.unsupported_provider');
        DB::table('storage_provider_health')->insertOrIgnore([
            'provider'=>$provider,'state'=>'closed','failures'=>0,'epoch'=>0,
            'created_at'=>now(),'updated_at'=>now(),
        ]);
    }

    /** Check before any physical adapter call; only one half-open probe. */
    public function before(string $provider):int
    {
        if(!config('storage_resilience.breaker_enabled',true))return 0;
        return DB::transaction(function()use($provider):int{
            $this->setup($provider);
            $row=DB::table('storage_provider_health')->where('provider',$provider)
                ->lockForUpdate()->first();
            $now=now();
            if($row->state==='closed')return (int)$row->epoch;
            if($row->state==='open' && $row->open_until!==null
                && Carbon::parse($row->open_until)->greaterThan($now))
                throw new \RuntimeException('storage.circuit_open');
            if($row->state==='probing' && $row->probe_lease_until!==null
                && Carbon::parse($row->probe_lease_until)->greaterThan($now))
                throw new \RuntimeException('storage.circuit_open');
            // Expired cooldown/probe: give precisely one worker a new lease.
            $epoch=(int)$row->epoch+1;
            DB::table('storage_provider_health')->where('provider',$provider)
                ->update([
                    'state'=>'probing','epoch'=>$epoch,'open_until'=>null,
                    'probe_lease_until'=>$now->copy()->addSeconds(
                        max(1,(int)config('storage_resilience.probe_lease_seconds',15))),
                    'updated_at'=>$now,
                ]);
            return $epoch;
        },3);
    }

    /**
     * A late success/failure from a pre-open call or expired half-open probe
     * cannot override a newer worker's circuit decision.
     */
    public function succeeded(string $provider,?int $expectedEpoch=null):void
    {
        if(!config('storage_resilience.breaker_enabled',true))return;
        DB::transaction(function()use($provider,$expectedEpoch):void{
            $this->setup($provider);
            $row=DB::table('storage_provider_health')->where('provider',$provider)
                ->lockForUpdate()->first();
            if($expectedEpoch!==null && (int)$row->epoch!==$expectedEpoch)return;
            DB::table('storage_provider_health')->where('provider',$provider)->update([
                'state'=>'closed','failures'=>0,'open_until'=>null,
                'probe_lease_until'=>null,'last_success_at'=>now(),'updated_at'=>now(),
            ]);
        },3);
    }

    public function failed(string $provider,?int $expectedEpoch=null):void
    {
        if(!config('storage_resilience.breaker_enabled',true))return;
        DB::transaction(function()use($provider,$expectedEpoch):void{
            $this->setup($provider);
            $row=DB::table('storage_provider_health')->where('provider',$provider)
                ->lockForUpdate()->first();
            if($expectedEpoch!==null && (int)$row->epoch!==$expectedEpoch)return;
            $failures=min(1000000,(int)$row->failures+1);
            $threshold=max(1,(int)config('storage_resilience.failure_threshold',2));
            $open=$row->state==='probing'||$failures>=$threshold;
            $cooldown=max(1,(int)config('storage_resilience.cooldown_seconds',30));
            DB::table('storage_provider_health')->where('provider',$provider)->update([
                'state'=>$open?'open':'closed','failures'=>$failures,
                'epoch'=>$open?(int)$row->epoch+1:(int)$row->epoch,
                'open_until'=>$open?now()->addSeconds($cooldown):null,
                'probe_lease_until'=>null,
                'last_failure_at'=>now(),'updated_at'=>now(),
            ]);
        },3);
    }

    /** Operational, metadata-only status; never probes S3 or depends on auth. */
    public function status(string $provider='app_s3'):array
    {
        $this->setup($provider);
        $row=DB::table('storage_provider_health')->where('provider',$provider)->first();
        $remaining=($row->state==='open'&&$row->open_until!==null)
            ?max(0,now()->diffInSeconds(Carbon::parse($row->open_until),false))
            :0;
        return [
            'provider'=>$provider,'state'=>$row->state,
            'failures'=>(int)$row->failures,
            'retry_after_seconds'=>(int)ceil($remaining),
        ];
    }

    /** Physical adapter invocation; false PUT/DELETE is a real failed call. */
    public function call(string $provider,\Closure $operation,bool $falseIsFailure=false):mixed
    {
        $epoch=$this->before($provider);
        try{
            $result=$operation();
            if($falseIsFailure && $result===false){
                $this->failed($provider,$epoch);
                return false;
            }
            $this->succeeded($provider,$epoch);
            return $result;
        }catch(\Throwable $e){
            $this->failed($provider,$epoch);
            throw $e;
        }
    }
}
