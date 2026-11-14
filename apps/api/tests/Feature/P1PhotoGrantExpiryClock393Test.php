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
 * #393 / P1 #201: real owner P-256 signed PHOTO grant expiration across
 * list, manifest and both ciphertext object routes. This is PHP HTTP QA,
 * using synthetic bytes, NOT a substitute for real client AES-GCM testing.
 */
final class P1PhotoGrantExpiryClock393Test extends TestCase
{
    use RefreshDatabase;

    private array $people = [];
    private string $photoId;
    private array $assets = [];
    private array $ciphertexts = [];

    protected function setUp(): void
    {
        parent::setUp();
        Storage::fake('ciphertext');
        foreach (['owner', 'recipient', 'outsider'] as $role) {
            $this->newAccount($role);
        }

        $this->photoId = (string) Str::uuid();
        $owner = $this->people['owner'];
        DB::table('photo_records')->insert([
            'id' => $this->photoId,
            'account_id' => $owner['id'],
            'device_id' => $owner['device'],
            'operation_id' => (string) Str::uuid(),
            'state' => 'active',
            'expires_at' => now()->addDays(2)->getTimestampMs(),
            'contract_hash' => str_repeat('a', 64),
            'contract_json' => '{}',
            'signature' => 'synthetic-photo-fixture',
            'created_at' => now(),
            'updated_at' => now(),
        ]);

        foreach (['master', 'metadata'] as $kind) {
            $assetId = (string) Str::uuid();
            $ciphertext = random_bytes($kind === 'master' ? 272 : 112);
            $key = 'cipher/v1/'.$owner['id'].'/'.$this->photoId.'/'.$assetId;
            Storage::disk('ciphertext')->put($key, $ciphertext);
            DB::table('photo_objects')->insert([
                'id' => $assetId,
                'photo_id' => $this->photoId,
                'kind' => $kind,
                'revision' => 1,
                'bytes' => strlen($ciphertext),
                'sha256' => hash('sha256', $ciphertext),
                'manifest_json' => '{}',
                'object_key' => $key,
                'state' => 'active',
                'created_at' => now(),
                'updated_at' => now(),
            ]);
            DB::table('storage_locations')->insert([
                'id' => (string) Str::uuid(),
                'asset_id' => $assetId,
                'provider' => 'app_s3',
                'object_key' => $key,
                'bytes' => strlen($ciphertext),
                'sha256' => hash('sha256', $ciphertext),
                'state' => 'active',
                'created_at' => now(),
                'updated_at' => now(),
            ]);
            $this->ciphertexts[$assetId] = ['key' => $key, 'bytes' => $ciphertext];
            $this->assets[] = [
                'assetId' => $assetId,
                'ephemeralSpki' => $owner['spki'],
                'salt' => P::encode(random_bytes(16)),
                'iv' => P::encode(random_bytes(12)),
                'ciphertext' => P::encode(random_bytes(48)),
            ];
        }
        usort($this->assets, fn (array $a, array $b): int => strcmp($a['assetId'], $b['assetId']));
    }

    private function newAccount(string $role): void
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
            'prepare_hash' => str_repeat('d', 64),
            'status' => 'ready', 'account_spki' => $spki,
            'reserved_until' => now()->addDay(),
            'created_at' => now(), 'updated_at' => now(),
        ]);
        DB::table('identity_devices')->insert([
            'id' => $device, 'account_id' => $id,
            'signing_spki' => $spki,
            'created_at' => now(), 'updated_at' => now(),
        ]);
    }

    private function become(string $role): void
    {
        $person = $this->people[$role];
        $this->withSession([
            'identity_account' => $person['id'],
            'identity_device' => $person['device'],
            'identity_issued' => time(),
        ])->withHeader('Origin', 'https://localhost');
    }

    private function sign(string $role, string $text): string
    {
        $this->assertTrue(openssl_sign(
            $text, $der, $this->people[$role]['signer'], OPENSSL_ALGO_SHA256
        ));
        $index = 2;
        $values = [];
        for ($i = 0; $i < 2; $i++) {
            $this->assertSame(2, ord($der[$index++]));
            $length = ord($der[$index++]);
            $values[] = str_pad(
                ltrim(substr($der, $index, $length), "\0"),
                32, "\0", STR_PAD_LEFT
            );
            $index += $length;
        }
        return P::encode(implode('', $values));
    }

    private function publishRecipientKey(): string
    {
        $this->become('recipient');
        $recipient = $this->people['recipient'];
        $sealed = [
            'iv' => P::encode(random_bytes(12)),
            'ciphertext' => P::encode(random_bytes(64)),
        ];
        $descriptor = json_encode([
            'version' => 1,
            'accountId' => $recipient['id'],
            'exchangeSpki' => $recipient['spki'],
            'sealedDigest' => hash(
                'sha256', json_encode($sealed, JSON_UNESCAPED_SLASHES)
            ),
        ], JSON_UNESCAPED_SLASHES | JSON_THROW_ON_ERROR);
        $this->postJson('/shares/v1/keys', [
            'descriptor' => $descriptor,
            'sealedPrivate' => $sealed,
            'signature' => $this->sign(
                'recipient', "pb3.recipient-key.v1\n".$descriptor
            ),
        ])->assertCreated();
        return hash('sha256', $descriptor);
    }

    private function grant(string $digest, int $expiry): array
    {
        $contract = json_encode([
            'version' => 1,
            'grantId' => (string) Str::uuid(),
            'photoId' => $this->photoId,
            'ownerAccountId' => $this->people['owner']['id'],
            'recipientAccountId' => $this->people['recipient']['id'],
            'recipientKeyDigest' => $digest,
            'scope' => 'read',
            'expiresAt' => $expiry,
            'assets' => $this->assets,
        ], JSON_UNESCAPED_SLASHES | JSON_THROW_ON_ERROR);
        return [
            'contract' => $contract,
            'signature' => $this->sign('owner', "pb3.photo-grant.v1\n".$contract),
        ];
    }

    public function test_photo_grant_exact_millisecond_cutoff_revokes_all_recipient_reads_without_deleting_owner_ciphertext(): void
    {
        $digest = $this->publishRecipientKey();
        $base = now()->startOfSecond()->addMilliseconds(250);
        $expiry = $base->getTimestampMs() + 5000;
        Carbon::setTestNow($base);
        try {
            $this->become('owner');
            $this->postJson('/shares/v1/grants',
                $this->grant($digest, $base->getTimestampMs())
            )->assertUnprocessable();
            $this->assertDatabaseCount('photo_access_grants', 0);

            $original = $this->grant($digest, $expiry);
            $oldId = json_decode(
                $original['contract'], true, 32, JSON_THROW_ON_ERROR
            )['grantId'];
            $this->postJson('/shares/v1/grants', $original)
                ->assertCreated()->assertJsonPath('unchanged', false);

            $baseUrl = '/shares/v1/grants/'.$oldId;
            $this->become('recipient');
            $this->getJson('/shares/v1/received')
                ->assertOk()->assertJsonPath('items.0.grantId', $oldId);
            $this->getJson($baseUrl)->assertOk()
                ->assertJsonPath('contract', $original['contract']);

            foreach ($this->assets as $asset) {
                $id = $asset['assetId'];
                $this->get($baseUrl.'/objects/'.$id)
                    ->assertOk()
                    ->assertHeader('Cache-Control', 'no-store, private')
                    ->assertHeader('X-Cipher-SHA256', hash('sha256', $this->ciphertexts[$id]['bytes']));
            }

            Carbon::setTestNow($base->copy()->addMilliseconds(4999));
            $this->getJson($baseUrl)->assertOk();
            foreach ($this->assets as $asset) {
                $this->get($baseUrl.'/objects/'.$asset['assetId'])->assertOk();
            }

            // No change to the signed photo TTL; only GRANT expires.
            Carbon::setTestNow($base->copy()->addMilliseconds(5000));
            $this->getJson('/shares/v1/received')
                ->assertOk()->assertJsonPath('items', []);
            $this->getJson($baseUrl)->assertGone();
            foreach ($this->assets as $asset) {
                $this->get($baseUrl.'/objects/'.$asset['assetId'])->assertGone();
            }

            $this->become('owner');
            $this->postJson('/shares/v1/grants', $original)->assertUnprocessable();
            $forged = json_decode($original['contract'], true, 32, JSON_THROW_ON_ERROR);
            $forged['expiresAt'] = $expiry + 3600000;
            $this->postJson('/shares/v1/grants', [
                'contract' => json_encode($forged, JSON_UNESCAPED_SLASHES | JSON_THROW_ON_ERROR),
                'signature' => $original['signature'],
            ])->assertUnauthorized();

            $fresh = $this->grant($digest, $expiry + 3600000);
            $newId = json_decode($fresh['contract'], true, 32, JSON_THROW_ON_ERROR)['grantId'];
            $this->assertNotSame($oldId, $newId);
            $this->postJson('/shares/v1/grants', $fresh)->assertCreated();

            $this->become('recipient');
            $this->getJson('/shares/v1/received')
                ->assertOk()->assertJsonCount(1, 'items')
                ->assertJsonPath('items.0.grantId', $newId);
            $this->getJson($baseUrl)->assertGone();
            $this->getJson('/shares/v1/grants/'.$newId)->assertOk();
            $this->become('outsider');
            $this->getJson('/shares/v1/grants/'.$newId)->assertNotFound();

            $this->assertDatabaseHas('photo_access_grants', [
                'id' => $oldId, 'state' => 'active', 'expires_at' => $expiry,
            ]);
            $this->assertDatabaseHas('photo_records', [
                'id' => $this->photoId, 'state' => 'active',
            ]);
            foreach ($this->ciphertexts as $assetId => $saved) {
                $this->assertSame(
                    $saved['bytes'], Storage::disk('ciphertext')->get($saved['key'])
                );
                $this->assertDatabaseHas('photo_objects', [
                    'id' => $assetId, 'state' => 'active',
                ]);
            }
        } finally {
            Carbon::setTestNow();
        }
    }
}
