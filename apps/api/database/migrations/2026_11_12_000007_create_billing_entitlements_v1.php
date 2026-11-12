<?php
declare(strict_types=1);

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration {
    public function up():void
    {
        // Never rewrite a paid snapshot: updates append a new revision and
        // atomically move the account-owned head under an identity row lock.
        Schema::create('billing_entitlement_snapshots_v1',function(Blueprint $t):void{
            $t->bigIncrements('id');
            $t->foreignUuid('account_id')->constrained('identity_accounts');
            $t->unsignedInteger('revision');
            $t->string('plan_id',24);
            $t->string('catalog_version',64);
            $t->char('definition_sha256',64);
            $t->text('definition_json');
            $t->timestampTz('starts_at');
            $t->timestampTz('ends_at')->nullable();
            $t->timestampTz('grace_ends_at')->nullable();
            $t->string('source',32);
            $t->char('verified_event_hash',64);
            $t->char('previous_hash',64)->nullable();
            $t->char('snapshot_hash',64);
            $t->timestampTz('created_at');
            $t->unique(['account_id','revision'],'billing_account_revision_unique');
            $t->unique(['account_id','verified_event_hash'],'billing_account_event_unique');
        });
        Schema::create('billing_entitlement_heads_v1',function(Blueprint $t):void{
            $t->foreignUuid('account_id')->primary()->constrained('identity_accounts');
            $t->unsignedBigInteger('snapshot_id');
            $t->unsignedInteger('revision');
            $t->timestampTz('updated_at');
            $t->foreign('snapshot_id')->references('id')
                ->on('billing_entitlement_snapshots_v1');
        });
    }

    public function down():void
    {
        // Billing entitlement history is security/settlement evidence;
        // rollback must never quietly erase a paid/grace snapshot.
        throw new RuntimeException('pb3.billing_entitlements.rollback_forbidden');
    }
};
