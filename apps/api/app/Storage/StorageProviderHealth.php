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
            'provider'=>$provider,'state'=>'closed','failures'=>0,
            'created_at'=>now(),'updated_at'=>now(),
        ]);
    }

    /** Check before any physical adapter call; only one half-open probe. */
    public function before(string $provider):void
    {
        if(!config('storage_resilience.breaker_enabled',true))return;
        DB::transaction(function()use($provider):void{
            $this->setup($provider);
            $row=DB::table('storage_provider_health')->where('provider',$provider)
                ->lockForUpdate()->first();
            $now=now();
            if($row->state==='closed')return;
            if($row->state==='open' && $row->open_until!==null
                && Carbon::parse($row->open_until)->greaterThan($now))
                throw new \RuntimeException('storage.circuit_open');
            if($row->state==='probing' && $row->probe_lease_until!==null
                && Carbon::parse($row->probe_lease_until)->greaterThan($now))
                throw new \RuntimeException('storage.circuit_open');
            // Expired cooldown/probe: give precisely one worker a new lease.
            DB::table('storage_provider_health')->where('provider',$provider)
                ->update([
                    'state'=>'probing','open_until'=>null,
                    'probe_lease_until'=>$now->copy()->addSeconds(
                        max(1,(int)config('storage_resilience.probe_lease_seconds',15))),
                    'updated_at'=>$now,
                ]);
        },3);
    }

    public function succeeded(string $provider):void
    {
        if(!config('storage_resilience.breaker_enabled',true))return;
        $this->setup($provider);
        DB::table('storage_provider_health')->where('provider',$provider)->update([
            'state'=>'closed','failures'=>0,'open_until'=>null,
            'probe_lease_until'=>null,'last_success_at'=>now(),'updated_at'=>now(),
        ]);
    }

    public function failed(string $provider):void
    {
        if(!config('storage_resilience.breaker_enabled',true))return;
        DB::transaction(function()use($provider):void{
            $this->setup($provider);
            $row=DB::table('storage_provider_health')->where('provider',$provider)
                ->lockForUpdate()->first();
            $failures=min(1000000,(int)$row->failures+1);
            $threshold=max(1,(int)config('storage_resilience.failure_threshold',2));
            $open=$row->state==='probing'||$failures>=$threshold;
            $cooldown=max(1,(int)config('storage_resilience.cooldown_seconds',30));
            DB::table('storage_provider_health')->where('provider',$provider)->update([
                'state'=>$open?'open':'closed','failures'=>$failures,
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
        $this->before($provider);
        try{
            $result=$operation();
            if($falseIsFailure && $result===false){
                $this->failed($provider);
                return false;
            }
            $this->succeeded($provider);
            return $result;
        }catch(\Throwable $e){
            $this->failed($provider);
            throw $e;
        }
    }
}
