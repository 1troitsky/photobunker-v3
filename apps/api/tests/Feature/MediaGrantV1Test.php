<?php
declare(strict_types=1);

namespace Tests\Feature;

use App\Identity\Protocol as P;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;
use Illuminate\Support\Facades\Storage;
use Illuminate\Support\Str;
use Tests\TestCase;

/**
 * Only the recipient may retrieve the immutable signed media metadata and
 * ciphertext chunks. Actual ECDH and AES-GCM second-account decrypt require
 * Chromium/Garage E2E; synthetic bytes here never appear as plaintext.
 */
final class MediaGrantV1Test extends TestCase
{
    use RefreshDatabase;

    private array $people=[];
    private string $mediaId;
    private string $mediaHash;
    private string $mediaContract;
    private array $chunks=[];

    protected function setUp():void
    {
        parent::setUp();
        Storage::fake('ciphertext');
        foreach(['owner','recipient','unrelated'] as $role)
            $this->newAccount($role);
        $this->mediaId=(string)Str::uuid();
        $owner=$this->people['owner'];
        $expires=now()->addDays(2)->getTimestampMs();
        $chunks=[];
        foreach(['data','metadata'] as $kind){
            $id=(string)Str::uuid();
            $body=random_bytes($kind==='data'?272:87);
            $chunk=[
                'chunkId'=>$id,'index'=>count($chunks),
                'kind'=>$kind,'plainBytes'=>strlen($body)-16,
                'bytes'=>strlen($body),'sha256'=>hash('sha256',$body),
                'iv'=>P::encode(random_bytes(12)),
            ];
            $chunks[]=$chunk;
            $this->chunks[$id]=$body;
            $key='cipher/media/v1/'.$owner['id'].'/'.$this->mediaId.'/'.$id;
            Storage::disk('ciphertext')->put($key,$body);
        }
        $this->mediaContract=json_encode([
            'version'=>1,'accountId'=>$owner['id'],'mediaId'=>$this->mediaId,
            'operationId'=>(string)Str::uuid(),'mediaType'=>'video',
            'expiresAt'=>$expires,'chunkBytes'=>1048576,
            'plainBytes'=>strlen($this->chunks[$chunks[0]['chunkId']])-16,
            'wrappedDEK'=>[
                'iv'=>P::encode(random_bytes(12)),
                'ciphertext'=>P::encode(random_bytes(48)),
            ],
            'chunks'=>$chunks,
        ],JSON_UNESCAPED_SLASHES|JSON_THROW_ON_ERROR);
        $this->mediaHash=hash('sha256',$this->mediaContract);
        DB::table('media_files_v1')->insert([
            'id'=>$this->mediaId,'account_id'=>$owner['id'],
            'device_id'=>$owner['device'],
            'operation_id'=>(string)Str::uuid(),
            'media_type'=>'video','state'=>'active','expires_at'=>$expires,
            'plain_bytes'=>256,'cipher_bytes'=>array_sum(array_column($chunks,'bytes')),
            'contract_hash'=>$this->mediaHash,'contract_json'=>$this->mediaContract,
            'signature'=>'device-fixture','receipt'=>json_encode([
                'mediaId'=>$this->mediaId,
            ]),
            'created_at'=>now(),'updated_at'=>now(),
        ]);
        foreach($chunks as $chunk){
            $id=$chunk['chunkId'];
            DB::table('media_chunks_v1')->insert([
                'id'=>$id,'media_id'=>$this->mediaId,
                'chunk_index'=>$chunk['index'],'kind'=>$chunk['kind'],
                'plain_bytes'=>$chunk['plainBytes'],'bytes'=>$chunk['bytes'],
                'sha256'=>$chunk['sha256'],'iv'=>$chunk['iv'],
                'state'=>'active','created_at'=>now(),'updated_at'=>now(),
            ]);
            DB::table('media_chunk_locations_v1')->insert([
                'id'=>(string)Str::uuid(),'chunk_id'=>$id,
                'provider'=>'app_s3',
                'object_key'=>'cipher/media/v1/'.$owner['id'].'/'.
                    $this->mediaId.'/'.$id,
                'sha256'=>$chunk['sha256'],'bytes'=>$chunk['bytes'],
                'state'=>'active','created_at'=>now(),'updated_at'=>now(),
            ]);
        }
    }

    private function newAccount(string $role):void
    {
        $key=openssl_pkey_new([
            'private_key_type'=>OPENSSL_KEYTYPE_EC,'curve_name'=>'prime256v1',
        ]);
        $pem=openssl_pkey_get_details($key)['key'];
        $spki=P::encode(base64_decode(
            preg_replace('/-----[^-]+-----|\s+/','',$pem)));
        $id=(string)Str::uuid();$device=(string)Str::uuid();
        $this->people[$role]=[
            'id'=>$id,'device'=>$device,'spki'=>$spki,'signer'=>$key,
        ];
        DB::table('identity_accounts')->insert([
            'id'=>$id,'operation_id'=>(string)Str::uuid(),
            'prepare_hash'=>str_repeat('d',64),
            'status'=>'ready','account_spki'=>$spki,
            'reserved_until'=>now()->addDay(),
            'created_at'=>now(),'updated_at'=>now(),
        ]);
        DB::table('identity_devices')->insert([
            'id'=>$device,'account_id'=>$id,'signing_spki'=>$spki,
            'created_at'=>now(),'updated_at'=>now(),
        ]);
    }
    private function asRole(string $role):void
    {
        $person=$this->people[$role];
        $this->withSession([
            'identity_account'=>$person['id'],
            'identity_device'=>$person['device'],
            'identity_issued'=>time(),
        ])->withHeader('Origin','https://localhost');
    }
    private function signature(string $role,string $message):string
    {
        openssl_sign($message,$der,$this->people[$role]['signer'],
            OPENSSL_ALGO_SHA256);
        $i=2;$pieces=[];
        foreach([0,1] as $_){
            if(ord($der[$i++])!==2)
                throw new \RuntimeException('test.bad_signature_der');
            $n=ord($der[$i++]);
            $pieces[]=str_pad(ltrim(substr($der,$i,$n),"\0"),32,"\0",STR_PAD_LEFT);
            $i+=$n;
        }
        return P::encode(implode('',$pieces));
    }
    private function publishRecipientKey():string
    {
        $this->asRole('recipient');
        $person=$this->people['recipient'];
        $seal=[
            'iv'=>P::encode(random_bytes(12)),
            'ciphertext'=>P::encode(random_bytes(64)),
        ];
        $descriptor=json_encode([
            'version'=>1,'accountId'=>$person['id'],
            'exchangeSpki'=>$person['spki'],
            'sealedDigest'=>hash('sha256',
                json_encode($seal,JSON_UNESCAPED_SLASHES)),
        ],JSON_UNESCAPED_SLASHES);
        $this->postJson('/shares/v1/keys',[
            'descriptor'=>$descriptor,
            'signature'=>$this->signature('recipient',
                "pb3.recipient-key.v1\n".$descriptor),
            'sealedPrivate'=>$seal,
        ])->assertCreated();
        return hash('sha256',$descriptor);
    }
    private function grantInput(string $recipientDigest,
        ?int $deadline=null,?string $mediaHash=null):array
    {
        $grant=[
            'version'=>1,'grantId'=>(string)Str::uuid(),
            'mediaId'=>$this->mediaId,
            'ownerAccountId'=>$this->people['owner']['id'],
            'recipientAccountId'=>$this->people['recipient']['id'],
            'recipientKeyDigest'=>$recipientDigest,
            'mediaContractHash'=>$mediaHash??$this->mediaHash,
            'scope'=>'read',
            'expiresAt'=>$deadline??now()->addHour()->getTimestampMs(),
            'envelope'=>[
                'ephemeralSpki'=>$this->people['owner']['spki'],
                'salt'=>P::encode(random_bytes(16)),
                'iv'=>P::encode(random_bytes(12)),
                'ciphertext'=>P::encode(random_bytes(48)),
            ],
        ];
        $json=json_encode($grant,JSON_UNESCAPED_SLASHES|JSON_THROW_ON_ERROR);
        return [
            'contract'=>$json,
            'signature'=>$this->signature('owner',
                "pb3.media-grant.v1\n".$json),
        ];
    }

    /**
     * Two distinct signed-photo fixtures. The test-only ciphertext is never
     * decrypted in PHP: it only establishes the chunk authorization boundary.
     * The real DEK exchange is exercised independently in Chromium.
     */
    private function newSafePhotoAsset(?int $expiresAt=null):array
    {
        $owner=$this->people['owner'];
        $mediaId=(string)Str::uuid();
        $expires=$expiresAt??now()->addDay()->getTimestampMs();
        $chunks=[];$pendingChunks=[];$firstChunk='';
        foreach(['data','metadata'] as $kind){
            $chunkId=(string)Str::uuid();
            if($firstChunk==='')$firstChunk=$chunkId;
            $cipher=random_bytes($kind==='data'?280:91);
            $chunk=[
                'chunkId'=>$chunkId,'index'=>count($chunks),
                'kind'=>$kind,'plainBytes'=>strlen($cipher)-16,
                'bytes'=>strlen($cipher),'sha256'=>hash('sha256',$cipher),
                'iv'=>P::encode(random_bytes(12)),
            ];
            $chunks[]=$chunk;
            $key='cipher/media/v1/'.$owner['id'].'/'.$mediaId.'/'.$chunkId;
            Storage::disk('ciphertext')->put($key,$cipher);
            $pendingChunks[]=['chunk'=>$chunk,'key'=>$key,'kind'=>$kind];

        }
        $contract=json_encode([
            'version'=>1,'accountId'=>$owner['id'],'mediaId'=>$mediaId,
            'operationId'=>(string)Str::uuid(),'mediaType'=>'photo',
            'expiresAt'=>$expires,'chunkBytes'=>1048576,
            'plainBytes'=>$chunks[0]['plainBytes'],
            'wrappedDEK'=>[
                'iv'=>P::encode(random_bytes(12)),
                'ciphertext'=>P::encode(random_bytes(48)),
            ],'chunks'=>$chunks,
        ],JSON_UNESCAPED_SLASHES|JSON_THROW_ON_ERROR);
        $hash=hash('sha256',$contract);
        DB::table('media_files_v1')->insert([
            'id'=>$mediaId,'account_id'=>$owner['id'],
            'device_id'=>$owner['device'],
            'operation_id'=>(string)Str::uuid(),
            'media_type'=>'photo','state'=>'active',
            'expires_at'=>$expires,'plain_bytes'=>$chunks[0]['plainBytes'],
            'cipher_bytes'=>array_sum(array_column($chunks,'bytes')),
            'contract_hash'=>$hash,'contract_json'=>$contract,
            'signature'=>'device-fixture',
            'receipt'=>json_encode(['mediaId'=>$mediaId]),
            'created_at'=>now(),'updated_at'=>now(),
        ]);
        foreach($pendingChunks as $item){
            $chunk=$item['chunk'];$key=$item['key'];$chunkId=$chunk['chunkId'];$kind=$item['kind'];
            DB::table('media_chunks_v1')->insert([
                'id'=>$chunkId,'media_id'=>$mediaId,
                'chunk_index'=>$chunk['index'],'kind'=>$kind,
                'plain_bytes'=>$chunk['plainBytes'],
                'bytes'=>$chunk['bytes'],'sha256'=>$chunk['sha256'],
                'iv'=>$chunk['iv'],'state'=>'active',
                'created_at'=>now(),'updated_at'=>now(),
            ]);
            DB::table('media_chunk_locations_v1')->insert([
                'id'=>(string)Str::uuid(),'chunk_id'=>$chunkId,
                'provider'=>'app_s3','object_key'=>$key,
                'sha256'=>$chunk['sha256'],'bytes'=>$chunk['bytes'],
                'state'=>'active','created_at'=>now(),'updated_at'=>now(),
            ]);
        }
        return ['id'=>$mediaId,'hash'=>$hash,
            'chunkId'=>$firstChunk,'expiresAt'=>$expires];
    }

    private function safeGrantInput(string $recipientDigest,array $source,
        array $derivative,?int $expiry=null):array
    {
        $grant=[
            'version'=>3,'grantId'=>(string)Str::uuid(),
            'mediaId'=>$derivative['id'],
            'ownerAccountId'=>$this->people['owner']['id'],
            'recipientAccountId'=>$this->people['recipient']['id'],
            'sourceMediaId'=>$source['id'],
            'sourceContractHash'=>$source['hash'],
            'recipientKeyDigest'=>$recipientDigest,
            'mediaContractHash'=>$derivative['hash'],
            'scope'=>'safe_read',
            'expiresAt'=>$expiry??now()->addHour()->getTimestampMs(),
            'envelope'=>[
                'ephemeralSpki'=>$this->people['owner']['spki'],
                'salt'=>P::encode(random_bytes(16)),
                'iv'=>P::encode(random_bytes(12)),
                'ciphertext'=>P::encode(random_bytes(48)),
            ],
        ];
        return $this->signedSafeGrant($grant);
    }

    private function signedSafeGrant(array $grant):array
    {
        $contract=json_encode(
            $grant,JSON_UNESCAPED_SLASHES|JSON_THROW_ON_ERROR);
        return [
            'contract'=>$contract,
            'signature'=>$this->signature(
                'owner',"pb3.media-grant.v3\n".$contract),
        ];
    }

    public function test_safe_v3_migration_refuses_to_drop_live_source_binding():void
    {
        $digest=$this->publishRecipientKey();
        $source=$this->newSafePhotoAsset();
        $safe=$this->newSafePhotoAsset();
        $this->asRole('owner');
        $body=$this->safeGrantInput($digest,$source,$safe);
        $this->postJson('/media-shares/v1/grants',$body)->assertCreated();
        $migration=require database_path(
            'migrations/2026_11_11_000004_add_media_safe_derivative_scope_v3.php'
        );
        try{
            $migration->down();
            $this->fail('Must not remove source binding of a signed safe grant.');
        }catch(\RuntimeException $e){
            $this->assertSame('pb3.safe_grants.rollback_forbidden',
                $e->getMessage());
        }
        $this->assertTrue(Schema::hasColumn(
            'media_recipient_grants_v1','source_media_id'));
        $this->assertTrue(Schema::hasColumn(
            'media_recipient_grants_v1','source_contract_hash'));
        $this->assertDatabaseHas('media_recipient_grants_v1',[
            'source_media_id'=>$source['id'],
            'media_id'=>$safe['id'],
        ]);
    }

    public function test_safe_v3_only_decryptable_derivative_chunks_and_source_lifecycle_is_enforced():void
    {
        $digest=$this->publishRecipientKey();
        $source=$this->newSafePhotoAsset();
        $safe=$this->newSafePhotoAsset();
        $this->asRole('owner');
        $body=$this->safeGrantInput($digest,$source,$safe);
        $grantId=json_decode($body['contract'],true)['grantId'];
        $this->postJson('/media-shares/v1/grants',$body)
            ->assertCreated()->assertJsonPath('state','active');
        $this->postJson('/media-shares/v1/grants',$body)
            ->assertOk()->assertJsonPath('unchanged',true);
        $this->assertDatabaseHas('media_recipient_grants_v1',[
            'id'=>$grantId,'media_id'=>$safe['id'],
            'source_media_id'=>$source['id'],
            'source_contract_hash'=>$source['hash'],
            'media_contract_hash'=>$safe['hash'],
        ]);
        $this->asRole('recipient');
        $this->getJson('/media-shares/v1/received')
            ->assertOk()->assertJsonPath('items.0.scope','safe_read');
        $this->getJson('/media-shares/v1/grants/'.$grantId)
            ->assertOk()->assertJsonPath('mediaId',$safe['id'])
            ->assertJsonPath('contract',$body['contract']);
        $this->get('/media-shares/v1/grants/'.$grantId.'/chunks/'.
            $safe['chunkId'])->assertOk();
        // The grantId MUST NOT expose the source ciphertext: its DEK is
        // different and the server cannot route source chunks by grant.
        $this->get('/media-shares/v1/grants/'.$grantId.'/chunks/'.
            $source['chunkId'])->assertNotFound();
        $this->getJson('/media/v1/'.$source['id'].'/manifests')
            ->assertNotFound();
        // Dynamic TTL and owner state bound to BOTH signed media contracts.
        DB::table('media_files_v1')->where('id',$source['id'])
            ->update(['expires_at'=>now()->subSecond()->getTimestampMs()]);
        $this->getJson('/media-shares/v1/grants/'.$grantId)->assertGone();
        $this->get('/media-shares/v1/grants/'.$grantId.'/chunks/'.
            $safe['chunkId'])->assertGone();
        $this->getJson('/media-shares/v1/received')
            ->assertJsonPath('items',[]);
        // No automatic deletion or change of the original on revoke/expiry.
        $this->assertDatabaseHas('media_files_v1',[
            'id'=>$source['id'],'state'=>'active',
        ]);
    }

    public function test_safe_v3_rejects_source_confusion_bad_scope_expiry_and_untrusted_account():void
    {
        $digest=$this->publishRecipientKey();
        $source=$this->newSafePhotoAsset();
        $safe=$this->newSafePhotoAsset();
        $this->asRole('owner');
        $base=json_decode($this->safeGrantInput($digest,$source,$safe)['contract'],true);
        foreach([
            [...$base,'mediaId'=>$source['id']],
            [...$base,'sourceMediaId'=>$safe['id']],
            [...$base,'sourceContractHash'=>str_repeat('e',64)],
            [...$base,'scope'=>'read'],
            [...$base,'scope'=>'original'],
            [...$base,'version'=>2],
            [...$base,'rawDEK'=>'do-not-exfiltrate'],
            [...$base,'expiresAt'=>$source['expiresAt']+1],
            [...$base,'sourceMediaId'=>$this->mediaId], // video, not photo
        ] as $grant){
            $grant['grantId']=(string)Str::uuid();
            $response=$this->postJson('/media-shares/v1/grants',
                $this->signedSafeGrant($grant));
            $this->assertContains($response->getStatusCode(),[404,409,410,422]);
        }
        $this->assertDatabaseCount('media_recipient_grants_v1',0);
        // An unrelated account cannot relabel someone else's original.
        DB::table('media_files_v1')->where('id',$source['id'])->update([
            'account_id'=>$this->people['unrelated']['id'],
            'device_id'=>$this->people['unrelated']['device'],
        ]);
        $this->postJson('/media-shares/v1/grants',
            $this->safeGrantInput($digest,$source,$safe))->assertNotFound();
        $this->assertDatabaseCount('media_recipient_grants_v1',0);
    }

    /** A revoked key, source archive, owner status or changed state applies
     * to the SAME grant in the list, manifest and data chunk routes. */
    public function test_safe_effective_acl_intersection_rejects_live_state_and_key_drift():void
    {
        $digest=$this->publishRecipientKey();
        $source=$this->newSafePhotoAsset();
        $safe=$this->newSafePhotoAsset();
        $this->asRole('owner');
        $input=$this->safeGrantInput($digest,$source,$safe);
        $id=json_decode($input['contract'],true)['grantId'];
        $this->postJson('/media-shares/v1/grants',$input)->assertCreated();

        $assertDenied=function()use($id,$safe):void{
            $this->asRole('recipient');
            $this->getJson('/media-shares/v1/received')
                ->assertOk()->assertJsonPath('items',[]);
            $this->getJson('/media-shares/v1/grants/'.$id)->assertGone();
            $this->get('/media-shares/v1/grants/'.$id.'/chunks/'.
                $safe['chunkId'])->assertGone();
        };
        $assertAllowed=function()use($id,$safe):void{
            $this->asRole('recipient');
            $this->getJson('/media-shares/v1/received')
                ->assertOk()->assertJsonPath('items.0.scope','safe_read');
            $this->getJson('/media-shares/v1/grants/'.$id)->assertOk();
            $this->get('/media-shares/v1/grants/'.$id.'/chunks/'.
                $safe['chunkId'])->assertOk();
        };
        $assertAllowed();

        $ownerId=$this->people['owner']['id'];
        $recipientId=$this->people['recipient']['id'];
        $directory=DB::table('account_exchange_keys')
            ->where('account_id',$recipientId)->first();
        // Recipient exchange key generation changed: old grant no longer
        // authorizes a new key; no silent fallback to server directory.
        DB::table('account_exchange_keys')->where('account_id',$recipientId)
            ->update(['descriptor_hash'=>str_repeat('b',64)]);
        $assertDenied();
        DB::table('account_exchange_keys')->where('account_id',$recipientId)
            ->update(['descriptor_hash'=>$directory->descriptor_hash]);
        $assertAllowed();

        DB::table('identity_accounts')->where('id',$ownerId)
            ->update(['status'=>'retired']);
        $assertDenied();
        DB::table('identity_accounts')->where('id',$ownerId)
            ->update(['status'=>'ready']);
        $assertAllowed();

        DB::table('media_files_v1')->where('id',$safe['id'])
            ->update(['media_type'=>'video']);
        $assertDenied();
        DB::table('media_files_v1')->where('id',$safe['id'])
            ->update(['media_type'=>'photo']);
        $assertAllowed();

        DB::table('media_files_v1')->where('id',$source['id'])
            ->update(['contract_hash'=>str_repeat('d',64)]);
        $assertDenied();
        DB::table('media_files_v1')->where('id',$source['id'])
            ->update(['contract_hash'=>$source['hash']]);
        $assertAllowed();

        $archive=(string)Str::uuid();
        DB::table('browser_archive_entries_v1')->insert([
            'id'=>$archive,'account_id'=>$ownerId,
            'kind'=>'media','asset_id'=>$safe['id'],'revision'=>1,
            'state'=>'archived','media_type'=>'photo',
            'asset_expires_at_ms'=>$safe['expiresAt'],
            'archive_until_ms'=>now()->addDay()->getTimestampMs(),
            'plain_bytes'=>300,'last_operation_id'=>(string)Str::uuid(),
            'created_at'=>now(),'updated_at'=>now(),
        ]);
        $assertDenied();
        DB::table('browser_archive_entries_v1')->where('id',$archive)
            ->update(['state'=>'restored']);
        $assertAllowed();
        DB::table('browser_archive_entries_v1')->where('id',$archive)
            ->update(['asset_id'=>$source['id'],'state'=>'deleting']);
        $assertDenied();
        DB::table('browser_archive_entries_v1')->where('id',$archive)
            ->update(['state'=>'restored']);
        $assertAllowed();

        // Persisted DB row mutation alone cannot relabel original/derived
        // scope after the owner has signed the canonical grant JSON.
        DB::table('media_recipient_grants_v1')->where('id',$id)
            ->update(['source_media_id'=>$safe['id']]);
        $assertDenied();
        DB::table('media_recipient_grants_v1')->where('id',$id)
            ->update(['source_media_id'=>$source['id']]);
        $assertAllowed();
        $this->assertDatabaseHas('media_files_v1',[
            'id'=>$source['id'],'state'=>'active',
        ]);
    }

    public function test_assignment_scoped_media_acl_drops_after_contributor_membership_revoked():void
    {
        $digest=$this->publishRecipientKey();
        $assignmentId=$this->acceptedAssignment();
        $this->asRole('owner');
        $scoped=$this->scopedMediaGrant($this->grantInput($digest),$assignmentId);
        $id=json_decode($scoped['contract'],true)['grantId'];
        $this->postJson('/media-shares/v1/grants',$scoped)->assertCreated();
        $personal=$this->grantInput($digest);
        $personalId=json_decode($personal['contract'],true)['grantId'];
        $this->postJson('/media-shares/v1/grants',$personal)->assertCreated();
        $this->asRole('recipient');
        $this->getJson('/media-shares/v1/grants/'.$id)->assertOk();
        DB::table('assignment_invites_v1')
            ->where('assignment_id',$assignmentId)
            ->where('recipient_account_id',$this->people['owner']['id'])
            ->update(['state'=>'revoked']);
        $this->getJson('/media-shares/v1/grants/'.$id)->assertGone();
        $chunkId=array_key_first($this->chunks);
        $this->get('/media-shares/v1/grants/'.$id.'/chunks/'.$chunkId)
            ->assertGone();
        $this->getJson('/media-shares/v1/received')
            ->assertOk()->assertJsonPath('items.0.grantId',$personalId)
            ->assertJsonCount(1,'items');
        $this->getJson('/media-shares/v1/grants/'.$personalId)->assertOk();
        $this->get('/media-shares/v1/grants/'.$personalId.'/chunks/'.$chunkId)
            ->assertOk();
        // A Fieldwork owner reassignment cannot silently expand a scoped
        // grant to another team/assignment owner.
        DB::table('assignment_invites_v1')
            ->where('assignment_id',$assignmentId)
            ->update(['state'=>'accepted']);
        DB::table('assignment_records_v1')
            ->where('id',$assignmentId)
            ->update(['owner_account_id'=>$this->people['unrelated']['id']]);
        $this->getJson('/media-shares/v1/grants/'.$id)->assertGone();
        $this->getJson('/media-shares/v1/received')
            ->assertOk()->assertJsonCount(1,'items');
    }

    public function test_bad_stored_grant_signature_never_appears_in_received_listing():void
    {
        $digest=$this->publishRecipientKey();
        $this->asRole('owner');
        $g=$this->grantInput($digest);
        $id=json_decode($g['contract'],true)['grantId'];
        $this->postJson('/media-shares/v1/grants',$g)->assertCreated();
        $this->asRole('recipient');
        $this->getJson('/media-shares/v1/received')
            ->assertOk()->assertJsonPath('items.0.grantId',$id);
        DB::table('media_recipient_grants_v1')->where('id',$id)
            ->update(['account_signature'=>P::encode(random_bytes(64))]);
        $this->getJson('/media-shares/v1/received')
            ->assertOk()->assertJsonPath('items',[]);
        $this->getJson('/media-shares/v1/grants/'.$id)->assertGone();
    }

    private function previewPolicyInput(array $source,array $safe,
        int $fromRevision=0,?string $previousHash=null,
        ?array $fields=null,?array $actions=null):array
    {
        $contract=[
            'version'=>1,'operationId'=>(string)Str::uuid(),
            'accountId'=>$this->people['owner']['id'],
            'sourceMediaId'=>$source['id'],'safeMediaId'=>$safe['id'],
            'sourceContractHash'=>$source['hash'],
            'safeContractHash'=>$safe['hash'],
            'fromRevision'=>$fromRevision,
            'toRevision'=>$fromRevision+1,
            'previousPolicyHash'=>$previousHash??str_repeat('0',64),
            'publication'=>'disabled',
            'fields'=>$fields??[
                'description'=>true,'capturedAt'=>false,
                'updatedAt'=>false,'tags'=>false,
                'authorTeam'=>false,'gps'=>false,'metadata'=>false,
            ],
            'actions'=>$actions??[
                'view'=>false,'copy'=>false,
                'download'=>false,'share'=>false,
            ],
            'expiresAt'=>now()->addHours(2)->getTimestampMs(),
        ];
        return $this->signPreviewPolicy($contract);
    }

    private function signPreviewPolicy(array $contract):array
    {
        $json=json_encode($contract,JSON_UNESCAPED_SLASHES|JSON_THROW_ON_ERROR);
        return ['contract'=>$json,'signature'=>$this->signature(
            'owner',"pb3.media-file-preview-policy.v1\n".$json)];
    }

    public function test_file_preview_policy_is_signed_owner_only_and_never_publishes():void
    {
        $source=$this->newSafePhotoAsset();
        $safe=$this->newSafePhotoAsset();
        $this->asRole('owner');
        $p1=$this->previewPolicyInput($source,$safe);
        $this->getJson('/media-file-preview/v1/policies/'.$safe['id'])
            ->assertNotFound();
        $this->postJson('/media-file-preview/v1/policies',$p1)
            ->assertCreated()->assertJsonPath('revision',1)
            ->assertJsonPath('unchanged',false)
            ->assertJsonPath('published',false);
        $this->postJson('/media-file-preview/v1/policies',$p1)
            ->assertOk()->assertJsonPath('unchanged',true);
        $get=$this->getJson('/media-file-preview/v1/policies/'.$safe['id'])
            ->assertOk()->assertJsonPath('published',false)
            ->assertJsonPath('contract',$p1['contract'])
            ->assertJsonMissingPath('token')
            ->assertJsonMissingPath('envelope')
            ->assertJsonMissingPath('publicUrl');
        $previous=$get->json('policyHash');
        $this->assertSame(hash('sha256',$p1['contract']),$previous);
        $p2=$this->previewPolicyInput($source,$safe,1,$previous,[
            'description'=>false,'capturedAt'=>true,
            'updatedAt'=>false,'tags'=>true,'authorTeam'=>false,
            'gps'=>false,'metadata'=>false,
        ]);
        $this->postJson('/media-file-preview/v1/policies',$p2)
            ->assertCreated()->assertJsonPath('revision',2)
            ->assertJsonPath('published',false);
        $this->getJson('/media-file-preview/v1/policies/'.$safe['id'])
            ->assertOk()->assertJsonPath('revision',2)
            ->assertJsonPath('contract',$p2['contract']);
        $this->assertDatabaseCount('media_file_preview_policy_events_v1',2);
        $this->assertDatabaseHas('media_file_preview_policies_v1',[
            'account_id'=>$this->people['owner']['id'],
            'source_media_id'=>$source['id'],
            'safe_media_id'=>$safe['id'],'revision'=>2,
            'source_contract_hash'=>$source['hash'],
            'safe_contract_hash'=>$safe['hash'],
        ]);
        $this->assertDatabaseCount('media_recipient_grants_v1',0);
        $this->asRole('recipient');
        $this->getJson('/media-file-preview/v1/policies/'.$safe['id'])
            ->assertNotFound();
        $this->postJson('/media-file-preview/v1/policies',$p1)
            ->assertForbidden();
        // Nothing in the policy route grants a recipient a ciphertext chunk.
        $this->getJson('/media/v1/'.$safe['id'].'/manifests')
            ->assertNotFound();
    }

    public function test_file_preview_rejects_public_actions_replay_forgery_and_revision_fork():void
    {
        $source=$this->newSafePhotoAsset();
        $safe=$this->newSafePhotoAsset();
        $this->asRole('owner');
        $p=$this->previewPolicyInput($source,$safe);
        $data=json_decode($p['contract'],true,16,JSON_THROW_ON_ERROR);
        foreach([
            [...$data,'publication'=>'public'],
            [...$data,'publication'=>'published'],
            [...$data,'actions'=>[...$data['actions'],'download'=>true]],
            [...$data,'actions'=>[...$data['actions'],'view'=>true]],
            [...$data,'actions'=>[...$data['actions'],'share'=>true]],
            [...$data,'actions'=>[...$data['actions'],'copy'=>true]],
            [...$data,'fields'=>[...$data['fields'],'gps'=>'true']],
            [...$data,'fields'=>[...$data['fields'],'extra'=>true]],
            [...$data,'actions'=>[...$data['actions'],'original'=>true]],
            [...$data,'sourceMediaId'=>$safe['id']],
            [...$data,'sourceContractHash'=>str_repeat('f',64)],
            [...$data,'safeContractHash'=>str_repeat('f',64)],
            [...$data,'expiresAt'=>$source['expiresAt']+1],
            [...$data,'extra'=>'untrusted'],
        ] as $mutated){
            $mutated['operationId']=(string)Str::uuid();
            $response=$this->postJson('/media-file-preview/v1/policies',
                $this->signPreviewPolicy($mutated));
            $this->assertContains($response->getStatusCode(),[404,409,410,422]);
        }
        $this->assertDatabaseCount('media_file_preview_policy_events_v1',0);
        $forged=$p;
        $forged['signature']=P::encode(random_bytes(64));
        $this->postJson('/media-file-preview/v1/policies',$forged)
            ->assertUnauthorized();
        $this->postJson('/media-file-preview/v1/policies',$p)
            ->assertCreated();
        // Lost-ACK mismatch cannot rewrite the signed operation ID.
        $reused=json_decode($p['contract'],true);
        $reused['fields']['gps']=true;
        $this->postJson('/media-file-preview/v1/policies',
            $this->signPreviewPolicy($reused))->assertConflict();
        $this->postJson('/media-file-preview/v1/policies',
            $this->previewPolicyInput($source,$safe))
            ->assertConflict(); // cannot create another revision 1
        $this->assertDatabaseCount('media_file_preview_policy_events_v1',1);
    }

    public function test_file_preview_checks_two_asset_ttls_archive_tamper_and_rollback():void
    {
        $source=$this->newSafePhotoAsset();
        $safe=$this->newSafePhotoAsset();
        $this->asRole('owner');
        $this->postJson('/media-file-preview/v1/policies',
            $this->previewPolicyInput($source,$safe))->assertCreated();

        $migration=require database_path(
            'migrations/2026_11_11_000005_create_media_file_preview_policies_v1.php');
        try{
            $migration->down();
            $this->fail('Cannot discard existing signed file policies.');
        }catch(\RuntimeException $e){
            $this->assertSame('pb3.file_preview.rollback_forbidden',
                $e->getMessage());
        }
        $this->assertTrue(Schema::hasTable('media_file_preview_policy_events_v1'));

        DB::table('media_files_v1')->where('id',$safe['id'])
            ->update(['contract_hash'=>str_repeat('e',64)]);
        $this->getJson('/media-file-preview/v1/policies/'.$safe['id'])
            ->assertConflict();
        DB::table('media_files_v1')->where('id',$safe['id'])
            ->update(['contract_hash'=>$safe['hash']]);

        // Archived derivatives must not remain available even to the owner
        // through a stored preview policy. Restoring just the archive flag
        // does not emit or publish any new grant.
        $archiveId=(string)Str::uuid();
        DB::table('browser_archive_entries_v1')->insert([
            'id'=>$archiveId,
            'account_id'=>$this->people['owner']['id'],
            'kind'=>'media','asset_id'=>$safe['id'],
            'revision'=>1,'state'=>'archived',
            'asset_expires_at_ms'=>$safe['expiresAt'],
            'archive_until_ms'=>now()->addDay()->getTimestampMs(),
            'media_type'=>'photo','plain_bytes'=>300,
            'last_operation_id'=>(string)Str::uuid(),
            'created_at'=>now(),'updated_at'=>now(),
        ]);
        $this->getJson('/media-file-preview/v1/policies/'.$safe['id'])
            ->assertGone();
        DB::table('browser_archive_entries_v1')->where('id',$archiveId)
            ->update(['state'=>'restored']);
        $this->getJson('/media-file-preview/v1/policies/'.$safe['id'])
            ->assertOk()->assertJsonPath('published',false);

        $event=DB::table('media_file_preview_policy_events_v1')->first();
        DB::table('media_file_preview_policy_events_v1')
            ->where('operation_id',$event->operation_id)
            ->update(['contract_hash'=>str_repeat('f',64)]);
        $this->getJson('/media-file-preview/v1/policies/'.$safe['id'])
            ->assertConflict();
        DB::table('media_file_preview_policy_events_v1')
            ->where('operation_id',$event->operation_id)
            ->update(['contract_hash'=>$event->contract_hash]);

        DB::table('media_files_v1')->where('id',$source['id'])
            ->update(['expires_at'=>now()->subSecond()->getTimestampMs()]);
        $this->getJson('/media-file-preview/v1/policies/'.$safe['id'])
            ->assertGone();
        // Signed policy can never erase either independent media file.
        $this->assertDatabaseHas('media_files_v1',[
            'id'=>$source['id'],'state'=>'active',
        ]);
        $this->assertDatabaseCount('media_recipient_grants_v1',0);
    }

    /** The recipient owns Fieldwork, but the contributor retains S3 ownership. */
    private function acceptedAssignment():string
    {
        $id=(string)Str::uuid();
        $fieldworkOwner=$this->people['recipient']['id'];
        $contributor=$this->people['owner']['id'];
        DB::table('assignment_records_v1')->insert([
            'id'=>$id,'owner_account_id'=>$fieldworkOwner,
            'operation_id'=>(string)Str::uuid(),
            'contract_hash'=>str_repeat('f',64),'contract_json'=>'{}',
            'owner_signature'=>'fixture','private_envelope_json'=>'{}',
            'state'=>'active','starts_at'=>now()->subHour()->getTimestampMs(),
            'ends_at'=>null,'created_at'=>now(),'updated_at'=>now(),
        ]);
        DB::table('assignment_invites_v1')->insert([
            'id'=>(string)Str::uuid(),'assignment_id'=>$id,
            'owner_account_id'=>$fieldworkOwner,
            'recipient_account_id'=>$contributor,'role'=>'contributor',
            'state'=>'accepted','recipient_key_digest'=>str_repeat('b',64),
            'contract_hash'=>str_repeat('c',64),'contract_json'=>'{}',
            'owner_signature'=>'fixture',
            'expires_at'=>now()->addDay()->getTimestampMs(),
            'created_at'=>now(),'updated_at'=>now(),
        ]);
        return $id;
    }

    private function scopedMediaGrant(array $old,string $assignmentId):array
    {
        $old=json_decode($old['contract'],true,32,JSON_THROW_ON_ERROR);
        $parts=[];
        foreach($old as $k=>$v){
            $parts[$k]=$k==='version'?2:$v;
            if($k==='recipientAccountId')$parts['assignmentId']=$assignmentId;
        }
        $json=json_encode($parts,JSON_UNESCAPED_SLASHES|JSON_THROW_ON_ERROR);
        return [
            'contract'=>$json,
            'signature'=>$this->signature('owner',
                "pb3.media-grant.v2\n".$json),
        ];
    }

    public function test_scoped_media_grant_blocks_migration_rollback_before_either_column_drops():void
    {
        $digest=$this->publishRecipientKey();
        $assignmentId=$this->acceptedAssignment();
        $this->asRole('owner');
        $scoped=$this->scopedMediaGrant($this->grantInput($digest),$assignmentId);
        $id=json_decode($scoped['contract'],true,32,JSON_THROW_ON_ERROR)['grantId'];
        $this->postJson('/media-shares/v1/grants',$scoped)->assertCreated();
        $migration=require database_path(
            'migrations/2026_11_10_000006_add_assignment_scoped_recipient_grants.php'
        );
        try{
            $migration->down();
            $this->fail('Rollback must reject an existing scoped media grant.');
        }catch(\RuntimeException $e){
            $this->assertSame('pb3.scoped_grants.rollback_forbidden',$e->getMessage());
        }
        $this->assertTrue(Schema::hasColumn('photo_access_grants','assignment_id'));
        $this->assertTrue(Schema::hasColumn('media_recipient_grants_v1','assignment_id'));
        $this->assertDatabaseHas('media_recipient_grants_v1',[
            'id'=>$id,'assignment_id'=>$assignmentId,'state'=>'active',
        ]);
    }

    public function test_p1_22_media_scope_expires_without_deleting_contributor_media_or_personal_grant():void
    {
        $digest=$this->publishRecipientKey();
        $assignmentId=$this->acceptedAssignment();
        $this->asRole('owner');
        $scoped=$this->scopedMediaGrant($this->grantInput($digest),$assignmentId);
        $id=json_decode($scoped['contract'],true,32,JSON_THROW_ON_ERROR)['grantId'];
        $this->postJson('/media-shares/v1/grants',$scoped)->assertCreated();
        $this->postJson('/media-shares/v1/grants',$scoped)->assertOk()
            ->assertJsonPath('unchanged',true);
        $personal=$this->grantInput($digest);
        $personalId=json_decode($personal['contract'],true,32,JSON_THROW_ON_ERROR)['grantId'];
        $this->postJson('/media-shares/v1/grants',$personal)->assertCreated();
        $this->assertDatabaseHas('media_recipient_grants_v1',[
            'id'=>$id,'assignment_id'=>$assignmentId,
        ]);
        $this->asRole('recipient');
        $this->getJson('/media-shares/v1/grants/'.$id)->assertOk();
        $chunkId=array_key_first($this->chunks);
        $this->get('/media-shares/v1/grants/'.$id.'/chunks/'.$chunkId)->assertOk();
        DB::table('assignment_records_v1')->where('id',$assignmentId)
            ->update(['files_access_until'=>now()->subMinute()->getTimestampMs()]);
        $this->getJson('/media-shares/v1/grants/'.$id)->assertGone();
        $this->get('/media-shares/v1/grants/'.$id.'/chunks/'.$chunkId)->assertGone();
        $items=$this->getJson('/media-shares/v1/received')->assertOk()->json('items');
        $this->assertNotContains($id,array_column($items,'grantId'));
        $this->assertContains($personalId,array_column($items,'grantId'));
        $this->getJson('/media-shares/v1/grants/'.$personalId)->assertOk();
        $this->get('/media-shares/v1/grants/'.$personalId.'/chunks/'.$chunkId)->assertOk();
        $this->assertDatabaseHas('media_files_v1',['id'=>$this->mediaId,'state'=>'active']);
        $this->assertDatabaseCount('media_chunks_v1',2);
    }

    public function test_p1_22_media_scope_requires_accepted_contributor_and_valid_deadline():void
    {
        $digest=$this->publishRecipientKey();
        $assignmentId=$this->acceptedAssignment();
        $this->asRole('owner');
        $scoped=$this->scopedMediaGrant($this->grantInput($digest),$assignmentId);
        DB::table('assignment_invites_v1')->where('assignment_id',$assignmentId)
            ->update(['state'=>'pending']);
        $this->postJson('/media-shares/v1/grants',$scoped)->assertForbidden();
        DB::table('assignment_invites_v1')->where('assignment_id',$assignmentId)
            ->update(['state'=>'accepted']);
        $forged=$scoped;
        $forged['signature']=$this->signature('owner',
            "pb3.media-grant.v1\n".$scoped['contract']);
        $this->postJson('/media-shares/v1/grants',$forged)->assertUnauthorized();
        DB::table('assignment_records_v1')->where('id',$assignmentId)->update([
            'files_access_until'=>now()->addMinutes(5)->getTimestampMs(),
        ]);
        $this->postJson('/media-shares/v1/grants',$scoped)->assertUnprocessable();
        DB::table('assignment_records_v1')->where('id',$assignmentId)->update([
            'files_access_until'=>null,
            'owner_account_id'=>$this->people['unrelated']['id'],
        ]);
        $this->postJson('/media-shares/v1/grants',$scoped)->assertForbidden();
        $this->assertDatabaseCount('media_recipient_grants_v1',0);
    }

    public function test_recipient_only_gets_signed_media_and_authenticated_chunks():void
    {
        $digest=$this->publishRecipientKey();
        $this->asRole('owner');
        $grant=$this->grantInput($digest);
        $id=json_decode($grant['contract'],true)['grantId'];
        $this->postJson('/media-shares/v1/grants',$grant)
            ->assertCreated()->assertJsonPath('unchanged',false);
        $this->postJson('/media-shares/v1/grants',$grant)
            ->assertOk()->assertJsonPath('unchanged',true);
        $this->getJson('/media-shares/v1/grants/'.$id)->assertNotFound();
        $this->asRole('unrelated');
        $this->getJson('/media-shares/v1/received')
            ->assertOk()->assertJsonPath('items',[]);
        $this->getJson('/media-shares/v1/grants/'.$id)->assertNotFound();
        foreach(array_keys($this->chunks) as $chunkId){
            $this->get('/media-shares/v1/grants/'.$id.'/chunks/'.$chunkId)
                ->assertNotFound();
        }
        $this->asRole('recipient');
        $this->getJson('/media-shares/v1/received')
            ->assertOk()->assertJsonPath('items.0.grantId',$id)
            ->assertJsonPath('items.0.mediaType','video');
        $this->getJson('/media-shares/v1/grants/'.$id)
            ->assertOk()->assertJsonPath('ownerAccountSpki',
                $this->people['owner']['spki'])
            ->assertJsonPath('mediaContract',$this->mediaContract)
            ->assertJsonPath('contract',$grant['contract']);
        foreach(array_keys($this->chunks) as $chunkId){
            $this->get('/media-shares/v1/grants/'.$id.'/chunks/'.$chunkId)
                ->assertOk()->assertHeader('X-Cipher-SHA256',
                    hash('sha256',$this->chunks[$chunkId]));
        }
        $this->assertDatabaseCount('media_recipient_grants_v1',1);
        $this->assertDatabaseHas('media_files_v1',[
            'id'=>$this->mediaId,'state'=>'active',
        ]);
    }

    public function test_signed_revoke_is_idempotent_and_denies_future_reads():void
    {
        $digest=$this->publishRecipientKey();
        $this->asRole('owner');
        $grant=$this->grantInput($digest);
        $id=json_decode($grant['contract'],true)['grantId'];
        $this->postJson('/media-shares/v1/grants',$grant)->assertCreated();
        $command=json_encode([
            'version'=>1,'grantId'=>$id,'operationId'=>(string)Str::uuid(),
        ]);
        $revoke=[
            'command'=>$command,
            'signature'=>$this->signature('owner',
                "pb3.media-revoke.v1\n".$command),
        ];
        $this->postJson('/media-shares/v1/grants/'.$id.'/revoke',$revoke)
            ->assertOk()->assertJsonPath('state','revoked');
        $this->postJson('/media-shares/v1/grants/'.$id.'/revoke',$revoke)
            ->assertOk();
        $this->postJson('/media-shares/v1/grants',$grant)->assertGone();
        $this->asRole('recipient');
        $this->getJson('/media-shares/v1/grants/'.$id)->assertGone();
        $this->getJson('/media-shares/v1/received')
            ->assertJsonPath('items',[]);
        $chunkId=array_key_first($this->chunks);
        $this->get('/media-shares/v1/grants/'.$id.'/chunks/'.$chunkId)
            ->assertGone();
        $this->assertDatabaseHas('media_files_v1',[
            'id'=>$this->mediaId,'state'=>'active',
        ]);
    }

    public function test_wrong_key_digest_forged_owner_signature_or_mutated_media_denied():void
    {
        $digest=$this->publishRecipientKey();
        $this->asRole('owner');
        $grant=$this->grantInput($digest);
        $forged=$grant;
        $forged['signature']=P::encode(random_bytes(64));
        $this->postJson('/media-shares/v1/grants',$forged)
            ->assertUnauthorized();
        $this->postJson('/media-shares/v1/grants',
            $this->grantInput(str_repeat('f',64)))->assertConflict();
        $this->postJson('/media-shares/v1/grants',
            $this->grantInput($digest,null,str_repeat('0',64)))
            ->assertConflict();
        $this->postJson('/media-shares/v1/grants',$grant)->assertCreated();
        $id=json_decode($grant['contract'],true)['grantId'];
        // A privileged DB corruption must not redirect a signed grant to a
        // different immutable media contract without failing closed.
        DB::table('media_files_v1')->where('id',$this->mediaId)
            ->update(['contract_hash'=>str_repeat('a',64)]);
        $this->asRole('recipient');
        $this->getJson('/media-shares/v1/grants/'.$id)->assertGone();
        $this->getJson('/media-shares/v1/received')
            ->assertJsonPath('items',[]);
    }

    public function test_expired_media_blocks_grant_and_get_without_deletion():void
    {
        $digest=$this->publishRecipientKey();
        $this->asRole('owner');
        $grant=$this->grantInput($digest);
        $id=json_decode($grant['contract'],true)['grantId'];
        $this->postJson('/media-shares/v1/grants',$grant)->assertCreated();
        DB::table('media_files_v1')->where('id',$this->mediaId)
            ->update(['expires_at'=>now()->subSecond()->getTimestampMs()]);
        $this->asRole('recipient');
        $this->getJson('/media-shares/v1/grants/'.$id)->assertGone();
        $this->getJson('/media-shares/v1/received')
            ->assertJsonPath('items',[]);
        $this->assertDatabaseHas('media_files_v1',[
            'id'=>$this->mediaId,'state'=>'active',
        ]);
    }
}
