<?php
declare(strict_types=1);

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

/** Owner-only editorial association. NOT contributor submission/public grant. */
return new class extends Migration {
    public function up():void
    {
        Schema::create('safe_assignment_editorial_links_v1',static function(Blueprint $t):void{
            $t->uuid('safe_media_id')->primary();
            $t->uuid('link_id')->unique();
            $t->foreignUuid('owner_account_id')->constrained('identity_accounts');
            $t->foreignUuid('assignment_id')->constrained('assignment_records_v1');
            $t->uuid('source_media_id');
            $t->char('source_contract_hash',64);
            $t->char('safe_contract_hash',64);
            $t->char('assignment_root_hash',64);
            $t->char('contract_hash',64);
            $t->longText('contract_json');
            $t->text('account_signature');
            $t->string('state',12)->default('active');
            $t->uuid('detach_operation_id')->nullable()->unique();
            $t->char('detach_contract_hash',64)->nullable();
            $t->longText('detach_contract_json')->nullable();
            $t->text('detach_signature')->nullable();
            $t->timestampsTz();
            $t->index(['owner_account_id','assignment_id']);
        });
    }
    public function down():void
    {
        // Never forget a detached signed link either. Such history prevents
        // future versions misinterpreting old signatures as fresh permission.
        if(DB::table('safe_assignment_editorial_links_v1')->exists())
            throw new RuntimeException('pb3.safe_assignment_link.rollback_forbidden');
        Schema::dropIfExists('safe_assignment_editorial_links_v1');
    }
};
