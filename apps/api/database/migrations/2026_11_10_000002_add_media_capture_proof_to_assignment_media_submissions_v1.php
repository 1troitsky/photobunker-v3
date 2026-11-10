<?php
declare(strict_types=1);

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/** Optional v2 signed capture proof. Older personal-media v1 receipts survive. */
return new class extends Migration {
    public function up():void
    {
        Schema::table('assignment_media_submissions_v1',
            static function(Blueprint $table):void{
                $table->longText('capture_contract_json')->nullable();
                $table->text('capture_signature')->nullable();
            });
    }
    public function down():void
    {
        Schema::table('assignment_media_submissions_v1',
            static function(Blueprint $table):void{
                $table->dropColumn(['capture_contract_json','capture_signature']);
            });
    }
};
