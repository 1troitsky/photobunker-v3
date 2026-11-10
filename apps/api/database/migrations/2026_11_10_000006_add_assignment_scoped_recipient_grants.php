<?php
declare(strict_types=1);

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;
use Illuminate\Support\Facades\DB;

/**
 * An independent owner-signed recipient grant is NOT revoked by a Fieldwork
 * owner. Only NEW, contributor-signed v2 grants are bound to one assignment.
 * Existing v1 grants have NULL scope and keep their original ACL/TTL.
 */
return new class extends Migration {
    public function up():void
    {
        Schema::table('photo_access_grants',static function(Blueprint $t):void{
            $t->foreignUuid('assignment_id')->nullable()
                ->constrained('assignment_records_v1');
            $t->index(['assignment_id','state','expires_at'],
                'photo_grants_assignment_scope');
        });
        Schema::table('media_recipient_grants_v1',static function(Blueprint $t):void{
            $t->foreignUuid('assignment_id')->nullable()
                ->constrained('assignment_records_v1');
            $t->index(['assignment_id','state','expires_at'],
                'media_grants_assignment_scope');
        });
    }

    public function down():void
    {
        // A rollback that drops assignment_id would erase the security
        // boundary on already-issued v2 E2EE recipient grants. Check BOTH
        // tables before changing either schema. A live rollback still
        // requires stopping writers: this query is not a concurrency lock.
        if(DB::table('photo_access_grants')->whereNotNull('assignment_id')->exists()
            ||DB::table('media_recipient_grants_v1')->whereNotNull('assignment_id')->exists()){
            throw new \RuntimeException('pb3.scoped_grants.rollback_forbidden');
        }

        Schema::table('photo_access_grants',static function(Blueprint $t):void{
            $t->dropIndex('photo_grants_assignment_scope');
            $t->dropConstrainedForeignId('assignment_id');
        });
        Schema::table('media_recipient_grants_v1',static function(Blueprint $t):void{
            $t->dropIndex('media_grants_assignment_scope');
            $t->dropConstrainedForeignId('assignment_id');
        });
    }
};
