<?php
declare(strict_types=1);

namespace App\Providers;

use App\Storage\AppS3Adapter;
use App\Storage\StorageAdapter;
use Illuminate\Http\Request;
use Illuminate\Cache\RateLimiting\Limit;
use Illuminate\Support\Facades\RateLimiter;
use Illuminate\Support\ServiceProvider;

final class AppServiceProvider extends ServiceProvider
{
    public function register(): void
    {
        $this->app->bind(StorageAdapter::class,AppS3Adapter::class);
    }

    public function boot(): void
    {
        // Preserve each existing budget while isolating signed-in accounts
        // behind one NAT. Anonymous callers retain the original IP budget.
        foreach (['billing' => 40, 'sharing' => 40, 'photos' => 120] as $scope => $maximum) {
            RateLimiter::for('pb3-'.$scope, static function(Request $request) use ($scope, $maximum): Limit {
                $account = $request->session()->get('identity_account');
                $authenticated = is_string($account)
                    && preg_match('/^[a-f0-9-]{36}$/D', $account) === 1;
                return Limit::perMinute($maximum)->by($authenticated
                    ? $scope.'-account:'.$account
                    : $scope.'-ip:'.($request->ip() ?? 'unknown'));
            });
        }
        // Anonymous key-only registration/recovery must stay IP bounded, but
        // after a genuine server-issued Identity session another account on
        // the same office/hotel NAT must have its OWN 40/min login budget.
        // Never trust request-provided account IDs or headers for this key.
        RateLimiter::for('pb3-identity',static function(Request $request):Limit{
            $account=$request->session()->get('identity_account');
            $authenticated=is_string($account)
                &&preg_match('/^[a-f0-9-]{36}$/D',$account)===1;
            return Limit::perMinute(40)->by($authenticated
                ?'identity-account:'.$account
                :'identity-ip:'.($request->ip()??'unknown'));
        });
        // A shared office/hotel NAT must never cause one legitimate account
        // to consume another account's technical request budget. The account
        // ID comes only from authenticated server-side Laravel session state,
        // NEVER a browser-provided query parameter/header.
        RateLimiter::for('pb3-media',static function(Request $request):Limit{
            $account=$request->session()->get('identity_account');
            $authenticated=is_string($account)
                &&preg_match('/^[a-f0-9-]{36}$/D',$account)===1;
            $configKey=$authenticated
                ?'operational_limits.media.requests_per_minute_per_account'
                :'operational_limits.media.unauthenticated_requests_per_minute_per_ip';
            $max=config($configKey);
            if(!is_int($max)||$max<1)
                throw new \RuntimeException('media.operational_limit_unconfigured');
            return Limit::perMinute($max)->by(
                $authenticated?'media-account:'.$account
                    :'media-ip:'.($request->ip()??'unknown'));
        });
        RateLimiter::for('pb3-assignments', static function(Request $request):Limit {
            $account=$request->session()->get('identity_account');
            $authenticated=is_string($account)
                &&preg_match('/^[a-f0-9-]{36}$/D',$account)===1;
            $configKey=$authenticated
                ?'operational_limits.assignments.requests_per_minute_per_account'
                :'operational_limits.assignments.unauthenticated_requests_per_minute_per_ip';
            $max=config($configKey);
            if(!is_int($max)||$max<1)throw new \RuntimeException('assignments.operational_limit_unconfigured');
            return Limit::perMinute($max)->by(
                $authenticated?'account:'.$account:'ip:'.($request->ip()??'unknown'));
        });
    }
}
