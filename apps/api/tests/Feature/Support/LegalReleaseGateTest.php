<?php
declare(strict_types=1);

namespace Tests\Feature\Support;

use App\Support\LegalReleaseGate;
use DateTimeImmutable;
use PHPUnit\Framework\TestCase;

final class LegalReleaseGateTest extends TestCase
{
    private function fixture(): array
    {
        $docs = [];
        $pins = [];
        foreach (['terms','privacy'] as $type) {
            foreach (['ru','en'] as $locale) {
                $body = str_repeat("Real review required; synthetic $type $locale legal body. ", 12);
                $docs[$type][$locale] = ['revision'=>'2026.11','body'=>$body];
                $pins[$type][$locale] = hash('sha256', $body);
            }
        }
        return [$docs, [
            'revision'=>'2026.11',
            'approval_reference'=>'LEGAL-REVIEW-123',
            'processing_regions'=>['GE'],
            'effective_at'=>'2026-11-14T00:00:00Z',
            'sha256'=>$pins,
        ]];
    }

    private function now(): DateTimeImmutable
    {
        return new DateTimeImmutable('2026-11-14T12:00:00+04:00');
    }

    public function test_all_four_pinned_documents_have_integrity_but_no_legal_approval_claim(): void
    {
        [$docs,$manifest] = $this->fixture();
        $r = LegalReleaseGate::preflight($docs,$manifest,$this->now());
        self::assertTrue($r['integrity_verified']);
        self::assertSame('structural_preflight_only',$r['reason']);
        self::assertCount(2,$r['digests']['terms']);
        self::assertCount(2,$r['digests']['privacy']);
        self::assertArrayNotHasKey('can_publish',$r);
    }

    public function test_rejects_missing_language_modified_bytes_wrong_revision_and_placeholders(): void
    {
        [$docs,$manifest] = $this->fixture();
        $missing = $docs;
        unset($missing['privacy']['en']);
        self::assertSame('document_contract',LegalReleaseGate::preflight($missing,$manifest,$this->now())['reason']);

        $modified = $docs;
        $modified['terms']['ru']['body'] .= 'MODIFIED';
        self::assertSame('digest_mismatch',LegalReleaseGate::preflight($modified,$manifest,$this->now())['reason']);

        $wrongRev = $docs;
        $wrongRev['terms']['en']['revision'] = 'other';
        self::assertSame('document_contract',LegalReleaseGate::preflight($wrongRev,$manifest,$this->now())['reason']);

        $draft = $docs;
        $draft['terms']['ru']['body'] = str_repeat('DRAFT ONLY ', 30);
        $manifest['sha256']['terms']['ru'] = hash('sha256',$draft['terms']['ru']['body']);
        self::assertSame('placeholder_or_size',LegalReleaseGate::preflight($draft,$manifest,$this->now())['reason']);
    }

    public function test_rejects_future_release_missing_reference_and_invalid_processing_location(): void
    {
        [$docs,$manifest] = $this->fixture();
        $manifest['effective_at'] = '2026-12-01T00:00:00Z';
        self::assertSame('effective_at',LegalReleaseGate::preflight($docs,$manifest,$this->now())['reason']);

        $manifest['effective_at'] = '2026-11-14T00:00:00Z';
        unset($manifest['approval_reference']);
        self::assertSame('approval_reference',LegalReleaseGate::preflight($docs,$manifest,$this->now())['reason']);

        $manifest['approval_reference'] = 'LEGAL-REVIEW-123';
        $manifest['processing_regions'] = ['GE','GE'];
        self::assertSame('processing_regions',LegalReleaseGate::preflight($docs,$manifest,$this->now())['reason']);
        $manifest['processing_regions'] = ['unknown'];
        self::assertSame('processing_regions',LegalReleaseGate::preflight($docs,$manifest,$this->now())['reason']);
    }
}
