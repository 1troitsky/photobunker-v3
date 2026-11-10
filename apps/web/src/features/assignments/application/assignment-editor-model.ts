import { signedAllowedAssignmentMedia, signedAdvancedRequirements,
  signedMediaRequirements, signedPolicyGoals, signedPolicyRequirements } from './assignment-outbox'
import type { AssignmentListing, AllowedAssignmentMedia } from './assignment-outbox'
import { parseRulesCsv } from '../domain/advanced-rules'

export type EditorDraft={
  photoGoal:string;videoGoal:string;audioGoal:string
  video:boolean;audio:boolean
  photoRequiredCategory:boolean;photoDescriptionMin:number;photoGps:boolean
  videoRequiredCategory:boolean;videoDescriptionMin:number;videoGps:boolean
  audioRequiredCategory:boolean;audioDescriptionMin:number;audioGps:boolean
  photoCategories:string;photoTags:string
  videoCategories:string;videoTags:string
  audioCategories:string;audioTags:string
}
export const blankEditorDraft=():EditorDraft=>({
  photoGoal:'',videoGoal:'',audioGoal:'',video:false,audio:false,
  photoRequiredCategory:false,photoDescriptionMin:0,photoGps:false,
  videoRequiredCategory:false,videoDescriptionMin:0,videoGps:false,
  audioRequiredCategory:false,audioDescriptionMin:0,audioGps:false,
  photoCategories:'',photoTags:'',videoCategories:'',videoTags:'',
  audioCategories:'',audioTags:'',
})
export function editorDraftFromListing(row:AssignmentListing):EditorDraft{
  const kinds=signedAllowedAssignmentMedia(row)
  const goals=signedPolicyGoals(row)
  const photo=signedPolicyRequirements(row)
  const video=signedMediaRequirements(row,'video')
  const audio=signedMediaRequirements(row,'audio')
  const pa=signedAdvancedRequirements(row,'photo')
  const va=signedAdvancedRequirements(row,'video')
  const aa=signedAdvancedRequirements(row,'audio')
  return {
    photoGoal:goals.photoGoal===null?'':String(goals.photoGoal),
    videoGoal:goals.videoGoal===null?'':String(goals.videoGoal),
    audioGoal:goals.audioGoal===null?'':String(goals.audioGoal),
    video:kinds.includes('video'),audio:kinds.includes('audio'),
    photoRequiredCategory:photo.requiredCategory,
    photoDescriptionMin:photo.descriptionMinLength,photoGps:photo.requiredGps,
    videoRequiredCategory:video.requiredCategory,
    videoDescriptionMin:video.descriptionMinLength,videoGps:video.requiredGps,
    audioRequiredCategory:audio.requiredCategory,
    audioDescriptionMin:audio.descriptionMinLength,audioGps:audio.requiredGps,
    photoCategories:pa.allowedCategories.join(', '),photoTags:pa.requiredTags.join(', '),
    videoCategories:va.allowedCategories.join(', '),videoTags:va.requiredTags.join(', '),
    audioCategories:aa.allowedCategories.join(', '),audioTags:aa.requiredTags.join(', '),
  }
}
function positiveGoal(value:string,max:number):number|null{
  if(value.trim()==='')return null
  const n=Number(value)
  if(!Number.isInteger(n)||n<1||n>max)throw Error('assignment.invalid_goal')
  return n
}
function minLength(value:number):number{
  const n=Number(value)
  if(!Number.isInteger(n)||n<0||n>4000)
    throw Error('assignment.invalid_capture_requirements')
  return n
}
function advanced(categories:string,tags:string):{
  allowedCategories:string[];requiredTags:string[]
}{
  return {
    allowedCategories:parseRulesCsv(categories,16,64),
    requiredTags:parseRulesCsv(tags,12,48),
  }
}
export function buildEditorPolicy(draft:EditorDraft):Parameters<typeof queueAssignmentPolicyChange>[1]{
  const allowedMedia:AllowedAssignmentMedia=['photo']
  if(draft.video)allowedMedia.push('video')
  if(draft.audio)allowedMedia.push('audio')
  return {
    photoGoal:positiveGoal(draft.photoGoal,9999),
    videoGoal:draft.video?positiveGoal(draft.videoGoal,999):null,
    audioGoal:draft.audio?positiveGoal(draft.audioGoal,999):null,
    allowedMedia,
    requiredCategory:draft.photoRequiredCategory,
    descriptionMinLength:minLength(draft.photoDescriptionMin),
    requiredGps:draft.photoGps,
    videoRequirements:{
      requiredCategory:draft.video&&draft.videoRequiredCategory,
      descriptionMinLength:draft.video?minLength(draft.videoDescriptionMin):0,
      requiredGps:draft.video&&draft.videoGps,
    },
    audioRequirements:{
      requiredCategory:draft.audio&&draft.audioRequiredCategory,
      descriptionMinLength:draft.audio?minLength(draft.audioDescriptionMin):0,
      requiredGps:draft.audio&&draft.audioGps,
    },
    photoAdvanced:advanced(draft.photoCategories,draft.photoTags),
    videoAdvanced:draft.video?advanced(draft.videoCategories,draft.videoTags)
      :{allowedCategories:[],requiredTags:[]},
    audioAdvanced:draft.audio?advanced(draft.audioCategories,draft.audioTags)
      :{allowedCategories:[],requiredTags:[]},
  }
}
