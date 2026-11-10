<?php
declare(strict_types=1);

namespace App\Assignments;

use App\Photo\PhotoSync;

/**
 * Independent owner-signed schedule. Root times stay IMMUTABLE in the
 * original owner-signed creation contract and DB columns.
 *
 * Existing v1 assignments preserve their original hard time window.
 * An explicit signed schedule can disable either admission restriction.
 * This governs assignment admission only; it NEVER deletes media.
 */
final class AssignmentSchedule
{
    public static function validate(array $d,string $owner,string $assignment):void
    {
        $keys=['version','operationId','assignmentId','ownerAccountId',
            'rootPolicyHash','previousScheduleHash','fromScheduleRevision',
            'toScheduleRevision','startsAt','endsAt',
            'blockBeforeStart','blockAfterEnd'];
        abort_unless(array_keys($d)===$keys
            &&($d['version']??null)===1
            &&($d['assignmentId']??null)===$assignment
            &&($d['ownerAccountId']??null)===$owner
            &&is_int($d['fromScheduleRevision']??null)
            &&$d['fromScheduleRevision']>=1&&$d['fromScheduleRevision']<=1000
            &&($d['toScheduleRevision']??null)===$d['fromScheduleRevision']+1
            &&is_bool($d['blockBeforeStart']??null)
            &&is_bool($d['blockAfterEnd']??null),422);
        foreach(['rootPolicyHash','previousScheduleHash'] as $key)
            abort_unless(is_string($d[$key]??null)
                &&preg_match('/^[a-f0-9]{64}$/D',$d[$key])===1,422);
        $start=$d['startsAt']??null;
        $end=$d['endsAt']??null;
        // Bounded Unix millisecond timestamps. Older root starts remain immutable.
        abort_unless(is_int($start)&&$start>=1577836800000
            &&$start<=4102444800000
            &&($end===null||(is_int($end)&&$end>$start
                &&$end<=4102444800000))
            &&($end!==null||$d['blockAfterEnd']===false),422);
        \App\Identity\Protocol::uuid($d['operationId']);
        \App\Identity\Protocol::uuid($d['assignmentId']);
        \App\Identity\Protocol::uuid($d['ownerAccountId']);
    }

    /** Effective gates for admission using server receipt time, not device clock. */
    public static function current(object $a):array
    {
        if((int)($a->schedule_revision??1)===1){
            return ['startsAt'=>(int)$a->starts_at,
                'endsAt'=>$a->ends_at===null?null:(int)$a->ends_at,
                'blockBeforeStart'=>true,
                'blockAfterEnd'=>$a->ends_at!==null];
        }
        $raw=$a->latest_schedule_contract;
        abort_unless(is_string($raw),409);
        $d=json_decode($raw,true,32,JSON_THROW_ON_ERROR);
        abort_unless(is_array($d)&&($d['version']??null)===1
            &&($d['toScheduleRevision']??null)===(int)$a->schedule_revision,409);
        return ['startsAt'=>$d['startsAt'],'endsAt'=>$d['endsAt'],
            'blockBeforeStart'=>$d['blockBeforeStart'],
            'blockAfterEnd'=>$d['blockAfterEnd']];
    }

    public static function permits(object $a,int $at):bool
    {
        $s=self::current($a);
        return (!$s['blockBeforeStart']||$at>=$s['startsAt'])
            &&(!$s['blockAfterEnd']
                ||($s['endsAt']!==null&&$at<$s['endsAt']));
    }

    public static function permitsNow(object $a):bool
    {
        return self::permits($a,PhotoSync::nowMs());
    }
}
