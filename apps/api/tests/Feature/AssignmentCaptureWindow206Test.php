<?php
declare(strict_types=1);

namespace Tests\Feature;

use App\Assignments\AssignmentContract;
use App\Photo\PhotoSync;
use Illuminate\Support\Str;
use Symfony\Component\HttpKernel\Exception\HttpException;
use Tests\TestCase;

/**
 * Signed capture evidence is only a bounded client clock declaration.
 * This verifies the same ceilings as the Vue media outbox, not media samples.
 */
final class AssignmentCaptureWindow206Test extends TestCase
{
    private function capture(string $kind,int $durationMs):array
    {
        $end=PhotoSync::nowMs();
        return [
            'version'=>1,
            'assignmentId'=>(string)Str::uuid(),
            'ownerAccountId'=>(string)Str::uuid(),
            'contributorAccountId'=>(string)Str::uuid(),
            'policyRevision'=>$kind==='photo'?1:2,
            'policyHash'=>str_repeat('a',64),
            'mediaId'=>(string)Str::uuid(),
            'mediaContractHash'=>str_repeat('b',64),
            'mediaType'=>$kind,
            'startedAt'=>$end-$durationMs,
            'finishedAt'=>$end,
        ];
    }

    public function test_photo_video_audio_exact_ceiling_still_valid():void
    {
        foreach(['photo'=>180000,'video'=>300000,'audio'=>3000000] as $kind=>$ms){
            $c=$this->capture($kind,$ms);
            AssignmentContract::mediaCapture($c,
                $c['contributorAccountId'],$c['assignmentId']);
            $this->assertSame($ms,$c['finishedAt']-$c['startedAt']);
        }
    }

    public function test_above_each_ceiling_is_rejected_422():void
    {
        foreach(['photo'=>180001,'video'=>300001,'audio'=>3000001] as $kind=>$ms){
            $c=$this->capture($kind,$ms);
            try {
                AssignmentContract::mediaCapture($c,
                    $c['contributorAccountId'],$c['assignmentId']);
                $this->fail('Unbounded '.$kind.' accepted');
            } catch(HttpException $e){
                $this->assertSame(422,$e->getStatusCode());
            }
        }
    }

    public function test_wrong_account_and_future_clock_remain_denied():void
    {
        $valid=$this->capture('audio',3000000);
        try {
            AssignmentContract::mediaCapture($valid,
                (string)Str::uuid(),$valid['assignmentId']);
            $this->fail('Foreign signer accepted');
        } catch(HttpException $e){
            $this->assertSame(422,$e->getStatusCode());
        }
        // The capture timestamp and validator clock are sampled at
        // different instants. Exactly 1ms past the +120s window may
        // legitimately ENTER the window before validation runs. Prove
        // allowed near-future timestamps still work, then use a timestamp
        // safely outside the unchanged policy to test denial deterministically.
        $nearFuture=$this->capture('audio',5000);
        $nearFuture['finishedAt']=PhotoSync::nowMs()+60000;
        $nearFuture['startedAt']=$nearFuture['finishedAt']-5000;
        AssignmentContract::mediaCapture($nearFuture,
            $nearFuture['contributorAccountId'],$nearFuture['assignmentId']);

        $valid['finishedAt']=PhotoSync::nowMs()+180000;
        $valid['startedAt']=$valid['finishedAt']-5000;
        try {
            AssignmentContract::mediaCapture($valid,
                $valid['contributorAccountId'],$valid['assignmentId']);
            $this->fail('Future-dated capture accepted');
        } catch(HttpException $e){
            $this->assertSame(422,$e->getStatusCode());
        }
    }

    public function test_photo_only_legacy_minimum_is_not_changed():void
    {
        $c=$this->capture('photo',1);
        AssignmentContract::mediaCapture($c,
            $c['contributorAccountId'],$c['assignmentId']);
        $this->assertSame(1,$c['finishedAt']-$c['startedAt']);
    }
}
