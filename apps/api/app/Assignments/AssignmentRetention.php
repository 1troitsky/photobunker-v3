<?php
declare(strict_types=1);

namespace App\Assignments;

use App\Photo\PhotoSync;

/**
 * P1-21: owner-signed ASSIGNMENT-SCOPED access deadlines, not remote file TTL.
 * Contributor media is owned by the contributor and can have independent
 * recipients. Assignment owners cannot physically delete it with this policy.
 */
final class AssignmentRetention
{
    public static function validate(array $c,string $owner,string $assignment):void
    {
        abort_unless(($c['version']??null)===1
            &&($c['assignmentId']??null)===$assignment
            &&($c['ownerAccountId']??null)===$owner
            &&is_int($c['fromRetentionRevision']??null)
            &&$c['fromRetentionRevision']>=1
            &&$c['fromRetentionRevision']<=1000
            &&($c['toRetentionRevision']??null)===$c['fromRetentionRevision']+1
            &&($c['deleteOriginals']??null)===false,422);
        foreach(['assignmentId','ownerAccountId','operationId'] as $key)
            \App\Identity\Protocol::uuid($c[$key]??null);
        foreach(['rootPolicyHash','previousRetentionHash'] as $key)
            abort_unless(is_string($c[$key]??null)
                &&preg_match('/^[a-f0-9]{64}$/D',$c[$key])===1,422);
        foreach(['filesAccessUntil','assignmentAccessUntil'] as $key){
            $date=$c[$key]??null;
            abort_unless($date===null||(
                is_int($date)&&$date>=1577836800000
                &&$date<=4102444800000),422);
        }
        $files=$c['filesAccessUntil'];
        $assignmentUntil=$c['assignmentAccessUntil'];
        abort_unless($files===null||$assignmentUntil===null
            ||$assignmentUntil>=$files,422);
    }

    public static function current(object $a):array
    {
        $revision=(int)($a->retention_revision??1);
        if($revision===1){
            abort_unless(($a->latest_retention_contract??null)===null,409);
            return ['filesAccessUntil'=>null,'assignmentAccessUntil'=>null,
                'deleteOriginals'=>false];
        }
        $raw=$a->latest_retention_contract??null;
        abort_unless(is_string($raw),409);
        $data=json_decode($raw,true,32,JSON_THROW_ON_ERROR);
        abort_unless(is_array($data)
            &&($data['version']??null)===1
            &&($data['toRetentionRevision']??null)===$revision
            &&($data['deleteOriginals']??null)===false
            &&($data['filesAccessUntil']??null)===($a->files_access_until??null)
            &&($data['assignmentAccessUntil']??null)===($a->assignment_access_until??null),
            409);
        return [
            'filesAccessUntil'=>$data['filesAccessUntil'],
            'assignmentAccessUntil'=>$data['assignmentAccessUntil'],
            'deleteOriginals'=>false,
        ];
    }

    public static function assignmentOpen(object $a,?int $when=null):bool
    {
        $when??=PhotoSync::nowMs();
        return ($a->assignment_access_until??null)===null
            ||(int)$a->assignment_access_until>$when;
    }

    public static function filesOpen(object $a,?int $when=null):bool
    {
        $when??=PhotoSync::nowMs();
        return self::assignmentOpen($a,$when)
            &&(($a->files_access_until??null)===null
                ||(int)$a->files_access_until>$when);
    }

    public static function requireAvailable(object $a):void
    {
        abort_unless(self::assignmentOpen($a),404);
    }

    /** Equal-or-later than the signed effective schedule's end, if any. */
    public static function validateDeadlinesAgainstSchedule(
        array $retention,array $schedule
    ):void{
        $end=$schedule['endsAt'];
        if($end===null)return;
        foreach(['filesAccessUntil','assignmentAccessUntil'] as $key){
            abort_unless($retention[$key]===null||$retention[$key]>=$end,409);
        }
    }

    /** No resurrection by revising after either already-expired cutoff. */
    public static function mayRevise(object $a):bool
    {
        if(!self::assignmentOpen($a))return false;
        return ($a->files_access_until??null)===null
            ||(int)$a->files_access_until>PhotoSync::nowMs();
    }
}
