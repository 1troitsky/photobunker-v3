<?php
declare(strict_types=1);

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

return new class extends Migration {
    public function up():void
    {
        Schema::table('media_recipient_grants_v1',static function(Blueprint $t):void{
            // Only a v3 account-signed safe_read grant may populate these.
            // media_id always points at the independently encrypted DERIVATIVE.
            $t->foreignUuid('source_media_id')->nullable()
                ->constrained('media_files_v1');
            $t->char('source_contract_hash',64)->nullable();
            $t->index(['source_media_id','state','expires_at'],
                'safe_media_grant_source_access');
        });
    }

    public function down():void
    {
        if(DB::table('media_recipient_grants_v1')
            ->whereNotNull('source_media_id')->exists())
            throw new RuntimeException('pb3.safe_grants.rollback_forbidden');
        Schema::table('media_recipient_grants_v1',static function(Blueprint $t):void{
            $t->dropIndex('safe_media_grant_source_access');
            $t->dropForeign(['source_media_id']);
            $t->dropColumn(['source_media_id','source_contract_hash']);
        });
    }
};
