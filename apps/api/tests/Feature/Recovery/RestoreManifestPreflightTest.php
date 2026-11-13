<?php
declare(strict_types=1);

namespace Tests\Feature\Recovery;

use App\Recovery\RestoreManifestPreflight;
use DomainException;
use PHPUnit\Framework\TestCase;

final class RestoreManifestPreflightTest extends TestCase
{
    private const OWNER = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
    private const FOREIGN = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
    private const GENERATION = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
    private const FILE_A = '11111111-1111-4111-8111-111111111111';
    private const FILE_B = '22222222-2222-4222-8222-222222222222';
    private const NOW = 2_000;

    private \OpenSSLAsymmetricKey $signingKey;
    private string $ownerSpki;

    protected function setUp(): void
    {
        parent::setUp();
        $key = openssl_pkey_new([
            'private_key_type'=>OPENSSL_KEYTYPE_EC,
            'curve_name'=>'prime256v1',
        ]);
        self::assertInstanceOf(\OpenSSLAsymmetricKey::class, $key);
        $this->signingKey = $key;
        $details = openssl_pkey_get_details($key);
        self::assertIsArray($details);
        $pem = $details['key'];
        $der = base64_decode((string) preg_replace('/-----[^-]+-----|\s+/', '', $pem), true);
        self::assertIsString($der);
        $this->ownerSpki = self::b64($der);
    }

    private static function b64(string $bytes): string
    {
        return rtrim(strtr(base64_encode($bytes), '+/', '-_'), '=');
    }

    /** Convert real OpenSSL SHA-256/P-256 DER signature to WebCrypto P1363. */
    private static function rawSignature(string $der): string
    {
        self::assertSame("\x30", $der[0]);
        $length = ord($der[1]);
        self::assertSame(strlen($der)-2, $length);
        $p=2;
        self::assertSame("\x02", $der[$p++]);
        $rLen=ord($der[$p++]);
        $r=substr($der,$p,$rLen);
        $p+=$rLen;
        self::assertSame("\x02", $der[$p++]);
        $sLen=ord($der[$p++]);
        $s=substr($der,$p,$sLen);
        $p+=$sLen;
        self::assertSame(strlen($der), $p);
        $r=ltrim($r,"\x00");
        $s=ltrim($s,"\x00");
        self::assertLessThanOrEqual(32,strlen($r));
        self::assertLessThanOrEqual(32,strlen($s));
        return str_pad($r,32,"\x00",STR_PAD_LEFT).str_pad($s,32,"\x00",STR_PAD_LEFT);
    }

    private function sign(string $bytes, string $purpose="pb3.backup-restore-manifest.v1\n"): string
    {
        $ok=openssl_sign($purpose.$bytes,$der,$this->signingKey,OPENSSL_ALGO_SHA256);
        self::assertTrue($ok);
        return self::b64(self::rawSignature($der));
    }

    private static function file(
        string $id, string $sha='a', int $size=24, ?int $expiresAt=2_500
    ): array {
        return [
            'assetId'=>$id,'ciphertextBytes'=>$size,
            'ciphertextSha256'=>str_repeat($sha,64),
            'envelopeSha256'=>str_repeat('e',64),
            'expiresAt'=>$expiresAt,
        ];
    }

    /** @return array<string,mixed> */
    private function fixture(): array
    {
        $manifest=[
            'accountId'=>self::OWNER,
            'createdAt'=>1_000,
            'files'=>[
                self::file(self::FILE_A, 'a', 24),
                self::file(self::FILE_B, 'b', 48),
            ],
            'generationId'=>self::GENERATION,
            'version'=>1,
        ];
        $bytes=json_encode($manifest,JSON_UNESCAPED_SLASHES|JSON_THROW_ON_ERROR);
        return [
            'manifest'=>$manifest,
            'bytes'=>$bytes,
            'signature'=>$this->sign($bytes),
            'spki'=>$this->ownerSpki,
            'generation'=>[
                'accountId'=>self::OWNER,
                'generationId'=>self::GENERATION,
                'state'=>'verified',
                'active'=>true,
                'verifiedAt'=>1_050,
                'manifestSha256'=>hash('sha256',$bytes),
            ],
            'policy'=>[
                self::FILE_A=>self::policy('a',24),
                self::FILE_B=>self::policy('b',48),
            ],
            'actor'=>self::OWNER,
            'now'=>self::NOW,
        ];
    }

    private static function policy(string $sha,int $size): array
    {
        return [
            'ownerAccountId'=>self::OWNER,
            'restorable'=>true,
            'tombstoned'=>false,
            'expiresAt'=>2_700,
            'ciphertextSha256'=>str_repeat($sha,64),
            'ciphertextBytes'=>$size,
        ];
    }

    private function resign(array &$f): void
    {
        $f['bytes']=json_encode($f['manifest'],JSON_UNESCAPED_SLASHES|JSON_THROW_ON_ERROR);
        $f['signature']=$this->sign($f['bytes']);
        $f['generation']['manifestSha256']=hash('sha256',$f['bytes']);
    }

    private function inspect(array $f): array
    {
        return (new RestoreManifestPreflight())->inspect(
            $f['bytes'],$f['signature'],$f['spki'],$f['generation'],
            $f['policy'],$f['actor'],$f['now'],
        );
    }

    private function reject(array $f): void
    {
        try {
            $this->inspect($f);
            self::fail('Unsafe/untrusted restore selection was accepted');
        } catch (DomainException $error) {
            self::assertSame('recovery.restore_preflight_denied',$error->getMessage());
        }
    }

    public function test_real_p256_signed_active_verified_manifest_and_current_policy(): void
    {
        $f=$this->fixture();
        $result=$this->inspect($f);
        self::assertSame(self::GENERATION,$result['generationId']);
        self::assertSame([self::FILE_A,self::FILE_B],
            array_column($result['eligible'],'assetId'));
        self::assertSame(72,$result['ciphertextBytes']);
        self::assertSame([],$result['excluded']);
        self::assertArrayNotHasKey('key',$result);
        self::assertArrayNotHasKey('plaintext',$result);
    }

    public function test_wrong_owner_public_key_never_verifies_signed_manifest(): void
    {
        $f=$this->fixture();
        $foreign=openssl_pkey_new([
            'private_key_type'=>OPENSSL_KEYTYPE_EC,'curve_name'=>'prime256v1',
        ]);
        self::assertInstanceOf(\OpenSSLAsymmetricKey::class,$foreign);
        $details=openssl_pkey_get_details($foreign);
        self::assertIsArray($details);
        $der=base64_decode((string)preg_replace('/-----[^-]+-----|\s+/','',$details['key']),true);
        self::assertIsString($der);
        $f['spki']=self::b64($der);
        $this->reject($f);
    }

    public function test_manifest_tamper_rejected_even_if_server_hash_replaced(): void
    {
        $f=$this->fixture();
        $f['manifest']['files'][0]['ciphertextBytes']=25;
        $f['bytes']=json_encode($f['manifest'],JSON_UNESCAPED_SLASHES|JSON_THROW_ON_ERROR);
        $f['generation']['manifestSha256']=hash('sha256',$f['bytes']);
        // Original signature doesn't authenticate changed bytes.
        $this->reject($f);
    }

    public function test_signature_is_bound_to_backup_domain_not_other_purpose(): void
    {
        $f=$this->fixture();
        $f['signature']=$this->sign($f['bytes'],"pb3.other-protocol.v1\n");
        $this->reject($f);
    }

    public function test_malformed_p1363_and_spki_are_rejected(): void
    {
        foreach (['bad','../','AA==',str_repeat('z',86)] as $sig) {
            $f=$this->fixture();$f['signature']=$sig;$this->reject($f);
        }
        $f=$this->fixture();$f['spki']=self::b64('not a P256 key');
        $this->reject($f);
    }

    public function test_trusted_generation_cannot_be_staged_failed_inactive_future_or_foreign(): void
    {
        foreach ([
            ['state'=>'staging'],['state'=>'failed'],['active'=>false],
            ['verifiedAt'=>3_000],['verifiedAt'=>999],
            ['accountId'=>self::FOREIGN],['manifestSha256'=>str_repeat('0',64)],
            ['generationId'=>self::FOREIGN],
        ] as $changes) {
            $f=$this->fixture();
            $f['generation']=array_replace($f['generation'],$changes);
            $this->reject($f);
        }
    }

    public function test_cannot_select_same_signed_manifest_under_another_account(): void
    {
        $f=$this->fixture();
        $f['actor']=self::FOREIGN;
        $this->reject($f);
        $f=$this->fixture();
        $f['manifest']['accountId']=self::FOREIGN;
        $this->resign($f);
        $this->reject($f);
    }

    public function test_wrong_generation_on_validly_resigned_manifest_is_denied(): void
    {
        $f=$this->fixture();
        $f['manifest']['generationId']=self::FOREIGN;
        $this->resign($f);
        $this->reject($f);
    }

    public function test_stale_or_missing_authoritative_asset_cannot_be_resurrected(): void
    {
        foreach ([
            ['tombstoned'=>true],
            ['restorable'=>false],
            ['ownerAccountId'=>self::FOREIGN],
            ['expiresAt'=>2_000],
            ['expiresAt'=>1_999],
        ] as $changes) {
            $f=$this->fixture();
            $f['policy'][self::FILE_A]=array_replace($f['policy'][self::FILE_A],$changes);
            $result=$this->inspect($f);
            self::assertSame([self::FILE_B],array_column($result['eligible'],'assetId'));
            self::assertSame(48,$result['ciphertextBytes']);
            self::assertSame([self::FILE_A],array_column($result['excluded'],'assetId'));
        }
        $f=$this->fixture();
        unset($f['policy'][self::FILE_A]);
        $result=$this->inspect($f);
        self::assertSame([self::FILE_B],array_column($result['eligible'],'assetId'));
    }

    public function test_signed_file_ttl_takes_precedence_even_when_server_policy_is_later(): void
    {
        $f=$this->fixture();
        $f['manifest']['files'][0]['expiresAt']=self::NOW;
        $this->resign($f);
        $result=$this->inspect($f);
        self::assertSame([self::FILE_B],array_column($result['eligible'],'assetId'));
        self::assertSame('expired',$result['excluded'][0]['reason']);
    }

    public function test_ciphertext_digest_and_byte_mismatch_deny_restore_of_reused_asset_id(): void
    {
        foreach ([
            ['ciphertextSha256'=>str_repeat('f',64)],
            ['ciphertextBytes'=>99],
        ] as $changes) {
            $f=$this->fixture();
            $f['policy'][self::FILE_A]=array_replace($f['policy'][self::FILE_A],$changes);
            $result=$this->inspect($f);
            self::assertSame([self::FILE_B],array_column($result['eligible'],'assetId'));
            self::assertSame('ciphertext_version_changed',$result['excluded'][0]['reason']);
        }
    }

    public function test_signed_duplicate_unsorted_or_empty_inventory_is_denied(): void
    {
        $f=$this->fixture();
        $f['manifest']['files'][]=$f['manifest']['files'][1];
        $this->resign($f);$this->reject($f);

        $f=$this->fixture();
        $f['manifest']['files']=array_reverse($f['manifest']['files']);
        $this->resign($f);$this->reject($f);

        $f=$this->fixture();
        $f['manifest']['files']=[];
        $this->resign($f);$this->reject($f);
    }

    public function test_valid_signature_does_not_allow_unknown_or_malformed_manifest_fields(): void
    {
        $f=$this->fixture();
        $f['manifest']['newPrivilege']='allow';
        $this->resign($f);$this->reject($f);

        $f=$this->fixture();
        $f['manifest']['files'][0]['allowOriginal']=true;
        $this->resign($f);$this->reject($f);

        $f=$this->fixture();
        $f['manifest']['files'][0]['envelopeSha256']='not-a-hash';
        $this->resign($f);$this->reject($f);

        $f=$this->fixture();
        $f['manifest']['files'][0]['ciphertextBytes']=0;
        $this->resign($f);$this->reject($f);
    }

    public function test_signed_manifest_future_created_at_or_invalid_verified_order_is_denied(): void
    {
        $f=$this->fixture();
        $f['manifest']['createdAt']=self::NOW+1;
        $this->resign($f);$this->reject($f);

        $f=$this->fixture();
        $f['manifest']['createdAt']=1_051;
        $this->resign($f);$this->reject($f);
    }

    public function test_noncanonical_json_and_duplicate_object_keys_rejected_even_if_signed(): void
    {
        $f=$this->fixture();
        $f['bytes']=str_replace('"createdAt":1000','"createdAt":1000,"createdAt":1000',$f['bytes']);
        $f['signature']=$this->sign($f['bytes']);
        $f['generation']['manifestSha256']=hash('sha256',$f['bytes']);
        $this->reject($f);

        $f=$this->fixture();
        $f['bytes']=str_replace(',"files":',', "files":',$f['bytes']);
        $f['signature']=$this->sign($f['bytes']);
        $f['generation']['manifestSha256']=hash('sha256',$f['bytes']);
        $this->reject($f);
    }

    public function test_broken_current_policy_rejected_instead_of_silently_skipped(): void
    {
        foreach ([
            ['restorable'=>'yes'],
            ['tombstoned'=>null],
            ['ciphertextSha256'=>'bad'],
            ['expiresAt'=>'soon'],
        ] as $changes) {
            $f=$this->fixture();
            $f['policy'][self::FILE_A]=array_replace($f['policy'][self::FILE_A],$changes);
            $this->reject($f);
        }
    }

    public function test_missing_all_current_grants_yields_empty_dry_run_not_implicit_regrant(): void
    {
        $f=$this->fixture();
        $f['policy']=[];
        $result=$this->inspect($f);
        self::assertSame([],$result['eligible']);
        self::assertSame(0,$result['ciphertextBytes']);
        self::assertCount(2,$result['excluded']);
    }

    public function test_full_signature_is_not_a_license_to_restore_expired_original(): void
    {
        $f=$this->fixture();
        $f['manifest']['files'][0]['expiresAt']=1_999;
        $f['manifest']['files'][1]['expiresAt']=1_999;
        $this->resign($f);
        $result=$this->inspect($f);
        self::assertSame(0,$result['ciphertextBytes']);
        self::assertSame([],$result['eligible']);
        self::assertCount(2,$result['excluded']);
    }

    public function test_bounded_manifest_and_missing_verified_receipt_denied(): void
    {
        $f=$this->fixture();
        $f['bytes']=str_repeat('x',2_000_001);
        $this->reject($f);

        $f=$this->fixture();
        unset($f['generation']['verifiedAt']);
        $this->reject($f);
    }
}
