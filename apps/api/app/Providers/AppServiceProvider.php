<?php
declare(strict_types=1);

namespace App\Providers;

use App\Storage\AppS3Adapter;
use App\Storage\StorageAdapter;
use Illuminate\Support\ServiceProvider;

final class AppServiceProvider extends ServiceProvider
{
    public function register(): void
    {
        $this->app->bind(StorageAdapter::class,AppS3Adapter::class);
    }

    public function boot(): void {}
}
