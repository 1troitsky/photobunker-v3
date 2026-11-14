<?php
declare(strict_types=1);

namespace Tests\Feature\StoragePurge;

use App\Storage\Purge\LivePurgeFence;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;
use RuntimeException;
use Tests\TestCase;
use Throwable;

/**
 * Only synthetic parent records. This test never deletes provider data.
 * Physical off-provider deletion and signed Panic are NOT integrated.
 */
final class LivePurgeFenceTest extends TestCase
{
    use RefreshDatabase;

    /** @return array{account:string,parent:string,kind:string} */
    private function fixture(string $kind):array
    {
        $account=(string)Str::uuid();
        $device=(string)Str::uuid();
        $parent=(string)Str::uuid();
        $now=now('UTC');
        DB::table('identity_accounts')->insert([
            'id'=>$account,'operation_id'=>(string)Str::uuid(),
            'prepare_hash'=>str_repeat('a',64),'status'=>'ready',
            'reserved_until'=>$now->copy()->addDay(),
            'created_at'=>$now,'updated_at'=>$now,
        ]);
        DB::table('identity_devices')->insert([
            'id'=>$device,'account_id'=>$account,
            'signing_spki'=>'synthetic-p4-fence',
            'created_at'=>$now,'updated_at'=>$now,
        ]);
        if ($kind==='photo') {
            DB::table('photo_records')->insert([
                'id'=>$parent,'account_id'=>$account,'device_id'=>$device,
                'operation_id'=>(string)Str::uuid(),
                'state'=>'active','expires_at'=>$now->copy()->addDay()->getTimestampMs(),
                'contract_hash'=>str_repeat('b',64),
                'contract_json'=>'{}','signature'=>'synthetic',
                'created_at'=>$now,'updated_at'=>$now,
            ]);
        } else {
            DB::table('media_files_v1')->insert([
                'id'=>$parent,'account_id'=>$account,'device_id'=>$device,
                'operation_id'=>(string)Str::uuid(),'media_type'=>'video',
                'state'=>'active','expires_at'=>$now->copy()->addDay()->getTimestampMs(),
                'plain_bytes'=>16,'cipher_bytes'=>32,
                'contract_hash'=>str_repeat('b',64),
                'contract_json'=>'{}','signature'=>'synthetic',
                'created_at'=>$now,'updated_at'=>$now,
            ]);
        }
        return compact('account','parent','kind');
    }

    private function deny(callable $fn,string $code):void
    {
        try {
            $fn();
            $this->fail('Expected safe denial: '.$code);
        } catch (RuntimeException $e) {
            $this->assertSame($code,$e->getMessage());
        }
    }

    public function test_photo_and_media_ledger_is_stable_after_canonical_parent_is_deleted():void
    {
        $ledger=new LivePurgeFence();
        foreach (['photo','media'] as $kind) {
            $f=$this->fixture($kind);
            $this->assertFalse($ledger->isFenced($f['account'],$kind,$f['parent']));
            $op=(string)Str::uuid();
            $first=$ledger->recordAuthorized($f['account'],$kind,$f['parent'],$op,'panic');
            $this->assertFalse($first['replayed']);
            $this->assertTrue($ledger->isFenced($f['account'],$kind,$f['parent']));
            $table=$kind==='photo'?'photo_records':'media_files_v1';
            DB::table($table)->where('id',$f['parent'])->delete();
            $replay=$ledger->recordAuthorized($f['account'],$kind,$f['parent'],$op,'panic');
            $this->assertTrue($replay['replayed']);
            $this->assertSame($first['id'],$replay['id']);
            $this->assertTrue($ledger->isFenced($f['account'],$kind,$f['parent']));
            $this->deny(fn()=>$ledger->recordAuthorized(
                $f['account'],$kind,$f['parent'],(string)Str::uuid(),'panic'
            ),'storage.purge_fence_conflict');
            $this->assertSame(1,DB::table('storage_purge_fences_v1')
                ->where('account_id',$f['account'])->where('parent_id',$f['parent'])->count());
        }
    }

    public function test_foreign_account_and_invalid_intents_cannot_create_fence():void
    {
        $ledger=new LivePurgeFence();
        $owner=$this->fixture('photo');
        $foreign=$this->fixture('photo');
        $op=(string)Str::uuid();
        $this->deny(fn()=>$ledger->recordAuthorized(
            $foreign['account'],'photo',$owner['parent'],$op,'user'
        ),'storage.purge_parent_unavailable');
        $this->deny(fn()=>$ledger->recordAuthorized(
            $owner['account'],'photo',$owner['parent'],$op,'forged'
        ),'storage.invalid_purge_intent');
        $this->deny(fn()=>$ledger->recordAuthorized(
            'bad-id','photo',$owner['parent'],$op,'panic'
        ),'storage.invalid_purge_intent');
        $this->deny(fn()=>$ledger->recordAuthorized(
            $owner['account'],'media',$owner['parent'],$op,'panic'
        ),'storage.purge_parent_unavailable');
        $this->assertSame(0,DB::table('storage_purge_fences_v1')->count());
    }

    public function test_same_operation_different_reason_fails_without_mutating_existing_fence():void
    {
        $f=$this->fixture('media');$ledger=new LivePurgeFence();
        $op=(string)Str::uuid();
        $a=$ledger->recordAuthorized($f['account'],'media',$f['parent'],$op,'ttl');
        $this->deny(fn()=>$ledger->recordAuthorized(
            $f['account'],'media',$f['parent'],$op,'user'
        ),'storage.purge_fence_conflict');
        $this->assertSame($a['id'],DB::table('storage_purge_fences_v1')
            ->where('parent_id',$f['parent'])->value('id'));
        $this->assertSame('ttl',DB::table('storage_purge_fences_v1')
            ->where('parent_id',$f['parent'])->value('reason'));
    }

    public function test_database_prevents_direct_update_or_delete_of_fence():void
    {
        $f=$this->fixture('photo');$ledger=new LivePurgeFence();
        $op=(string)Str::uuid();
        $ledger->recordAuthorized($f['account'],'photo',$f['parent'],$op,'user');
        foreach ([
            fn()=>DB::table('storage_purge_fences_v1')
                ->where('parent_id',$f['parent'])->update(['reason'=>'panic']),
            fn()=>DB::table('storage_purge_fences_v1')
                ->where('parent_id',$f['parent'])->delete(),
        ] as $attempt) {
            $thrown=false;
            try { $attempt(); } catch(Throwable $e) {
                $thrown=true;
                $this->assertStringContainsString('storage.purge_fence_immutable',
                    $e->getMessage());
            }
            $this->assertTrue($thrown,'DB mutation must be blocked by trigger');
        }
        $this->assertDatabaseHas('storage_purge_fences_v1',[
            'account_id'=>$f['account'],'parent_id'=>$f['parent'],
            'operation_id'=>$op,'reason'=>'user',
        ]);
    }

    public function test_explicit_multi_parent_panic_operation_may_cover_each_parent_separately():void
    {
        $f=$this->fixture('photo');$ledger=new LivePurgeFence();
        $op=(string)Str::uuid();
        // A Panic operation may include multiple parent objects. The unique
        // key must not mistakenly restrict one operation to one object.
        $rowA=$ledger->recordAuthorized($f['account'],'photo',$f['parent'],$op,'panic');
        $parentB=(string)Str::uuid();
        $record=DB::table('photo_records')->where('id',$f['parent'])->first();
        DB::table('photo_records')->insert([
            'id'=>$parentB,'account_id'=>$f['account'],
            'device_id'=>$record->device_id,
            'operation_id'=>(string)Str::uuid(),'state'=>'active',
            'expires_at'=>$record->expires_at,'contract_hash'=>$record->contract_hash,
            'contract_json'=>'{}','signature'=>'synthetic',
            'created_at'=>now('UTC'),'updated_at'=>now('UTC'),
        ]);
        $rowB=$ledger->recordAuthorized($f['account'],'photo',$parentB,$op,'panic');
        $this->assertNotSame($rowA['id'],$rowB['id']);
        $this->assertSame(2,DB::table('storage_purge_fences_v1')
            ->where('account_id',$f['account'])->count());
    }
}
