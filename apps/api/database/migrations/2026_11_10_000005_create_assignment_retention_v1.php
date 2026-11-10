<?php
declare(strict_types=1);

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * P1-21: signed logical assignment retention (NOT a media ownership transfer).
 * Never cascade delete contributor-owned photo/media or grant tables.
 */
return new class extends Migration {
    public function up():void
    {
        Schema::table('assignment_records_v1',static function(Blueprint $t):void{
            $t->unsignedInteger('retention_revision')->default(1);
            $t->unsignedBigInteger('files_access_until')->nullable();
            $t->unsignedBigInteger('assignment_access_until')->nullable();
            $t->longText('latest_retention_contract')->nullable();
            $t->text('latest_retention_signature')->nullable();
            $t->index(['files_access_until','id'],'assignment_files_cutoff');
            $t->index(['assignment_access_until','id'],'assignment_archive_cutoff');
        });
        Schema::create('assignment_retention_events_v1',static function(Blueprint $t):void{
            $t->uuid('operation_id')->primary();
            $t->foreignUuid('assignment_id')->constrained('assignment_records_v1');
            $t->unsignedInteger('from_revision');
            $t->unsignedInteger('to_revision');
            $t->char('contract_hash',64);
            $t->longText('contract_json');
            $t->text('owner_signature');
            $t->unsignedBigInteger('occurred_at_ms');
            $t->timestampTz('created_at');
            $t->unique(['assignment_id','to_revision'],'assignment_retention_version_unique');
        });
        Schema::create('assignment_retention_tombstones_v1',static function(Blueprint $t):void{
            $t->foreignUuid('assignment_id')->primary()
                ->constrained('assignment_records_v1');
            $t->foreignUuid('owner_account_id')->constrained('identity_accounts');
            $t->char('root_policy_hash',64);
            $t->unsignedBigInteger('files_access_until')->nullable();
            $t->unsignedBigInteger('assignment_access_until')->nullable();
            $t->timestampTz('files_marked_at')->nullable();
            $t->timestampTz('assignment_marked_at')->nullable();
            // Not a claim about S3 absence. Retain signed history and pointers.
            $t->string('physical_status',40)->default('not_authorized');
            $t->timestampsTz();
        });
    }

    public function down():void
    {
        Schema::dropIfExists('assignment_retention_tombstones_v1');
        Schema::dropIfExists('assignment_retention_events_v1');
        Schema::table('assignment_records_v1',static function(Blueprint $t):void{
            $t->dropIndex('assignment_files_cutoff');
            $t->dropIndex('assignment_archive_cutoff');
            $t->dropColumn(['retention_revision','files_access_until',
                'assignment_access_until','latest_retention_contract',
                'latest_retention_signature']);
        });
    }
};
