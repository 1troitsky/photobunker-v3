<?php
declare(strict_types=1);

namespace Tests\Feature;

use App\Identity\Protocol as P;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Carbon;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Storage;
use Illuminate\Support\Str;
use Tests\TestCase;

/**
 * #204/#387: genuine signed grant validity at the exact expiry millisecond.
 * Test fixture media has synthetic ciphertext; no plaintext/client E2EE claim.
 * No product clock, authorization, or crypto method is mocked.
 */
final class P1MediaGrantExpiryClock204Test extends TestCase
{
    use RefreshDatabase;

    private array $people = [];
    private string $mediaId;
    private string $mediaHash;
    private string $chunkId;
    private string $chunkBody;
    private string $objectKey;

    protected function setUp(): void
    {
        parent::setUp();
        Storage::fake('ciphertext');
        foreach (['owner', 'recipient', 'outsider'] as $role) {
            $this->newIdentity($role);
        }

        $owner = $this->people['owner'];
        $this->mediaId = (string) Str::uuid();
        $this->chunkId = (string) Str::uuid();
        $this->chunkBody = random_bytes(272);
        $this->objectKey = 'cipher/media/v1/'.$owner['id'].'/'.$this->mediaId.'/'.$this->chunkId;
        Storage::disk('ciphertext')->put($this->objectKey, $this->chunkBody);
        $expires = now()->addDays(2)->getTimestampMs();
        $chunk = [
            'chunkId' => $this->chunkId,
            'index' => 0,
            'kind' => 'data',
            'plainBytes' => 256,
            'bytes' => strlen($this->chunkBody),
            'sha256' => hash('sha256', $this->chunkBody),
            'iv' => P::encode(random_bytes(12)),
        ];
        $contract = json_encode([
            'version' => 1, 'accountId' => $owner['id'],
            'mediaId' => $this->mediaId,
            'operationId' => (string) Str::uuid(),
            'mediaType' => 'video',
            'expiresAt' => $expires,
            'chunkBytes' => 1048576,
            'plainBytes' => 256,
            'wrappedDEK' => [
                'iv' => P::encode(random_bytes(12)),
                'ciphertext' => P::encode(random_bytes(48)),
            ],
            'chunks' => [$chunk],
        ], JSON_UNESCAPED_SLASHES | JSON_THROW_ON_ERROR);
        $this->mediaHash = hash('sha256', $contract);

        DB::table('media_files_v1')->insert([
            'id' => $this->mediaId, 'account_id' => $owner['id'],
            'device_id' => $owner['device'],
            'operation_id' => (string) Str::uuid(),
            'media_type' => 'video', 'state' => 'active',
            'expires_at' => $expires, 'plain_bytes' => 256,
            'cipher_bytes' => strlen($this->chunkBody),
            'contract_hash' => $this->mediaHash,
            'contract_json' => $contract, 'signature' => 'test-fixture',
            'receipt' => json_encode(['mediaId' => $this->mediaId], JSON_THROW_ON_ERROR),
            'created_at' => now(), 'updated_at' => now(),
        ]);
        DB::table('media_chunks_v1')->insert([
            'id' => $this->chunkId, 'media_id' => $this->mediaId,
            'chunk_index' => 0, 'kind' => 'data',
            'plain_bytes' => 256, 'bytes' => strlen($this->chunkBody),
            'sha256' => hash('sha256', $this->chunkBody),
            'iv' => $chunk['iv'], 'state' => 'active',
            'created_at' => now(), 'updated_at' => now(),
        ]);
        DB::table('media_chunk_locations_v1')->insert([
            'id' => (string) Str::uuid(), 'chunk_id' => $this->chunkId,
            'provider' => 'app_s3', 'object_key' => $this->objectKey,
            'sha256' => hash('sha256', $this->chunkBody),
            'bytes' => strlen($this->chunkBody), 'state' => 'active',
            'created_at' => now(), 'updated_at' => now(),
        ]);
    }

    private function newIdentity(string $role): void
    {
        $signer = openssl_pkey_new([
            'private_key_type' => OPENSSL_KEYTYPE_EC,
            'curve_name' => 'prime256v1',
        ]);
        $this->assertNotFalse($signer);
        $pem = openssl_pkey_get_details($signer)['key'];
        $spki = P::encode(base64_decode(
            preg_replace('/-----[^-]+-----|\\s+/', '', $pem),
            true
        ));
        $id = (string) Str::uuid();
        $device = (string) Str::uuid();
        $this->people[$role] = [
            'id' => $id, 'device' => $device,
            'spki' => $spki, 'signer' => $signer,
        ];
        DB::table('identity_accounts')->insert([
            'id' => $id, 'operation_id' => (string) Str::uuid(),
            'prepare_hash' => str_repeat('d', 64), 'status' => 'ready',
            'account_spki' => $spki, 'reserved_until' => now()->addDay(),
            'created_at' => now(), 'updated_at' => now(),
        ]);
        DB::table('identity_devices')->insert([
            'id' => $device, 'account_id' => $id,
            'signing_spki' => $spki,
            'created_at' => now(), 'updated_at' => now(),
        ]);
    }

    private function actAs(string $role, ?int $issued = null): void
    {
        $p = $this->people[$role];
        $this->withSession([
            'identity_account' => $p['id'],
            'identity_device' => $p['device'],
            'identity_issued' => $issued ?? time(),
        ])->withHeader('Origin', 'https://localhost');
    }

    private function sign(string $role, string $message): string
    {
        $success = openssl_sign($message, $der, $this->people[$role]['signer'], OPENSSL_ALGO_SHA256);
        $this->assertTrue($success);
        $index = 2;
        $parts = [];
        for ($i = 0; $i < 2; $i++) {
            $this->assertSame(2, ord($der[$index++]));
            $bytes = ord($der[$index++]);
            $parts[] = str_pad(ltrim(substr($der, $index, $bytes), "\0"), 32, "\0", STR_PAD_LEFT);
            $index += $bytes;
        }
        return P::encode(implode('', $parts));
    }

    private function recipientKeyDigest(): string
    {
        $this->actAs('recipient');
        $recipient = $this->people['recipient'];
        $sealed = [
            'iv' => P::encode(random_bytes(12)),
            'ciphertext' => P::encode(random_bytes(64)),
        ];
        $descriptor = json_encode([
            'version' => 1, 'accountId' => $recipient['id'],
            'exchangeSpki' => $recipient['spki'],
            'sealedDigest' => hash('sha256', json_encode($sealed, JSON_UNESCAPED_SLASHES)),
        ], JSON_UNESCAPED_SLASHES | JSON_THROW_ON_ERROR);
        $this->postJson('/shares/v1/keys', [
            'descriptor' => $descriptor,
            'signature' => $this->sign('recipient', "pb3.recipient-key.v1\n".$descriptor),
            'sealedPrivate' => $sealed,
        ])->assertCreated();
        return hash('sha256', $descriptor);
    }

    private function grant(string $digest, int $deadline): array
    {
        $contract = json_encode([
            'version' => 1, 'grantId' => (string) Str::uuid(),
            'mediaId' => $this->mediaId,
            'ownerAccountId' => $this->people['owner']['id'],
            'recipientAccountId' => $this->people['recipient']['id'],
            'recipientKeyDigest' => $digest,
            'mediaContractHash' => $this->mediaHash,
            'scope' => 'read', 'expiresAt' => $deadline,
            'envelope' => [
                'ephemeralSpki' => $this->people['owner']['spki'],
                'salt' => P::encode(random_bytes(16)),
                'iv' => P::encode(random_bytes(12)),
                'ciphertext' => P::encode(random_bytes(48)),
            ],
        ], JSON_UNESCAPED_SLASHES | JSON_THROW_ON_ERROR);
        return [
            'contract' => $contract,
            'signature' => $this->sign('owner', "pb3.media-grant.v1\n".$contract),
        ];
    }

    public function test_signed_media_grant_dies_at_exact_millisecond_without_erasing_ciphertext_or_allowing_replay(): void
    {
        $digest = $this->recipientKeyDigest();
        $frozen = now()->startOfSecond()->addMilliseconds(250);
        $deadline = $frozen->getTimestampMs() + 5000;
        Carbon::setTestNow($frozen);
        try {
            $this->actAs('owner');
            $alreadyExpired = $this->grant($digest, $frozen->getTimestampMs());
            $this->postJson('/media-shares/v1/grants', $alreadyExpired)->assertUnprocessable();
            $this->postJson('/media-shares/v1/grants',
                $this->grant($digest, $frozen->getTimestampMs() - 1)
            )->assertUnprocessable();
            $this->assertDatabaseCount('media_recipient_grants_v1', 0);

            $signed = $this->grant($digest, $deadline);
            $id = json_decode($signed['contract'], true, 32, JSON_THROW_ON_ERROR)['grantId'];
            $this->postJson('/media-shares/v1/grants', $signed)
                ->assertCreated()->assertJsonPath('unchanged', false);
            $this->actAs('recipient');
            $this->getJson('/media-shares/v1/received')
                ->assertOk()->assertJsonPath('items.0.grantId', $id);
            $this->getJson('/media-shares/v1/grants/'.$id)->assertOk();
            $this->get('/media-shares/v1/grants/'.$id.'/chunks/'.$this->chunkId)
                ->assertOk()->assertHeader('X-Cipher-SHA256', hash('sha256', $this->chunkBody));

            Carbon::setTestNow($frozen->copy()->addMilliseconds(4999));
            $this->getJson('/media-shares/v1/grants/'.$id)->assertOk();
            $this->get('/media-shares/v1/grants/'.$id.'/chunks/'.$this->chunkId)->assertOk();

            Carbon::setTestNow($frozen->copy()->addMilliseconds(5000));
            $this->getJson('/media-shares/v1/received')
                ->assertOk()->assertJsonPath('items', []);
            $this->getJson('/media-shares/v1/grants/'.$id)->assertGone();
            $this->get('/media-shares/v1/grants/'.$id.'/chunks/'.$this->chunkId)->assertGone();

            $this->actAs('owner');
            $this->postJson('/media-shares/v1/grants', $signed)->assertUnprocessable();
            $extended = json_decode($signed['contract'], true, 32, JSON_THROW_ON_ERROR);
            $extended['expiresAt'] = $deadline + 3600000;
            $this->postJson('/media-shares/v1/grants', [
                'contract' => json_encode($extended, JSON_UNESCAPED_SLASHES | JSON_THROW_ON_ERROR),
                'signature' => $signed['signature'],
            ])->assertUnauthorized();

            $new = $this->grant($digest, $deadline + 3600000);
            $newId = json_decode($new['contract'], true, 32, JSON_THROW_ON_ERROR)['grantId'];
            $this->postJson('/media-shares/v1/grants', $new)->assertCreated();
            $this->assertNotSame($id, $newId);
            $this->actAs('recipient');
            $this->getJson('/media-shares/v1/received')
                ->assertOk()->assertJsonCount(1, 'items')
                ->assertJsonPath('items.0.grantId', $newId);
            $this->getJson('/media-shares/v1/grants/'.$id)->assertGone();
            $this->getJson('/media-shares/v1/grants/'.$newId)->assertOk();

            $this->actAs('outsider');
            $this->getJson('/media-shares/v1/grants/'.$newId)->assertNotFound();
            $this->actAs('recipient', time() - 86401);
            $this->getJson('/media-shares/v1/grants/'.$newId)->assertUnauthorized();
            $this->actAs('recipient');
            $this->getJson('/media-shares/v1/grants/'.$newId)->assertOk();

            $this->assertDatabaseHas('media_recipient_grants_v1', [
                'id' => $id, 'state' => 'active', 'expires_at' => $deadline,
            ]);
            $this->assertDatabaseHas('media_files_v1', [
                'id' => $this->mediaId, 'state' => 'active',
            ]);
            $this->assertSame($this->chunkBody, Storage::disk('ciphertext')->get($this->objectKey));
        } finally {
            Carbon::setTestNow();
        }
    }
}
