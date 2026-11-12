<?php
declare(strict_types=1);

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

/**
 * Account-scoped, append-only evidence of a created assignment.
 *
 * Do NOT reference assignment_records_v1 by FK: a deleted/expired assignment
 * must continue to consume this UTC month's creation allowance. UUIDs only;
 * no private titles, contents, policy documents or encryption keys.
 */
return new class extends Migration {
    public function up():void
    {
        Schema::create('assignment_creation_meter_v1',static function(Blueprint $t):void{
            $t->uuid('assignment_id')->primary();
            $t->foreignUuid('owner_account_id')->constrained('identity_accounts');
            $t->uuid('operation_id')->unique();
            $t->timestampTz('created_at');
            $t->index(['owner_account_id','created_at'],
                'assignment_creation_owner_month_index');
        });

        // Backfill current and earlier registered assignments without
        // changing their recorded authoritative server UTC created_at.
        // Single server-side INSERT SELECT: no plaintext materialization,
        // no re-encryption, no user-controlled month or quota reset.
        DB::table('assignment_creation_meter_v1')->insertUsing(
            ['assignment_id','owner_account_id','operation_id','created_at'],
            DB::table('assignment_records_v1')->select([
                'id','owner_account_id','operation_id','created_at',
            ]),
        );
    }

    public function down():void
    {
        // Billing evidence cannot be reset by an accidental rollback. A
        // dedicated audited retention process will be required in future.
        throw new RuntimeException('pb3.assignment_creation_meter.rollback_forbidden');
    }
};
