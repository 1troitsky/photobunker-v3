<?php
declare(strict_types=1);

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

/**
 * #236 permanent live-asset parent purge fence; independent of existing
 * mutable per-provider cleanup tickets and temporary photo/media tombstones.
 *
 * Never cascade-delete this ledger with a photo/media/account. Retention and
 * irreversible administrative destruction require a separate reviewed policy.
 * This migration only creates a new table: it does not delete real media.
 */
return new class extends Migration {
    public function up():void
    {
        Schema::create('storage_purge_fences_v1', static function(Blueprint $table):void {
            $table->uuid('id')->primary();
            $table->uuid('account_id');
            $table->string('kind',16); // photo | media (parent scope, NOT chunk)
            $table->uuid('parent_id');
            $table->uuid('operation_id');
            $table->string('reason',20); // user | ttl | panic | remote_wipe
            $table->timestampTz('created_at');
            $table->unique(['account_id','kind','parent_id'],'purge_fence_parent_unique');
            $table->index(['account_id','created_at'],'purge_fence_account_index');
        });
        // PostgreSQL is production. Protect against accidental UPDATE/DELETE
        // bypassing the PHP service, while keeping this migration SQLite-testable.
        if (DB::getDriverName()==='pgsql') {
            DB::unprepared(<<<'SQL'
CREATE OR REPLACE FUNCTION pb3_purge_fence_236_immutable() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
    RAISE EXCEPTION 'storage.purge_fence_immutable' USING ERRCODE = '55000';
END;
$$
SQL);
            DB::unprepared(<<<'SQL'
CREATE TRIGGER pb3_purge_fence_236_immutable
BEFORE UPDATE OR DELETE ON storage_purge_fences_v1
FOR EACH ROW EXECUTE FUNCTION pb3_purge_fence_236_immutable()
SQL);
        } elseif (DB::getDriverName()==='sqlite') {
            DB::unprepared(<<<'SQL'
CREATE TRIGGER pb3_purge_fence_236_no_update
BEFORE UPDATE ON storage_purge_fences_v1
BEGIN SELECT RAISE(ABORT, 'storage.purge_fence_immutable'); END
SQL);
            DB::unprepared(<<<'SQL'
CREATE TRIGGER pb3_purge_fence_236_no_delete
BEFORE DELETE ON storage_purge_fences_v1
BEGIN SELECT RAISE(ABORT, 'storage.purge_fence_immutable'); END
SQL);
        }
    }

    public function down():void
    {
        // Only DB migration rollback may remove the physical fence table.
        // NEVER invoke destructive migration rollback in a real environment.
        Schema::dropIfExists('storage_purge_fences_v1');
        if (DB::getDriverName()==='pgsql') {
            DB::unprepared('DROP FUNCTION IF EXISTS pb3_purge_fence_236_immutable()');
        }
    }
};
