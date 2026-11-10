import type { AssignmentListing, AssignmentSchedule } from './assignment-outbox'
import { signedAssignmentSchedule, validAssignmentSchedule } from './assignment-outbox'

export type ScheduleEditorDraft={
  startsAt:string;endsAt:string
  blockBeforeStart:boolean;blockAfterEnd:boolean
}
function localDatetime(value:number):string{
  const d=new Date(value)
  const pad=(n:number)=>String(n).padStart(2,'0')
  return d.getFullYear()+'-'+pad(d.getMonth()+1)+'-'+pad(d.getDate())
    +'T'+pad(d.getHours())+':'+pad(d.getMinutes())
}
/** datetime-local uses device local time; never write the displayed minute
 * back over an unchanged original timestamp with sub-minute precision. */
export function scheduleDraftFromListing(item:AssignmentListing):ScheduleEditorDraft{
  const s=signedAssignmentSchedule(item)
  return {
    startsAt:localDatetime(s.startsAt),
    endsAt:s.endsAt===null?'':localDatetime(s.endsAt),
    blockBeforeStart:s.blockBeforeStart,blockAfterEnd:s.blockAfterEnd,
  }
}
function readDatetime(input:string,original:number|null):number|null{
  if(!input)return null
  if(original!==null&&localDatetime(original)===input)return original
  if(!/^\d{4}-\d\d-\d\dT\d\d:\d\d$/.test(input))
    throw Error('assignment.invalid_schedule_date')
  const date=new Date(input)
  const ms=date.getTime()
  if(!Number.isFinite(ms)||localDatetime(ms)!==input)
    throw Error('assignment.invalid_schedule_date')
  return ms
}
/** Keep signed, already-existing milliseconds when no time control changed. */
export function buildEditorSchedule(
  draft:ScheduleEditorDraft,baseline:AssignmentSchedule,
):AssignmentSchedule{
  const startsAt=readDatetime(draft.startsAt,baseline.startsAt)
  const endsAt=readDatetime(draft.endsAt,baseline.endsAt)
  if(startsAt===null)throw Error('assignment.schedule_start_required')
  const result={
    startsAt,endsAt,blockBeforeStart:draft.blockBeforeStart,
    blockAfterEnd:draft.blockAfterEnd,
  }
  if(!validAssignmentSchedule(result))
    throw Error('assignment.invalid_schedule')
  return result
}
