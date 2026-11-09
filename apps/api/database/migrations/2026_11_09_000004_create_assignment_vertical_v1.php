<?php
declare(strict_types=1);

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration {
    public function up(): void
    {
        Schema::create('assignment_records_v1', function (Blueprint $t): void {
            $t->uuid('id')->primary();
            $t->foreignUuid('owner_account_id')->constrained('identity_accounts');
            $t->uuid('operation_id')->unique();
            $t->char('contract_hash',64);
            $t->longText('contract_json');
            $t->text('owner_signature');
            $t->longText('private_envelope_json'); // ciphertext only
            $t->string('state',16)->default('active');
            $t->unsignedInteger('revision')->default(1);
            $t->unsignedInteger('policy_revision')->default(1);
            $t->unsignedInteger('photo_goal')->nullable();
            $t->unsignedBigInteger('starts_at');
            $t->unsignedBigInteger('ends_at')->nullable();
            $t->timestampsTz();
            $t->index(['owner_account_id','id']);
            $t->index(['state','starts_at','ends_at']);
        });
        Schema::create('assignment_invites_v1', function (Blueprint $t): void {
            $t->uuid('id')->primary();
            $t->foreignUuid('assignment_id')->constrained('assignment_records_v1');
            $t->foreignUuid('owner_account_id')->constrained('identity_accounts');
            $t->foreignUuid('recipient_account_id')->constrained('identity_accounts');
            $t->string('role',20);
            $t->string('state',16)->default('pending');
            $t->char('recipient_key_digest',64);
            $t->char('contract_hash',64);
            $t->longText('contract_json');
            $t->text('owner_signature');
            $t->unsignedBigInteger('expires_at');
            $t->uuid('accepted_operation_id')->nullable()->unique();
            $t->longText('accepted_contract')->nullable();
            $t->text('accepted_signature')->nullable();
            $t->timestampTz('accepted_at')->nullable();
            $t->timestampsTz();
            $t->unique(['assignment_id','recipient_account_id'],'assignment_unique_recipient');
            $t->index(['recipient_account_id','state','expires_at','id'],'assignment_inbox');
        });
        Schema::create('assignment_submissions_v1', function (Blueprint $t): void {
            $t->uuid('id')->primary();
            $t->foreignUuid('assignment_id')->constrained('assignment_records_v1');
            $t->foreignUuid('contributor_account_id')->constrained('identity_accounts');
            $t->foreignUuid('photo_id')->unique()->constrained('photo_records');
            $t->foreignUuid('photo_grant_id')->constrained('photo_access_grants');
            $t->uuid('operation_id')->unique();
            $t->char('contract_hash',64);
            $t->longText('contract_json');
            $t->text('contributor_signature');
            $t->unsignedInteger('policy_revision');
            $t->timestampTz('created_at');
            $t->index(['assignment_id','created_at','id']);
            $t->index(['contributor_account_id','created_at','id']);
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('assignment_submissions_v1');
        Schema::dropIfExists('assignment_invites_v1');
        Schema::dropIfExists('assignment_records_v1');
    }
};
