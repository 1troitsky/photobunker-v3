<?php
declare(strict_types=1);

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration {
    public function up():void
    {
        Schema::create('assignment_media_submissions_v1',static function(Blueprint $t):void{
            $t->uuid('id')->primary();
            $t->foreignUuid('assignment_id')->constrained('assignment_records_v1');
            $t->foreignUuid('contributor_account_id')->constrained('identity_accounts');
            $t->foreignUuid('media_id')->unique()->constrained('media_files_v1');
            $t->foreignUuid('media_grant_id')->constrained('media_recipient_grants_v1');
            $t->string('media_type',8);
            $t->uuid('operation_id')->unique();
            $t->char('contract_hash',64);
            $t->longText('contract_json');
            $t->text('contributor_signature');
            $t->unsignedInteger('policy_revision');
            $t->char('policy_hash',64);
            $t->char('media_contract_hash',64);
            $t->timestampTz('created_at');
            $t->index(['assignment_id','media_type','created_at','id'],
                'assignment_media_receipts');
            $t->index(['contributor_account_id','created_at','id'],
                'assignment_media_contributor');
        });
    }
    public function down():void{
        Schema::dropIfExists('assignment_media_submissions_v1');
    }
};