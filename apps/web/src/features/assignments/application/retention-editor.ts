import type {AssignmentListing,AssignmentRetention} from './assignment-outbox'
import {signedAssignmentRetention,validAssignmentRetention} from './assignment-outbox'

export type RetentionDraft={
  filesEnabled:boolean
  filesDate:string
  assignmentEnabled:boolean
  assignmentDate:string
}
function localDatetime(value:number):string{
  const d=new Date(value)
  const pad=(n:number)=>String(n).padStart(2,'0')
  return d.getFullYear()+'-'+pad(d.getMonth()+1)+'-'+pad(d.getDate())
    +'T'+pad(d.getHours())+':'+pad(d.getMinutes())
}
function parseLocal(raw:string,original:number|null):number{
  if(!/^\d{4}-\d\d-\d\dT\d\d:\d\d$/.test(raw))
    throw Error('assignment.retention_invalid_date')
  if(original!==null&&raw===localDatetime(original))return original
  const date=new Date(raw)
  const at=date.getTime()
  if(!Number.isFinite(at)||localDatetime(at)!==raw)
    throw Error('assignment.retention_invalid_date')
  return at
}
export function retentionDraftFromListing(item:AssignmentListing):RetentionDraft{
  const value=signedAssignmentRetention(item)
  return {
    filesEnabled:value.filesAccessUntil!==null,
    filesDate:value.filesAccessUntil===null?'':localDatetime(value.filesAccessUntil),
    assignmentEnabled:value.assignmentAccessUntil!==null,
    assignmentDate:value.assignmentAccessUntil===null
      ?'':localDatetime(value.assignmentAccessUntil),
  }
}
export function buildEditorRetention(
  draft:RetentionDraft,baseline:AssignmentRetention,
  scheduleEnd:number|null,now=Date.now(),
):AssignmentRetention{
  const filesAccessUntil=draft.filesEnabled
    ?parseLocal(draft.filesDate,baseline.filesAccessUntil):null
  const assignmentAccessUntil=draft.assignmentEnabled
    ?parseLocal(draft.assignmentDate,baseline.assignmentAccessUntil):null
  const value={
    filesAccessUntil,assignmentAccessUntil,deleteOriginals:false as const,
  }
  if(!validAssignmentRetention(value)
    ||[filesAccessUntil,assignmentAccessUntil].some(date=>
      date!==null&&(date<=now||(scheduleEnd!==null&&date<scheduleEnd))))
    throw Error('assignment.retention_invalid_deadline')
  return value
}
