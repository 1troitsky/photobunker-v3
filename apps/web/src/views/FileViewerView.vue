<script setup lang="ts">
import {computed,nextTick,onMounted,onUnmounted,ref,watch} from 'vue'
import {onBeforeRouteLeave,RouterLink,useRoute,useRouter} from 'vue-router'
import {
  armBrowserReturn,discardBrowserReturnContext,
  peekOriginPager,noteViewerPosition,
} from '../features/browser/application/browser-return-context'
import {activeSession} from '../features/identity/application/session'
import {setViewerShellActions}
  from '../features/browser/application/viewer-shell-actions'
import {
  listLocalPhotos,listCloudPhotos,readLocalPhoto,readCloudPhoto,
  readLocalPhotoMetadata,readCloudPhotoMetadata,
} from '../features/photo-sync/application/p1-photo'
import type {StoredPhoto,CloudPhoto} from '../features/photo-sync/application/p1-photo'
import {
  listLocalMedia,listCloudMedia,readLocalMedia,readCloudMedia,
} from '../features/media/application/media-outbox'
import type {StoredMedia,CloudMedia} from '../features/media/application/media-outbox'
import {enqueueEncryptedMedia} from '../features/media/application/media-outbox'
import {registerSafeDerivativeCandidate} from '../features/media/application/safe-derivatives'
import {
  isPersonalMediaCopyChanged,mayCopyPersonalMediaSource,
  validatePersonalMediaCopy,
} from '../features/browser/application/personal-media-copy'
import type {PersonalMediaCopyDraft} from '../features/browser/application/personal-media-copy'
import {captureVideoStill,stillName} from '../features/browser/application/video-still'
import {audioClipName,makeWavClip} from '../features/browser/application/audio-wav'
import {cropFileName,cropPhoto} from '../features/browser/application/photo-crop'
import {choosePhotoAspect} from '../features/browser/application/photo-aspect-presets'
import type {PhotoAspectPreset} from '../features/browser/application/photo-aspect-presets'
import type {CropSelection,CroppedPhoto} from '../features/browser/application/photo-crop'
import type {PhotoAdjustments} from '../features/browser/application/photo-effects'
import {flattenPhotoAnnotations,MAX_TEXT_MARKS,validateTextMarks} from '../features/browser/application/photo-text'
import {MAX_SHAPE_MARKS} from '../features/browser/application/photo-shapes'
import type {PhotoShapeMark,ShapeKind} from '../features/browser/application/photo-shapes'
import {
  drawPhotoStrokes,MAX_PHOTO_STROKES,MAX_STROKE_POINTS,
  MAX_TOTAL_STROKE_POINTS,
} from '../features/browser/application/photo-strokes'
import type {PhotoStroke,StrokeTool,StrokePoint} from '../features/browser/application/photo-strokes'
import {MAX_PHOTO_BLACKOUTS} from '../features/browser/application/photo-blackouts'
import type {PhotoBlackout} from '../features/browser/application/photo-blackouts'
import {
  initialPhotoHistory,recordPhotoEdit,travelPhotoHistory,
  canPhotoUndo,canPhotoRedo,
} from '../features/browser/application/photo-history'
import type {PhotoEditHistory,PhotoEditSnapshot} from '../features/browser/application/photo-history'
import type {PhotoTextMark} from '../features/browser/application/photo-text'
import {
  photoInlinePoint,prepareInlineText,
} from '../features/browser/application/photo-inline-placement'
import type {WavClip} from '../features/browser/application/audio-wav'
import type {VideoStill} from '../features/browser/application/video-still'
import {buildCatalog} from '../features/browser/application/catalog'
import {appendAuthenticatedCatalogPage}
  from '../features/browser/application/authenticated-catalog-page'
import {findViewerTargetInBoundedIndex}
  from '../features/browser/application/viewer-index-target'
import type {CatalogItem,CatalogType} from '../features/browser/application/catalog'
import {
  adjacentFiles,parseViewerTarget,safeDownloadName,viewerKey,
} from '../features/browser/application/viewer-navigation'

type PrivateGPS={latitude:number;longitude:number;accuracyMeters:number}
type Preview={
  type:CatalogType;mime:string;name:string;description:string
  category:string;tags:string[];gps:PrivateGPS|null
  capturedAt:number|null;expiresAt:number|null;origin:'local'|'cloud'
}
const route=useRoute()
const router=useRouter()
const editorMode=computed(()=>route.name==='browser-editor')
const editorTab=ref<'info'|'media'|'review'>('media')
const editorBody=ref<HTMLElement|null>(null)
function selectEditorTab(tab:'info'|'media'|'review'):void{
  editorTab.value=tab
  nextTick(()=>{if(editorBody.value)editorBody.value.scrollTop=0})
}
const stage=ref<HTMLElement|null>(null)
const panel=ref<'info'|'editor'|null>(null)
const sheetClose=ref<HTMLButtonElement|null>(null)
let panelOpener:HTMLElement|null=null
async function openPanel(kind:'info'|'editor'):Promise<void>{
  if(!fileUrl.value||!preview.value)return
  if(kind==='editor'){
    if(!current.value)return
    editorTab.value='media'
    await router.push({name:'browser-editor',params:{
      protocol:current.value.protocol,id:current.value.id,
    }})
    return
  }
  panelOpener=document.activeElement instanceof HTMLElement
    ?document.activeElement:null
  panel.value=kind
  await nextTick()
  sheetClose.value?.focus()
}
function closePanel():void{
  if(editorMode.value){void cancelEditor();return}
  panel.value=null
  const previous=panelOpener
  panelOpener=null
  if(previous?.isConnected)void nextTick(()=>previous.focus())
}
function onSheetKeydown(event:KeyboardEvent):void{
  if(editorMode.value)return
  if(event.key==='Escape'){
    event.preventDefault();event.stopPropagation();closePanel();return
  }
  if(event.key!=='Tab')return
  const sheet=sheetClose.value?.closest('[role="dialog"]')
  if(!sheet)return
  const candidates=Array.from(sheet.querySelectorAll<HTMLElement>(
    'button:not(:disabled),a[href],input:not(:disabled),select:not(:disabled),textarea:not(:disabled),[tabindex="0"]',
  )).filter(element=>element.getClientRects().length>0)
  const first=candidates[0],last=candidates.at(-1)
  if(!first||!last)return
  if(event.shiftKey&&document.activeElement===first){
    event.preventDefault();last.focus()
  }else if(!event.shiftKey&&document.activeElement===last){
    event.preventDefault();first.focus()
  }
}
const photoElement=ref<HTMLImageElement|null>(null)
const cropLeft=ref(0),cropTop=ref(0),cropWidth=ref(100),cropHeight=ref(100)
const cropTurns=ref<CropSelection['turns']>(0)
const cropAspectPreset=ref<PhotoAspectPreset|'custom'>('original')
const photoBrightness=ref(100),photoContrast=ref(100),photoSaturation=ref(100)
const photoAdjustments=computed<PhotoAdjustments>(()=>({
  brightness:photoBrightness.value,contrast:photoContrast.value,
  saturation:photoSaturation.value,
}))
const cropSelection=computed<CropSelection>(()=>({
  left:cropLeft.value,top:cropTop.value,
  width:cropWidth.value,height:cropHeight.value,turns:cropTurns.value,
}))
const cropResult=ref<CroppedPhoto|null>(null)
const showBefore=ref(false)
const cropUrl=ref('')
const cropBusy=ref(false)
const cropError=ref('')
const cropNotice=ref('')
const cropSavedId=ref<string|null>(null)
const safeCandidateIntent=ref(false)
const safeSourceEligible=computed(()=>current.value?.protocol==='media'
  &&mediaLocal.value.some(row=>row.mediaId===current.value?.id
    &&row.mediaType==='photo'&&row.state==='synced'))
const photoComposition=ref<HTMLElement|null>(null)
const compositionWidth=ref(0)
let compositionObserver:ResizeObserver|null=null
const textMarks=ref<PhotoTextMark[]>([])
const photoBlackouts=ref<PhotoBlackout[]>([])
const selectedBlackoutId=ref<string|null>(null)
const selectedBlackout=computed(()=>photoBlackouts.value.find(
  item=>item.id===selectedBlackoutId.value)??null)
const strokeMarks=ref<PhotoStroke[]>([])
const draftStroke=ref<PhotoStroke|null>(null)
const paintCanvas=ref<HTMLCanvasElement|null>(null)
const activePaintTool=ref<StrokeTool|null>(null)
const paintColor=ref('#1ed760')
const paintWidth=ref(8)
const paintHistory=ref<PhotoEditHistory>(initialPhotoHistory())
const canUndoPhoto=computed(()=>canPhotoUndo(paintHistory.value))
const canRedoPhoto=computed(()=>canPhotoRedo(paintHistory.value))
let strokePointer:number|null=null
const shapeMarks=ref<PhotoShapeMark[]>([])
const selectedShapeId=ref<string|null>(null)
const selectedShape=computed(()=>shapeMarks.value.find(
  mark=>mark.id===selectedShapeId.value)??null)
let draggingShape:DragMark|null=null
let draggingBlackout:DragMark|null=null
const selectedTextId=ref<string|null>(null)
const inlinePhotoText=ref<PhotoTextMark|null>(null)
const inlineTextInput=ref<HTMLTextAreaElement|null>(null)
const inlineTextError=ref('')
const selectedText=computed(()=>textMarks.value.find(
  item=>item.id===selectedTextId.value)??null)
const composedPhotoUrl=ref('')
let composedPhotoBlob:Blob|null=null
let textRevision=0
type DragMark={
  id:string;pointerId:number;startX:number;startY:number
  originalX:number;originalY:number;width:number;height:number
}
let draggingMark:DragMark|null=null
let cropEpoch=0
const videoElement=ref<HTMLVideoElement|null>(null)
type VideoTrimRange={start:number;end:number}
const videoDuration=ref(0)
const videoTrimStart=ref(0)
const videoTrimEnd=ref(0)
const videoApplied=ref<VideoTrimRange|null>(null)
const videoTrimHistory=ref<VideoTrimRange[]>([])
const videoHistoryIndex=ref(0)
const videoPreviewActive=ref(false)
const videoTrimNotice=ref('')
const videoSelectedLength=computed(()=>Math.max(0,videoTrimEnd.value-videoTrimStart.value))
const videoRangeValid=computed(()=>videoDuration.value>0
  &&videoSelectedLength.value>=0.1
  &&videoTrimStart.value>=0&&videoTrimEnd.value<=videoDuration.value+0.01)
const audioElement=ref<HTMLAudioElement|null>(null)
const audioDuration=ref(0)
const trimStart=ref(0)
const trimEnd=ref(0)
const audioClip=ref<WavClip|null>(null)
const audioClipUrl=ref('')
const audioClipBusy=ref(false)
const audioClipError=ref('')
const audioClipNotice=ref('')
const audioClipSavedId=ref<string|null>(null)
let audioClipEpoch=0
const still=ref<VideoStill|null>(null)
const stillUrl=ref('')
const stillBusy=ref(false)
const stillError=ref('')
const stillNotice=ref('')
const stillSavedId=ref<string|null>(null)
let stillEpoch=0
const current=computed(()=>parseViewerTarget(route.params.protocol,route.params.id))
const photoLocal=ref<StoredPhoto[]>([])
const photoCloud=ref<CloudPhoto[]>([])
const mediaLocal=ref<StoredMedia[]>([])
const mediaCloud=ref<CloudMedia[]>([])
const photoCursor=ref<string|null>(null)
const mediaCursor=ref<string|null>(null)
const indexBusy=ref(false)
const indexIncomplete=ref(false)
const busy=ref(false)
const error=ref('')
const notice=ref('')
const fileUrl=ref('')
const fileBlob=ref<Blob|null>(null)
const preview=ref<Preview|null>(null)
const privateCopyDraft=ref<PersonalMediaCopyDraft>({
  name:'',description:'',category:'',tags:[],
})
const privateCopyBusy=ref(false)
const privateCopyError=ref('')
const privateCopySavedId=ref<string|null>(null)
const privateTagText=ref('')
const privateTagEditIndex=ref<number|null>(null)
const privateTagForm=ref(false)
function personalDraftFromPreview(source:Preview):PersonalMediaCopyDraft{
  return {name:source.name,description:source.description,
    category:source.category,tags:[...source.tags]}
}
function resetPrivateCopyDraft():void{
  privateCopyDraft.value=preview.value
    ?personalDraftFromPreview(preview.value)
    :{name:'',description:'',category:'',tags:[]}
  privateCopyBusy.value=false
  privateCopyError.value=''
  privateCopySavedId.value=null
  privateTagText.value=''
  privateTagEditIndex.value=null
  privateTagForm.value=false
}
const personalCopyEligible=computed(()=>{
  const target=current.value,source=preview.value
  if(!target||target.protocol!=='media'||!source||source.origin!=='local'
    ||!activeSession.value||!fileBlob.value||!fileUrl.value)return false
  return mediaLocal.value.some(row=>row.mediaId===target.id
    &&mayCopyPersonalMediaSource(row))
})
const privateCopyChanged=computed(()=>!!preview.value
  &&!privateCopySavedId.value
  &&isPersonalMediaCopyChanged(
    personalDraftFromPreview(preview.value),privateCopyDraft.value))
const privateCopyValidation=computed(()=>{
  if(!personalCopyEligible.value||!privateCopyChanged.value)return null
  try{
    return validatePersonalMediaCopy(
      preview.value!.name,privateCopyDraft.value)
  }catch{return null}
})
function openPrivateTagEditor(index:number|null):void{
  privateTagEditIndex.value=index
  privateTagText.value=index===null?'':(privateCopyDraft.value.tags[index]??'')
  privateTagForm.value=true
  privateCopyError.value=''
}
function closePrivateTagEditor():void{
  privateTagText.value=''
  privateTagForm.value=false
  privateTagEditIndex.value=null
}
function commitPrivateTag():void{
  if(!personalCopyEligible.value)return
  const index=privateTagEditIndex.value
  const next=[...privateCopyDraft.value.tags]
  if(index!==null&&index>=0&&index<next.length)
    next[index]=privateTagText.value.trim()
  else next.push(privateTagText.value.trim())
  try{
    const valid=validatePersonalMediaCopy(preview.value!.name,{
      ...privateCopyDraft.value,tags:next,
    })
    privateCopyDraft.value.tags=[...(valid.fields.tags??[])]
    closePrivateTagEditor()
  }catch{
    privateCopyError.value='Тег должен быть непустым, уникальным, до 48 байт. Максимум 12 тегов.'
  }
}
function removePrivateTag(index:number):void{
  if(!personalCopyEligible.value)return
  privateCopyDraft.value.tags=privateCopyDraft.value.tags.filter((_,i)=>i!==index)
  closePrivateTagEditor()
}
const files=computed(()=>buildCatalog(
  photoLocal.value,photoCloud.value,mediaLocal.value,mediaCloud.value,
))
const adjacent=computed(()=>{
  const identity=activeSession.value,target=current.value
  if(!target)return {previous:null,next:null,position:0,total:0}
  if(identity){
    const scoped=peekOriginPager(
      identity.accountId,identity.deviceId,viewerKey(target))
    if(scoped)return scoped
  }
  // Direct deep links with no known Browser origin retain the verified
  // bounded index navigation from V-38.
  return adjacentFiles(files.value,target)
})
let catalogEpoch=0
let fileEpoch=0
let touchStart:{x:number;y:number}|null=null

const croppedFileName=computed(()=>{
  if(!preview.value||!cropResult.value)return ''
  const base=cropFileName(preview.value.name,cropSelection.value,
    photoAdjustments.value)
  const layers=[
    textMarks.value.length?'text':'',
    shapeMarks.value.length?'shape':'',
    strokeMarks.value.length?'draw':'',
    photoBlackouts.value.length?'blackout':'',
  ].filter(Boolean).join('-')
  return layers?base.replace(/\.jpg$/,'-'+layers+'.jpg'):base
})
function clearComposition():void{
  if(composedPhotoUrl.value)URL.revokeObjectURL(composedPhotoUrl.value)
  composedPhotoUrl.value=''
  composedPhotoBlob=null
}
function invalidateTextOutput():void{
  ++textRevision
  clearComposition()
  cropSavedId.value=null
  cropNotice.value=''
  cropError.value=''
}
function currentPhotoEdits():PhotoEditSnapshot{
  return {
    text:textMarks.value,shapes:shapeMarks.value,strokes:strokeMarks.value,
    blackouts:photoBlackouts.value,
  }
}
function commitPhotoEdit():void{
  paintHistory.value=recordPhotoEdit(paintHistory.value,currentPhotoEdits())
}
function travelPhotoEdit(delta:-1|1):void{
  if(cropBusy.value||draftStroke.value||showBefore.value)return
  const next=travelPhotoHistory(paintHistory.value,delta)
  if(!next)return
  paintHistory.value=next.history
  textMarks.value=[...next.snapshot.text]
  shapeMarks.value=[...next.snapshot.shapes]
  strokeMarks.value=[...next.snapshot.strokes]
  photoBlackouts.value=[...next.snapshot.blackouts]
  if(!photoBlackouts.value.some(mark=>mark.id===selectedBlackoutId.value))
    selectedBlackoutId.value=null
  if(!textMarks.value.some(mark=>mark.id===selectedTextId.value))
    selectedTextId.value=null
  if(!shapeMarks.value.some(mark=>mark.id===selectedShapeId.value))
    selectedShapeId.value=null
  invalidateTextOutput()
}
function resetPhotoAnnotations():void{
  if(cropBusy.value||draftStroke.value||showBefore.value)return
  if(!textMarks.value.length&&!shapeMarks.value.length
    &&!strokeMarks.value.length&&!photoBlackouts.value.length)return
  textMarks.value=[]
  shapeMarks.value=[]
  strokeMarks.value=[]
  photoBlackouts.value=[]
  selectedBlackoutId.value=null
  selectedTextId.value=null
  selectedShapeId.value=null
  invalidateTextOutput()
  commitPhotoEdit()
}
function replaceBlackouts(marks:PhotoBlackout[]):void{
  if(cropBusy.value||showBefore.value)return
  photoBlackouts.value=marks
  invalidateTextOutput()
  if(!draggingBlackout)commitPhotoEdit()
}
function addPhotoBlackout():void{
  if(!cropResult.value||cropBusy.value||showBefore.value
    ||photoBlackouts.value.length>=MAX_PHOTO_BLACKOUTS)return
  const item:PhotoBlackout={
    id:crypto.randomUUID(),x:25,y:25,width:25,height:25,
  }
  replaceBlackouts([...photoBlackouts.value,item])
  selectedBlackoutId.value=item.id
}
function selectPhotoBlackout(id:string):void{
  if(cropBusy.value||showBefore.value)return
  selectedBlackoutId.value=id
  clearComposition()
}
function editPhotoBlackout(
  key:'x'|'y'|'width'|'height',event:Event,
):void{
  const item=selectedBlackout.value
  const value=Number((event.target as HTMLInputElement).value)
  if(!item||cropBusy.value||showBefore.value||!Number.isSafeInteger(value))return
  const max=key==='x'?100-item.width:key==='y'?100-item.height
    :key==='width'?100-item.x:100-item.y
  const min=key==='x'||key==='y'?0:5
  if(max<min)return
  replaceBlackouts(photoBlackouts.value.map(m=>m.id===item.id
    ?{...m,[key]:Math.max(min,Math.min(max,value))}:m))
}
function deletePhotoBlackout(id:string):void{
  if(cropBusy.value||showBefore.value)return
  replaceBlackouts(photoBlackouts.value.filter(item=>item.id!==id))
  if(selectedBlackoutId.value===id)selectedBlackoutId.value=null
}
function beginBlackoutDrag(event:PointerEvent,id:string):void{
  const composition=photoComposition.value
  const item=photoBlackouts.value.find(mark=>mark.id===id)
  if(!composition||!item||cropBusy.value||showBefore.value
    ||event.pointerType==='mouse'&&event.button!==0)return
  const rect=composition.getBoundingClientRect()
  if(rect.width<1||rect.height<1)return
  selectedBlackoutId.value=id
  clearComposition()
  draggingBlackout={
    id,pointerId:event.pointerId,startX:event.clientX,startY:event.clientY,
    originalX:item.x,originalY:item.y,width:rect.width,height:rect.height,
  }
  ;(event.currentTarget as HTMLElement).setPointerCapture(event.pointerId)
  event.preventDefault()
}
function moveBlackoutDrag(event:PointerEvent):void{
  const drag=draggingBlackout
  if(!drag||drag.pointerId!==event.pointerId||cropBusy.value||showBefore.value)
    return
  const item=photoBlackouts.value.find(mark=>mark.id===drag.id)
  if(!item)return
  const x=Math.max(0,Math.min(100-item.width,Math.round(
    drag.originalX+(event.clientX-drag.startX)/drag.width*100)))
  const y=Math.max(0,Math.min(100-item.height,Math.round(
    drag.originalY+(event.clientY-drag.startY)/drag.height*100)))
  if(x===item.x&&y===item.y)return
  replaceBlackouts(photoBlackouts.value.map(mark=>mark.id===drag.id
    ?{...mark,x,y}:mark))
}
function endBlackoutDrag(event:PointerEvent):void{
  if(draggingBlackout?.pointerId!==event.pointerId)return
  const element=event.currentTarget as HTMLElement
  if(element.hasPointerCapture(event.pointerId))
    element.releasePointerCapture(event.pointerId)
  draggingBlackout=null
  commitPhotoEdit()
}
function replaceTextMarks(updated:PhotoTextMark[]):void{
  if(cropBusy.value)return
  textMarks.value=updated
  invalidateTextOutput()
  if(!draggingMark)commitPhotoEdit()
}
function clearTextMarks():void{
  safeCandidateIntent.value=false
  ++textRevision
  textMarks.value=[]
  shapeMarks.value=[]
  strokeMarks.value=[]
  photoBlackouts.value=[]
  selectedBlackoutId.value=null
  draggingBlackout=null
  draftStroke.value=null
  strokePointer=null
  activePaintTool.value=null
  paintHistory.value=initialPhotoHistory()
  selectedTextId.value=null
  inlinePhotoText.value=null
  inlineTextError.value=''
  selectedShapeId.value=null
  draggingMark=null
  draggingShape=null
  clearComposition()
}
function replaceShapeMarks(marks:PhotoShapeMark[]):void{
  if(cropBusy.value)return
  shapeMarks.value=marks
  invalidateTextOutput()
  if(!draggingShape)commitPhotoEdit()
}
const shapeTypes:readonly {kind:ShapeKind;label:string;glyph:string}[]=[
  {kind:'arrow',label:'Стрелка',glyph:'↗'},
  {kind:'circle',label:'Круг',glyph:'○'},
  {kind:'square',label:'Квадрат',glyph:'□'},
  {kind:'triangle',label:'Треугольник',glyph:'△'},
  {kind:'star',label:'Звезда',glyph:'☆'},
]
function addPhotoShape(kind:ShapeKind='arrow'):void{
  if(!cropResult.value||cropBusy.value||showBefore.value
    ||shapeMarks.value.length>=MAX_SHAPE_MARKS)return
  const mark:PhotoShapeMark={
    id:crypto.randomUUID(),kind,x:20,y:25,width:35,height:25,
    stroke:'#1ed760',strokeWidth:6,fill:'#60a5fa',filled:false,
  }
  replaceShapeMarks([...shapeMarks.value,mark])
  selectedShapeId.value=mark.id
}
function choosePhotoShapeKind(kind:ShapeKind):void{
  if(cropBusy.value||showBefore.value||!cropResult.value)return
  if(selectedShape.value){
    editPhotoShape({kind})
    return
  }
  addPhotoShape(kind)
}
function selectPhotoShape(id:string):void{
  if(cropBusy.value)return
  selectedShapeId.value=id
  clearComposition()
}
function editPhotoShape(change:Partial<PhotoShapeMark>):void{
  if(!selectedShape.value||cropBusy.value)return
  const id=selectedShape.value.id
  replaceShapeMarks(shapeMarks.value.map(mark=>
    mark.id===id?{...mark,...change,id}:mark))
}
function deletePhotoShape(id:string):void{
  if(cropBusy.value)return
  replaceShapeMarks(shapeMarks.value.filter(mark=>mark.id!==id))
  if(selectedShapeId.value===id)selectedShapeId.value=null
}
function setShapeColor(field:'stroke'|'fill',event:Event):void{
  editPhotoShape({[field]:(event.target as HTMLInputElement).value})
}
function setShapeFilled(event:Event):void{
  editPhotoShape({filled:(event.target as HTMLInputElement).checked})
}
function setShapeStrokeWidth(event:Event):void{
  const value=Number((event.target as HTMLInputElement).value)
  if(Number.isSafeInteger(value)&&value>=1&&value<=28)
    editPhotoShape({strokeWidth:value})
}
function setShapeNumber(
  field:'x'|'y'|'width'|'height',event:Event,
):void{
  const mark=selectedShape.value
  const value=Number((event.target as HTMLInputElement).value)
  if(!mark||!Number.isSafeInteger(value))return
  const max=field==='x'?100-mark.width:field==='y'?100-mark.height:
    field==='width'?100-mark.x:100-mark.y
  const min=field==='x'||field==='y'?0:5
  if(max>=min)editPhotoShape({[field]:Math.max(min,Math.min(max,value))})
}
function startShapeDrag(event:PointerEvent,id:string):void{
  const composition=photoComposition.value
  const mark=shapeMarks.value.find(item=>item.id===id)
  if(!composition||!mark||cropBusy.value
    ||event.pointerType==='mouse'&&event.button!==0)return
  const rect=composition.getBoundingClientRect()
  if(rect.width<1||rect.height<1)return
  selectedShapeId.value=id
  clearComposition()
  draggingShape={
    id,pointerId:event.pointerId,startX:event.clientX,startY:event.clientY,
    originalX:mark.x,originalY:mark.y,width:rect.width,height:rect.height,
  }
  ;(event.currentTarget as Element).setPointerCapture(event.pointerId)
  event.preventDefault()
}
function moveShapeDrag(event:PointerEvent):void{
  const drag=draggingShape
  if(!drag||drag.pointerId!==event.pointerId||cropBusy.value)return
  const mark=shapeMarks.value.find(item=>item.id===drag.id)
  if(!mark)return
  const x=Math.max(0,Math.min(100-mark.width,Math.round(
    drag.originalX+(event.clientX-drag.startX)/drag.width*100)))
  const y=Math.max(0,Math.min(100-mark.height,Math.round(
    drag.originalY+(event.clientY-drag.startY)/drag.height*100)))
  if(x===mark.x&&y===mark.y)return
  replaceShapeMarks(shapeMarks.value.map(item=>
    item.id===drag.id?{...item,x,y}:item))
}
function endShapeDrag(event:PointerEvent):void{
  const drag=draggingShape
  if(drag?.pointerId!==event.pointerId)return
  const target=event.currentTarget as Element
  if(target.hasPointerCapture(event.pointerId))
    target.releasePointerCapture(event.pointerId)
  if(event.type==='pointercancel'){
    // Browser interruption must NOT turn a partial gesture into a saved
    // shape location or an Undo step. Restore before ending the drag.
    replaceShapeMarks(shapeMarks.value.map(mark=>mark.id===drag.id
      ?{...mark,x:drag.originalX,y:drag.originalY}:mark))
    draggingShape=null
    return
  }
  draggingShape=null
  commitPhotoEdit()
}
/** A tap on the actual visible image opens a VOLATILE text draft, not a mark.
 * No list item or exportable annotation exists until explicit completion. */
async function beginInlinePhotoTextAt(event:MouseEvent):Promise<void>{
  if(!cropResult.value||cropBusy.value||showBefore.value||activePaintTool.value
    ||textMarks.value.length>=MAX_TEXT_MARKS)return
  if(inlinePhotoText.value){
    commitInlinePhotoText()
    if(inlinePhotoText.value)return
  }
  const target=event.currentTarget
  if(!(target instanceof HTMLImageElement))return
  try{
    const {x,y}=photoInlinePoint(
      event.clientX,event.clientY,target.getBoundingClientRect())
    inlinePhotoText.value={
      id:crypto.randomUUID(),text:'',x,y,size:6,color:'#ffffff',
    }
    inlineTextError.value=''
    await nextTick()
    inlineTextInput.value?.focus()
  }catch(e){inlineTextError.value=explain(e)}
}
async function editInlinePhotoText(id:string):Promise<void>{
  if(!cropResult.value||cropBusy.value||showBefore.value||activePaintTool.value)
    return
  const mark=textMarks.value.find(item=>item.id===id)
  if(!mark)return
  if(inlinePhotoText.value?.id!==id&&inlinePhotoText.value){
    commitInlinePhotoText()
    if(inlinePhotoText.value)return
  }
  selectedTextId.value=id
  inlinePhotoText.value={...mark}
  inlineTextError.value=''
  await nextTick()
  inlineTextInput.value?.focus()
  inlineTextInput.value?.select()
}
function updateInlinePhotoText(event:Event):void{
  const draft=inlinePhotoText.value
  if(!draft)return
  inlinePhotoText.value={
    ...draft,text:(event.target as HTMLTextAreaElement).value,
  }
  inlineTextError.value=''
}
function cancelInlinePhotoText():void{
  inlinePhotoText.value=null
  inlineTextError.value=''
}
function commitInlinePhotoText():void{
  const draft=inlinePhotoText.value
  if(!draft||cropBusy.value)return
  try{
    const mark=prepareInlineText(draft)
    if(mark){
      const existing=textMarks.value.some(item=>item.id===mark.id)
      if(!existing&&textMarks.value.length>=MAX_TEXT_MARKS)
        throw Error('viewer.text_invalid_count')
      replaceTextMarks(existing
        ?textMarks.value.map(item=>item.id===mark.id?mark:item)
        :[...textMarks.value,mark])
      selectedTextId.value=mark.id
    }
    // Blank input creates no mark. Blank replacement preserves the old mark.
    cancelInlinePhotoText()
  }catch(e){
    inlineTextError.value=explain(e)
  }
}
function addPhotoText():void{
  if(!cropResult.value||cropBusy.value||textMarks.value.length>=MAX_TEXT_MARKS)return
  const mark:PhotoTextMark={
    id:crypto.randomUUID(),text:'Надпись',x:10,y:15,size:6,color:'#ffffff',
  }
  replaceTextMarks([...textMarks.value,mark])
  selectedTextId.value=mark.id
}
function selectPhotoText(id:string):void{
  if(cropBusy.value)return
  selectedTextId.value=id
  clearComposition()
}
function editPhotoText(change:Partial<PhotoTextMark>):void{
  if(!selectedText.value||cropBusy.value)return
  const id=selectedText.value.id
  replaceTextMarks(textMarks.value.map(mark=>
    mark.id===id?{...mark,...change,id}:mark))
}
function setTextValue(event:Event):void{
  editPhotoText({text:(event.target as HTMLTextAreaElement).value})
}
function setTextColor(event:Event):void{
  editPhotoText({color:(event.target as HTMLInputElement).value})
}
function setTextSize(event:Event):void{
  const value=Number((event.target as HTMLInputElement).value)
  if(Number.isSafeInteger(value)&&value>=2&&value<=12)
    editPhotoText({size:value})
}
function setTextCoordinate(axis:'x'|'y',event:Event):void{
  const value=Number((event.target as HTMLInputElement).value)
  if(Number.isSafeInteger(value))
    editPhotoText({[axis]:Math.max(0,Math.min(85,value))})
}
function deletePhotoText(id:string):void{
  if(cropBusy.value)return
  replaceTextMarks(textMarks.value.filter(mark=>mark.id!==id))
  if(selectedTextId.value===id)selectedTextId.value=null
}
function startPhotoTextDrag(event:PointerEvent,id:string):void{
  const composition=photoComposition.value
  const mark=textMarks.value.find(item=>item.id===id)
  if(!composition||!mark||cropBusy.value
    ||event.pointerType==='mouse'&&event.button!==0)return
  const rect=composition.getBoundingClientRect()
  if(rect.width<1||rect.height<1)return
  selectedTextId.value=id
  clearComposition()
  draggingMark={
    id,pointerId:event.pointerId,startX:event.clientX,startY:event.clientY,
    originalX:mark.x,originalY:mark.y,width:rect.width,height:rect.height,
  }
  ;(event.currentTarget as HTMLElement).setPointerCapture(event.pointerId)
  event.preventDefault()
}
function movePhotoTextDrag(event:PointerEvent):void{
  const drag=draggingMark
  if(!drag||drag.pointerId!==event.pointerId||cropBusy.value)return
  const x=Math.max(0,Math.min(85,Math.round(
    drag.originalX+(event.clientX-drag.startX)/drag.width*100)))
  const y=Math.max(0,Math.min(85,Math.round(
    drag.originalY+(event.clientY-drag.startY)/drag.height*100)))
  const mark=textMarks.value.find(item=>item.id===drag.id)
  if(!mark||mark.x===x&&mark.y===y)return
  replaceTextMarks(textMarks.value.map(item=>
    item.id===drag.id?{...item,x,y}:item))
}
function photoTextFont(mark:PhotoTextMark):string{
  const width=compositionWidth.value||cropResult.value?.width||200
  return Math.max(1,Math.round(width*mark.size/100))+'px'
}
function stopPhotoTextDrag(event:PointerEvent):void{
  if(draggingMark?.pointerId!==event.pointerId)return
  const element=event.currentTarget as HTMLElement
  if(element.hasPointerCapture(event.pointerId))
    element.releasePointerCapture(event.pointerId)
  draggingMark=null
  commitPhotoEdit()
}
function choosePhotoTool(tool:StrokeTool):void{
  if(cropBusy.value||!cropResult.value||showBefore.value)return
  if(composedPhotoUrl.value)invalidateTextOutput()
  activePaintTool.value=activePaintTool.value===tool?null:tool
}
function setPaintColor(event:Event):void{
  paintColor.value=(event.target as HTMLInputElement).value
}
function setPaintWidth(event:Event):void{
  const next=Number((event.target as HTMLInputElement).value)
  if(Number.isSafeInteger(next)&&next>=2&&next<=36)
    paintWidth.value=next
}
function strokePoint(event:PointerEvent,canvas:HTMLCanvasElement):StrokePoint|null{
  const rect=canvas.getBoundingClientRect()
  if(rect.width<1||rect.height<1)return null
  return {
    x:Math.max(0,Math.min(1000,Math.round(
      (event.clientX-rect.left)/rect.width*1000))),
    y:Math.max(0,Math.min(1000,Math.round(
      (event.clientY-rect.top)/rect.height*1000))),
  }
}
function beginPaintStroke(event:PointerEvent):void{
  const canvas=paintCanvas.value,tool=activePaintTool.value
  if(!canvas||!tool||!cropResult.value||cropBusy.value||showBefore.value
    ||draftStroke.value||strokeMarks.value.length>=MAX_PHOTO_STROKES
    ||event.pointerType==='mouse'&&event.button!==0)return
  if(tool==='eraser'&&!strokeMarks.value.length)return
  const total=strokeMarks.value.reduce((n,item)=>n+item.points.length,0)
  if(total>=MAX_TOTAL_STROKE_POINTS)return
  const point=strokePoint(event,canvas)
  if(!point)return
  strokePointer=event.pointerId
  draftStroke.value={
    id:crypto.randomUUID(),tool,color:paintColor.value,
    width:paintWidth.value,points:[point],
  }
  canvas.setPointerCapture(event.pointerId)
  event.preventDefault()
}
function updatePaintStroke(event:PointerEvent):void{
  const stroke=draftStroke.value,canvas=paintCanvas.value
  if(!stroke||!canvas||strokePointer!==event.pointerId
    ||cropBusy.value)return
  const point=strokePoint(event,canvas)
  const last=stroke.points[stroke.points.length-1]
  if(!point||last&&last.x===point.x&&last.y===point.y)return
  const total=strokeMarks.value.reduce((n,item)=>n+item.points.length,0)
  if(stroke.points.length>=MAX_STROKE_POINTS
    ||total+stroke.points.length>=MAX_TOTAL_STROKE_POINTS)return
  draftStroke.value={...stroke,points:[...stroke.points,point]}
}
function finishPaintStroke(event:PointerEvent,cancel=false):void{
  const canvas=paintCanvas.value,stroke=draftStroke.value
  if(strokePointer!==event.pointerId)return
  strokePointer=null
  if(canvas?.hasPointerCapture(event.pointerId))
    canvas.releasePointerCapture(event.pointerId)
  draftStroke.value=null
  if(cancel||!stroke||cropBusy.value)return
  strokeMarks.value=[...strokeMarks.value,stroke]
  invalidateTextOutput()
  commitPhotoEdit()
}
function renderPaintCanvas():void{
  const canvas=paintCanvas.value,result=cropResult.value
  if(!canvas||!result||composedPhotoUrl.value)return
  const scale=Math.min(1,900/result.width,900/result.height,
    (canvas.clientWidth||result.width)*(window.devicePixelRatio||1)/result.width)
  const width=Math.max(1,Math.round(result.width*scale))
  const height=Math.max(1,Math.round(result.height*scale))
  if(canvas.width!==width||canvas.height!==height){
    canvas.width=width;canvas.height=height
  }
  const ctx=canvas.getContext('2d')
  if(!ctx)return
  ctx.clearRect(0,0,width,height)
  const strokes=draftStroke.value
    ?[...strokeMarks.value,draftStroke.value]:strokeMarks.value
  if(strokes.length)drawPhotoStrokes(ctx,width,height,strokes)
}
function toggleBeforeAfter():void{
  if(!cropResult.value||cropBusy.value||strokePointer!==null)return
  showBefore.value=!showBefore.value
}
function clearCrop():void{
  showBefore.value=false
  clearComposition()
  ++cropEpoch
  if(cropUrl.value)URL.revokeObjectURL(cropUrl.value)
  cropUrl.value=''
  cropResult.value=null
  cropBusy.value=false
  cropError.value=''
  cropNotice.value=''
  cropSavedId.value=null
}
function applyPhotoAspect(preset:PhotoAspectPreset):void{
  const image=photoElement.value
  if(!image||!image.complete||!image.naturalWidth||!image.naturalHeight
    ||cropBusy.value||preview.value?.type!=='photo')return
  try{
    const next=choosePhotoAspect(
      image.naturalWidth,image.naturalHeight,cropSelection.value,preset)
    cropLeft.value=next.left;cropTop.value=next.top
    cropWidth.value=next.width;cropHeight.value=next.height
    cropAspectPreset.value=preset
  }catch(e){
    cropError.value=explain(e)
  }
}
function markCropCustom():void{cropAspectPreset.value='custom'}
function changePhotoRotation(next:CropSelection['turns']):void{
  if(cropBusy.value||preview.value?.type!=='photo')return
  cropTurns.value=next
  if(cropAspectPreset.value!=='custom'
    &&cropAspectPreset.value!=='original')
    applyPhotoAspect(cropAspectPreset.value)
}
function turnPhoto(delta:-1|1):void{
  const next=((cropTurns.value+delta+4)%4) as CropSelection['turns']
  changePhotoRotation(next)
}
function setCropTurns(event:Event):void{
  const next=Number((event.target as HTMLSelectElement).value)
  if(next===0||next===1||next===2||next===3)
    changePhotoRotation(next)
}
const audioClipFileName=computed(()=>{
  if(!preview.value||!audioClip.value)return ''
  return audioClipName(preview.value.name,
    audioClip.value.startMs,audioClip.value.endMs)
})
function clearAudioClip():void{
  ++audioClipEpoch
  if(audioClipUrl.value)URL.revokeObjectURL(audioClipUrl.value)
  audioClipUrl.value=''
  audioClip.value=null
  audioClipBusy.value=false
  audioClipError.value=''
  audioClipNotice.value=''
  audioClipSavedId.value=null
}
function onAudioMetadata():void{
  const duration=audioElement.value?.duration
  if(!duration||!Number.isFinite(duration)||duration<=0)return
  if(audioDuration.value>0){
    // A repeated metadata event must not reset a range the user has edited.
    audioDuration.value=duration
    return
  }
  audioDuration.value=duration
  trimStart.value=0
  trimEnd.value=Math.min(duration,60)
}
// Video Editor 1.1: in-memory edit decision list only. This never creates
// MP4 ciphertext, replaces the source asset or asserts a server ACK.
function onVideoMetadata():void{
  const video=videoElement.value
  if(!video||preview.value?.type!=='video'||!fileUrl.value)return
  let duration=video.duration
  if(!Number.isFinite(duration)||duration<=0){
    const range=video.seekable
    duration=range.length?range.end(range.length-1):0
  }
  if(!Number.isFinite(duration)||duration<=0)return
  if(!videoDuration.value){
    videoDuration.value=duration
    videoTrimStart.value=0
    videoTrimEnd.value=duration
    videoTrimHistory.value=[{start:0,end:duration}]
    videoHistoryIndex.value=0
  }else{
    // Duration changes from the same source may occur after progressive
    // decoding: preserve user-selected bounds instead of wiping the draft.
    videoDuration.value=duration
    videoTrimEnd.value=Math.min(videoTrimEnd.value,duration)
  }
}
function stopVideoPreview():void{
  videoPreviewActive.value=false
  videoElement.value?.pause()
}
function onVideoTimeUpdate():void{
  const video=videoElement.value
  if(!videoPreviewActive.value||!video)return
  if(video.currentTime+0.035>=videoTrimEnd.value){
    stopVideoPreview()
    videoTrimNotice.value='Предпросмотр фрагмента завершён. Оригинал не изменён.'
  }
}
async function previewVideoSelection():Promise<void>{
  const video=videoElement.value,origin=fileUrl.value
  if(!video||!videoRangeValid.value||!origin||video.currentSrc!==origin
    ||preview.value?.type!=='video')return
  stopVideoPreview()
  try{
    video.currentTime=videoTrimStart.value
    videoPreviewActive.value=true
    await video.play()
  }catch{
    videoPreviewActive.value=false
    videoTrimNotice.value='Воспроизведение выбранного диапазона недоступно в этом браузере.'
  }
}
function applyVideoSelection():void{
  if(!videoRangeValid.value||preview.value?.type!=='video')return
  stopVideoPreview()
  const range={start:videoTrimStart.value,end:videoTrimEnd.value}
  const history=videoTrimHistory.value.slice(0,videoHistoryIndex.value+1)
  history.push(range)
  videoTrimHistory.value=history.slice(-50)
  videoHistoryIndex.value=videoTrimHistory.value.length-1
  videoApplied.value={...range}
  videoTrimNotice.value='Границы применены только к локальному просмотру. MP4 не создан и оригинал не изменён.'
}
function travelVideoSelection(direction:-1|1):void{
  const next=videoHistoryIndex.value+direction
  if(next<0||next>=videoTrimHistory.value.length)return
  stopVideoPreview()
  videoHistoryIndex.value=next
  const range=videoTrimHistory.value[next]!
  videoTrimStart.value=range.start
  videoTrimEnd.value=range.end
  videoApplied.value=next===0?null:{...range}
  videoTrimNotice.value='Границы восстановлены из локальной истории. MP4 не создан.'
}
function resetVideoSelection():void{
  stopVideoPreview()
  if(videoDuration.value>0){
    videoTrimStart.value=0
    videoTrimEnd.value=videoDuration.value
    videoTrimHistory.value=[{start:0,end:videoDuration.value}]
    videoHistoryIndex.value=0
  }
  videoApplied.value=null
  videoTrimNotice.value='Выбрано исходное видео без обрезки. Оригинал не изменён.'
}
function clearVideoTrim():void{
  stopVideoPreview()
  videoDuration.value=0
  videoTrimStart.value=0;videoTrimEnd.value=0
  videoApplied.value=null
  videoTrimHistory.value=[]
  videoHistoryIndex.value=0
  videoTrimNotice.value=''
}
const stillFileName=computed(()=>{
  if(!preview.value||!still.value)return ''
  return stillName(preview.value.name,still.value.timeMs)
})
function clearStill():void{
  ++stillEpoch
  if(stillUrl.value)URL.revokeObjectURL(stillUrl.value)
  stillUrl.value=''
  still.value=null
  stillBusy.value=false
  stillError.value=''
  stillNotice.value=''
  stillSavedId.value=null
}
function clearBlob():void{
  panel.value=null
  panelOpener=null
  clearTextMarks()
  clearCrop()
  cropLeft.value=0;cropTop.value=0
  cropWidth.value=100;cropHeight.value=100;cropTurns.value=0
  cropAspectPreset.value='original'
  photoBrightness.value=100;photoContrast.value=100;photoSaturation.value=100
  clearStill()
  clearVideoTrim()
  clearAudioClip()
  audioDuration.value=0
  trimStart.value=0
  trimEnd.value=0
  ++fileEpoch
  if(fileUrl.value)URL.revokeObjectURL(fileUrl.value)
  fileUrl.value=''
  fileBlob.value=null
  preview.value=null
  resetPrivateCopyDraft()
  busy.value=false
}
function clearIndex():void{
  ++catalogEpoch
  photoLocal.value=[];photoCloud.value=[]
  mediaLocal.value=[];mediaCloud.value=[]
  photoCursor.value=null;mediaCursor.value=null
  indexIncomplete.value=false
}
function sameSession(session:typeof activeSession.value,epoch:number):boolean{
  const active=activeSession.value
  return !!session&&!!active&&epoch===fileEpoch
    &&active.accountId===session.accountId
    &&active.deviceId===session.deviceId
    &&active.device===session.device
    &&active.pkg===session.pkg
}
function explain(error:unknown):string{
  return error instanceof Error?error.message:'viewer.unavailable'
}
function offline():boolean{
  return typeof navigator!=='undefined'&&navigator.onLine===false
}
/** Index metadata is opaque. No file plaintext, filename or GPS is indexed. */
async function refreshIndex():Promise<void>{
  const session=activeSession.value
  // Preserve known-good local-first lists during a same-account refresh.
  // Identity changes explicitly clear all rows in the session watcher.
  ++catalogEpoch
  const epoch=catalogEpoch
  indexIncomplete.value=false
  if(!session){clearIndex();return}
  indexBusy.value=true
  try{
    const [photos,media]=await Promise.all([listLocalPhotos(),listLocalMedia()])
    if(session!==activeSession.value||epoch!==catalogEpoch)return
    photoLocal.value=photos;mediaLocal.value=media
    if(!session.online||offline())return
    const [p,m]=await Promise.allSettled([listCloudPhotos(),listCloudMedia()])
    if(session!==activeSession.value||epoch!==catalogEpoch)return
    // An ordinary server 50-row index is not trusted navigation authority:
    // reject forged cursors just like Browser's existing List / Load more.
    // Only the currently requested protocol may load additional opaque IDs,
    // bounded to 10 pages (500 records), never decrypted search metadata.
    const target=current.value
    const targetKey=target?viewerKey(target):null
    const relevant=()=>session===activeSession.value
      &&epoch===catalogEpoch
      &&(!targetKey||(current.value!==null
        &&targetKey===viewerKey(current.value)))
    let badPage=p.status==='rejected'||m.status==='rejected'
    if(p.status==='fulfilled'){
      try{
        const localTarget=target?.protocol==='photo'
          &&photos.some(row=>row.photoId===target.id)
        const checked=target?.protocol==='photo'&&!localTarget
          ?await findViewerTargetInBoundedIndex(
            p.value,target.id,after=>listCloudPhotos(after),
            row=>row.photoId,relevant)
          :appendAuthenticatedCatalogPage(
            [],p.value,null,row=>row.photoId)
        if(!relevant())return
        photoCloud.value=checked.items
        photoCursor.value=checked.nextCursor
        if('found' in checked&&!checked.found
          &&'complete' in checked&&checked.complete===false)
          indexIncomplete.value=true
      }catch(e){
        if(!relevant())return
        badPage=true
      }
    }
    if(m.status==='fulfilled'){
      try{
        const localTarget=target?.protocol==='media'
          &&media.some(row=>row.mediaId===target.id)
        const checked=target?.protocol==='media'&&!localTarget
          ?await findViewerTargetInBoundedIndex(
            m.value,target.id,after=>listCloudMedia(after),
            row=>row.mediaId,relevant)
          :appendAuthenticatedCatalogPage(
            [],m.value,null,row=>row.mediaId)
        if(!relevant())return
        mediaCloud.value=checked.items
        mediaCursor.value=checked.nextCursor
        if('found' in checked&&!checked.found
          &&'complete' in checked&&checked.complete===false)
          indexIncomplete.value=true
      }catch(e){
        if(!relevant())return
        badPage=true
      }
    }
    if(badPage)
      notice.value='Часть облачного каталога недоступна или курсор неверен. '
        +'Ранее проверенные файлы сохранены; повреждённые страницы не добавлены.'
  }catch(e){
    if(session===activeSession.value&&epoch===catalogEpoch)notice.value=explain(e)
  }finally{if(epoch===catalogEpoch)indexBusy.value=false}
}
async function loadMore():Promise<void>{
  const session=activeSession.value
  if(!session?.online||offline()||indexBusy.value
    ||(!photoCursor.value&&!mediaCursor.value))return
  const epoch=catalogEpoch
  const pc=photoCursor.value,mc=mediaCursor.value
  indexBusy.value=true
  const [p,m]=await Promise.allSettled([
    pc?listCloudPhotos(pc):Promise.resolve(null),
    mc?listCloudMedia(mc):Promise.resolve(null),
  ])
  if(session===activeSession.value&&epoch===catalogEpoch){
    let badPage=p.status==='rejected'||m.status==='rejected'
    if(p.status==='fulfilled'&&p.value){
      try{
        const checked=appendAuthenticatedCatalogPage(
          photoCloud.value,p.value,pc,row=>row.photoId)
        photoCloud.value=checked.items
        photoCursor.value=checked.nextCursor
      }catch{badPage=true}
    }
    if(m.status==='fulfilled'&&m.value){
      try{
        const checked=appendAuthenticatedCatalogPage(
          mediaCloud.value,m.value,mc,row=>row.mediaId)
        mediaCloud.value=checked.items
        mediaCursor.value=checked.nextCursor
      }catch{badPage=true}
    }
    if(badPage)
      notice.value='Неверная или недоступная страница облачного индекса. '
        +'Ранее проверенные файлы и курсоры сохранены.'
    indexBusy.value=false
  }
}
async function openFile():Promise<void>{
  clearBlob()
  error.value='';notice.value=''
  const session=activeSession.value,target=current.value
  if(!session||!target)return
  const epoch=++fileEpoch
  busy.value=true
  try{
    let blob:Blob
    let data:Preview
    let origin:'local'|'cloud'='local'
    if(target.protocol==='photo'){
      let metadata:Awaited<ReturnType<typeof readLocalPhotoMetadata>>
      try{
        [blob,metadata]=await Promise.all([
          readLocalPhoto(target.id),readLocalPhotoMetadata(target.id),
        ])
      }catch(e){
        // Missing local ciphertext may be fetched after authentication.
        // Integrity/authentication failures must NOT be concealed by fallback.
        if(!(e instanceof Error&&e.message==='photo.not_available'))throw e
        if(!session.online||offline())throw Error('viewer.only_cloud_offline')
        origin='cloud'
        ;[blob,metadata]=await Promise.all([
          readCloudPhoto(target.id),readCloudPhotoMetadata(target.id),
        ])
      }
      data={
        type:'photo',mime:'image/jpeg',name:target.id.slice(0,8)+'.jpg',
        description:metadata.description??'',category:metadata.category??'',
        tags:metadata.tags??[],gps:metadata.gps??null,
        capturedAt:metadata.capturedAt,
        expiresAt:files.value.find(x=>x.key===viewerKey(target))?.expiresAt??null,
        origin,
      }
    }else{
      let result:Awaited<ReturnType<typeof readLocalMedia>>
      try{result=await readLocalMedia(target.id)}
      catch(e){
        if(!(e instanceof Error&&e.message==='media.not_available'))throw e
        if(!session.online||offline())throw Error('viewer.only_cloud_offline')
        origin='cloud'
        result=await readCloudMedia(target.id)
      }
      blob=result.blob
      const m=result.metadata
      const type:CatalogType=m.mime.startsWith('image/')?'photo'
        :m.mime.startsWith('video/')?'video'
          :m.mime.startsWith('audio/')?'audio'
            :(()=>{throw Error('viewer.unsupported_media')})()
      data={
        type,mime:m.mime,name:m.fileName,
        description:m.description??'',category:m.category??'',
        tags:m.tags??[],gps:m.gps??null,
        capturedAt:m.createdAt,
        expiresAt:files.value.find(x=>x.key===viewerKey(target))?.expiresAt??null,
        origin,
      }
    }
    if(!sameSession(session,epoch)
      ||viewerKey(target)!==viewerKey(current.value??target)
      ||!current.value)return
    fileBlob.value=blob
    fileUrl.value=URL.createObjectURL(blob)
    preview.value=data
    resetPrivateCopyDraft()
  }catch(e){
    if(sameSession(session,epoch))error.value=explain(e)
  }finally{if(sameSession(session,epoch))busy.value=false}
}
async function navigate(item:CatalogItem|{source:'photo'|'media';id:string}|null):Promise<void>{
  if(!item||busy.value)return
  // Adjacent arrows, keyboard and swipe are one in-Viewer journey, not
  // separate browser-history pages. Back must return to the origin Browser.
  // File ACL/E2EE is rechecked on each target by the route watcher.
  await router.replace({
    name:'browser-viewer',params:{protocol:item.source,id:item.id},
  })
}
function onKeyDown(event:KeyboardEvent):void{
  if(event.defaultPrevented||event.altKey)return
  if(editorMode.value){
    if(event.key==='Escape'){event.preventDefault();void cancelEditor();return}
    // The editor uses arrow keys for range/brush movement, not pager history.
    if(!((event.ctrlKey||event.metaKey)&&event.key.toLowerCase()==='z'))
      return
  }
  if(panel.value){
    if(event.key==='Escape'){event.preventDefault();closePanel();return}
    // The editor remains a real editing surface: retain the existing
    // Ctrl/Cmd+Z history shortcut, but never navigate files behind a sheet.
    if(panel.value!=='editor'
      ||!((event.ctrlKey||event.metaKey)&&event.key.toLowerCase()==='z'))
      return
  }
  const editing=event.target instanceof HTMLElement&&!!event.target.closest(
    'input,textarea,select,video,audio,button,[contenteditable="true"]')
  if((event.ctrlKey||event.metaKey)&&event.key.toLowerCase()==='z'
    &&!editing&&cropResult.value){
    const direction=event.shiftKey?1:-1
    if(direction===-1?canUndoPhoto.value:canRedoPhoto.value){
      event.preventDefault()
      travelPhotoEdit(direction)
    }
    return
  }
  if(event.ctrlKey||event.metaKey||editing)return
  if(event.key==='ArrowLeft'&&adjacent.value.previous){
    event.preventDefault();void navigate(adjacent.value.previous)
  }else if(event.key==='ArrowRight'&&adjacent.value.next){
    event.preventDefault();void navigate(adjacent.value.next)
  }else if(event.key==='Escape'&&!document.fullscreenElement){
    event.preventDefault();void router.push('/browser')
  }
}
function onTouchStart(event:TouchEvent):void{
  if(preview.value?.type!=='photo'||event.touches.length!==1)return
  touchStart={x:event.touches[0]!.clientX,y:event.touches[0]!.clientY}
}
function onTouchEnd(event:TouchEvent):void{
  if(!touchStart||event.changedTouches.length!==1||preview.value?.type!=='photo')return
  const dx=event.changedTouches[0]!.clientX-touchStart.x
  const dy=event.changedTouches[0]!.clientY-touchStart.y
  touchStart=null
  if(Math.abs(dx)>75&&Math.abs(dx)>Math.abs(dy)*1.4)
    void navigate(dx>0?adjacent.value.previous:adjacent.value.next)
  else if(Math.abs(dy)>100&&Math.abs(dy)>Math.abs(dx)*1.4
    &&document.fullscreenElement)void document.exitFullscreen()
}
async function toggleFullscreen():Promise<void>{
  try{
    if(document.fullscreenElement)await document.exitFullscreen()
    else if(stage.value?.requestFullscreen)await stage.value.requestFullscreen()
    else notice.value='Полноэкранный режим не поддерживается браузером.'
  }catch{notice.value='Полноэкранный режим недоступен.'}
}
async function createCroppedPhoto():Promise<void>{
  const session=activeSession.value
  const img=photoElement.value,target=current.value
  const source=fileUrl.value,currentEpoch=fileEpoch
  if(!session||!img||!target||!source||cropBusy.value||showBefore.value
    ||preview.value?.type!=='photo')return
  const selection={...cropSelection.value}
  const adjustments={...photoAdjustments.value}
  clearCrop()
  const epoch=cropEpoch
  cropBusy.value=true
  try{
    if(img.currentSrc!==source)throw Error('viewer.crop_wrong_source')
    const result=await cropPhoto(img,selection,adjustments)
    if(!sameSession(session,currentEpoch)||epoch!==cropEpoch
      ||fileUrl.value!==source||!current.value
      ||viewerKey(current.value)!==viewerKey(target))return
    cropResult.value=result
    cropUrl.value=URL.createObjectURL(result.blob)
    cropNotice.value='JPEG подготовлен в памяти. Оригинал не изменён.'
  }catch(e){
    if(sameSession(session,currentEpoch)&&epoch===cropEpoch)
      cropError.value=explain(e)
  }finally{
    if(sameSession(session,currentEpoch)&&epoch===cropEpoch)
      cropBusy.value=false
  }
}
async function preparedCropWithText(
  source:Blob,marks:readonly PhotoTextMark[],
  shapes:readonly PhotoShapeMark[],
  strokes:readonly PhotoStroke[],
  blackouts:readonly PhotoBlackout[],
):Promise<Blob>{
  validateTextMarks(marks)
  if(!marks.length&&!shapes.length&&!strokes.length&&!blackouts.length)
    return source
  return (await flattenPhotoAnnotations(
    source,marks,shapes,strokes,blackouts)).blob
}
function setComposedCrop(blob:Blob):void{
  clearComposition()
  composedPhotoBlob=blob
  composedPhotoUrl.value=URL.createObjectURL(blob)
}
async function saveCroppedPhoto():Promise<void>{
  // A draft is deliberately not an exported mark yet. Require an explicit
  // finish to avoid silently saving an image without typed private text.
  if(inlinePhotoText.value){
    inlineTextError.value='Завершите ввод надписи перед сохранением JPEG.'
    return
  }
  const session=activeSession.value,result=cropResult.value
  const name=croppedFileName.value
  const epoch=cropEpoch,currentEpoch=fileEpoch
  const version=textRevision
  const marks=textMarks.value.map(mark=>({...mark}))
  const shapes=shapeMarks.value.map(shape=>({...shape}))
  const strokes=strokeMarks.value.map(stroke=>({...stroke,
    points:stroke.points.map(point=>({...point})),
  }))
  const blackouts=photoBlackouts.value.map(item=>({...item}))
  const markedCandidate=safeCandidateIntent.value&&blackouts.length>0
  const sourceMediaId=current.value?.protocol==='media'?current.value.id:null
  if(!session||!result||!name||cropBusy.value||showBefore.value
    ||preview.value?.type!=='photo'||cropSavedId.value)return
  cropBusy.value=true;cropError.value='';cropNotice.value=''
  try{
    const flattened=composedPhotoBlob??await preparedCropWithText(
      result.blob,marks,shapes,strokes,blackouts)
    if(!sameSession(session,currentEpoch)||epoch!==cropEpoch
      ||version!==textRevision)return
    const id=await enqueueEncryptedMedia(
      new File([flattened],name,{type:'image/jpeg'}))
    if(sameSession(session,currentEpoch)&&epoch===cropEpoch
      &&version===textRevision){
      if(marks.length||shapes.length||strokes.length||blackouts.length)
        setComposedCrop(flattened)
      cropSavedId.value=id
      cropNotice.value='Новая JPEG-копия зашифрована в очереди Browser. Облачная синхронизация подтверждается отдельно.'
      if(markedCandidate&&sourceMediaId){
        try{
          await registerSafeDerivativeCandidate(sourceMediaId,id)
          if(sameSession(session,currentEpoch)&&epoch===cropEpoch
            &&version===textRevision)
            cropNotice.value+=' Копия отмечена как кандидат Safe для адресной передачи после подтверждённой синхронизации.'
        }catch{
          if(sameSession(session,currentEpoch)&&epoch===cropEpoch
            &&version===textRevision)
            cropNotice.value+=' Связь Safe не зарегистрирована: источник должен быть доступен локально как MediaFile. Передача закрытой копии не разрешена.'
        }
      }
      void refreshIndex()
    }
  }catch(e){
    if(sameSession(session,currentEpoch)&&epoch===cropEpoch)
      cropError.value=explain(e)
  }finally{
    if(sameSession(session,currentEpoch)&&epoch===cropEpoch)
      cropBusy.value=false
  }
}
async function downloadCroppedPhoto():Promise<void>{
  const session=activeSession.value,result=cropResult.value
  const name=croppedFileName.value
  const epoch=cropEpoch,currentEpoch=fileEpoch,version=textRevision
  const marks=textMarks.value.map(mark=>({...mark}))
  const shapes=shapeMarks.value.map(shape=>({...shape}))
  const strokes=strokeMarks.value.map(stroke=>({...stroke,
    points:stroke.points.map(point=>({...point})),
  }))
  const blackouts=photoBlackouts.value.map(item=>({...item}))
  if(!session||!result||!cropUrl.value||!name||cropBusy.value
    ||showBefore.value||preview.value?.type!=='photo')return
  if(!window.confirm('Скачать JPEG-копию на устройство? Файл будет вне защищённого Browser и может появиться в системной галерее.'))return
  cropBusy.value=true;cropError.value=''
  try{
    const flattened=composedPhotoBlob??await preparedCropWithText(
      result.blob,marks,shapes,strokes,blackouts)
    if(!sameSession(session,currentEpoch)||epoch!==cropEpoch
      ||version!==textRevision)return
    if((marks.length||shapes.length||strokes.length||blackouts.length)
      &&!composedPhotoUrl.value)
      setComposedCrop(flattened)
    const anchor=document.createElement('a')
    anchor.href=marks.length||shapes.length||strokes.length||blackouts.length
      ?composedPhotoUrl.value:cropUrl.value
    anchor.download=name
    anchor.rel='noopener'
    document.body.appendChild(anchor)
    anchor.click()
    anchor.remove()
  }catch(e){
    if(sameSession(session,currentEpoch)&&epoch===cropEpoch
      &&version===textRevision)cropError.value=explain(e)
  }finally{
    if(sameSession(session,currentEpoch)&&epoch===cropEpoch)
      cropBusy.value=false
  }
}
async function makeAudioFragment():Promise<void>{
  const session=activeSession.value
  const target=current.value
  const source=fileBlob.value,origin=fileUrl.value
  const currentEpoch=fileEpoch
  if(!session||!target||!source||!origin||audioClipBusy.value
    ||preview.value?.type!=='audio'||audioDuration.value<=0)return
  clearAudioClip()
  const epoch=audioClipEpoch
  audioClipBusy.value=true
  try{
    if(audioElement.value?.currentSrc!==origin)
      throw Error('viewer.audio_wrong_source')
    const fragment=await makeWavClip(source,trimStart.value,trimEnd.value)
    if(!sameSession(session,currentEpoch)||epoch!==audioClipEpoch
      ||fileUrl.value!==origin||!current.value
      ||viewerKey(current.value)!==viewerKey(target))return
    audioClip.value=fragment
    audioClipUrl.value=URL.createObjectURL(fragment.blob)
    audioClipNotice.value='WAV-фрагмент подготовлен локально. Он ещё не сохранён.'
  }catch(e){
    if(sameSession(session,currentEpoch)&&epoch===audioClipEpoch)
      audioClipError.value=explain(e)
  }finally{
    if(sameSession(session,currentEpoch)&&epoch===audioClipEpoch)
      audioClipBusy.value=false
  }
}
async function saveAudioFragment():Promise<void>{
  const session=activeSession.value,fragment=audioClip.value
  const name=audioClipFileName.value
  const epoch=audioClipEpoch,currentEpoch=fileEpoch
  if(!session||!fragment||!name||audioClipBusy.value
    ||preview.value?.type!=='audio')return
  audioClipBusy.value=true
  audioClipError.value='';audioClipNotice.value=''
  try{
    // A new independently encrypted personal file, never an unauthorized
    // version replacement and never inherited sharing/assignment/GPS.
    const id=await enqueueEncryptedMedia(
      new File([fragment.blob],name,{type:'audio/wav'}))
    if(sameSession(session,currentEpoch)&&epoch===audioClipEpoch){
      audioClipSavedId.value=id
      audioClipNotice.value='WAV зашифрован в локальной очереди Browser. Статус облака проверяется отдельно.'
      void refreshIndex()
    }
  }catch(e){
    if(sameSession(session,currentEpoch)&&epoch===audioClipEpoch)
      audioClipError.value=explain(e)
  }finally{
    if(sameSession(session,currentEpoch)&&epoch===audioClipEpoch)
      audioClipBusy.value=false
  }
}
function downloadAudioFragment():void{
  if(!activeSession.value||!audioClip.value||!audioClipUrl.value
    ||!audioClipFileName.value||audioClipBusy.value
    ||preview.value?.type!=='audio')return
  if(!window.confirm('Скачать WAV-фрагмент на устройство? Незашифрованная копия окажется вне защищённого Browser.'))return
  const anchor=document.createElement('a')
  anchor.href=audioClipUrl.value
  anchor.download=audioClipFileName.value
  anchor.rel='noopener'
  document.body.appendChild(anchor)
  anchor.click()
  anchor.remove()
}
async function createStill():Promise<void>{
  const session=activeSession.value
  const video=videoElement.value
  const target=current.value
  const url=fileUrl.value
  const currentEpoch=fileEpoch
  if(!session||!video||!target||preview.value?.type!=='video'||!url
    ||stillBusy.value)return
  clearStill()
  const epoch=stillEpoch
  stillBusy.value=true
  try{
    // Never draw the frame from a different file or account, and never use
    // a remote media URL. The video source is the verified local Blob URL.
    if(video.currentSrc!==url)throw Error('viewer.frame_wrong_source')
    const captured=await captureVideoStill(video)
    if(!sameSession(session,currentEpoch)||epoch!==stillEpoch
      ||fileUrl.value!==url||!current.value
      ||viewerKey(current.value)!==viewerKey(target))return
    still.value=captured
    stillUrl.value=URL.createObjectURL(captured.blob)
    stillNotice.value='JPEG создан локально. Он не сохранён на устройство или в облако.'
  }catch(e){
    if(sameSession(session,currentEpoch)&&epoch===stillEpoch)
      stillError.value=explain(e)
  }finally{
    if(sameSession(session,currentEpoch)&&epoch===stillEpoch)
      stillBusy.value=false
  }
}
async function saveStillToBrowser():Promise<void>{
  const session=activeSession.value
  const asset=still.value
  const name=stillFileName.value
  const originalEpoch=fileEpoch,epoch=stillEpoch
  if(!session||!asset||!name||stillBusy.value||preview.value?.type!=='video')
    return
  stillBusy.value=true
  stillError.value='';stillNotice.value=''
  try{
    // A separate personal E2EE photo. Never inherit source file grants,
    // assignment provenance, GPS or retention by implication.
    const id=await enqueueEncryptedMedia(
      new File([asset.blob],name,{type:'image/jpeg'}))
    if(sameSession(session,originalEpoch)&&epoch===stillEpoch){
      stillSavedId.value=id
      stillNotice.value='Стоп-кадр зашифрован и сохранён в локальной очереди Browser. Подтверждение облачной синхронизации отдельно.'
      // Makes newly encrypted media visible to the adjacent-file index.
      void refreshIndex()
    }
  }catch(e){
    if(sameSession(session,originalEpoch)&&epoch===stillEpoch)
      stillError.value=explain(e)
  }finally{
    if(sameSession(session,originalEpoch)&&epoch===stillEpoch)
      stillBusy.value=false
  }
}
function downloadStill():void{
  if(!activeSession.value||!still.value||!stillUrl.value||!stillFileName.value
    ||stillBusy.value||preview.value?.type!=='video')return
  if(!window.confirm('Скачать JPEG-стоп-кадр на устройство? Он окажется вне зашифрованного Browser и может попасть в системные файлы/галерею.'))return
  const anchor=document.createElement('a')
  anchor.href=stillUrl.value
  anchor.download=stillFileName.value
  anchor.rel='noopener'
  document.body.appendChild(anchor)
  anchor.click()
  anchor.remove()
}
function download():void{
  if(!fileBlob.value||!fileUrl.value||!preview.value||!activeSession.value)return
  if(!window.confirm('Скачать расшифрованный файл на устройство? Он станет доступен за пределами защищённого хранилища PB3.'))return
  const anchor=document.createElement('a')
  anchor.href=fileUrl.value
  anchor.download=safeDownloadName(preview.value.name,'file')
  anchor.rel='noopener'
  document.body.appendChild(anchor)
  anchor.click()
  anchor.remove()
}
// This is not an in-place metadata revision. Copying private metadata is
// an explicit new AES-GCM MediaFile, reauthenticated against a LOCAL personal
// source at commit time. No assignment capture, GPS, ACL or TTL inheritance.
async function savePersonalMetadataCopy():Promise<void>{
  const session=activeSession.value,target=current.value,source=preview.value
  const epoch=fileEpoch,checked=privateCopyValidation.value
  if(!session||!target||target.protocol!=='media'||!source||!checked
    ||!editorMode.value||!personalCopyEligible.value||privateCopyBusy.value)
    return
  if(!window.confirm(
    'Создать отдельную личную зашифрованную копию с новыми данными? '
    +'Оригинал, права задания, GPS и срок хранения не изменятся и не наследуются. '
    +'Копия будет иметь собственный срок хранения и ключ шифрования.'
  ))return
  privateCopyBusy.value=true;privateCopyError.value=''
  try{
    const rows=await listLocalMedia()
    if(!sameSession(session,epoch)||!editorMode.value||!current.value
      ||current.value.id!==target.id)return
    const eligible=rows.find(row=>row.mediaId===target.id
      &&mayCopyPersonalMediaSource(row))
    if(!eligible)throw Error('copy.source_not_personal')
    // Re-read/decrypt the source with its original owner key. An arbitrary
    // Viewer blob URL is not an authorization to clone other people's files.
    const original=await readLocalMedia(target.id)
    if(!sameSession(session,epoch)||!editorMode.value||!current.value
      ||current.value.id!==target.id)return
    if(original.metadata.fileName!==source.name
      ||original.metadata.mime!==source.mime
      ||original.blob.size!==eligible.plainBytes)
      throw Error('copy.source_changed')
    const id=await enqueueEncryptedMedia(
      new File([original.blob],checked.name,{type:original.metadata.mime}),
      undefined,checked.fields,
    )
    if(!sameSession(session,epoch)||!editorMode.value||!current.value
      ||current.value.id!==target.id)return
    privateCopySavedId.value=id
    notice.value='Личная копия зашифрована в локальной очереди Browser. '
      +'Исходный файл не изменён. Подтверждение облака отдельно.'
    void refreshIndex()
    await returnFromEditor()
  }catch(e){
    if(sameSession(session,epoch)&&editorMode.value)
      privateCopyError.value=explain(e)
  }finally{
    if(sameSession(session,epoch))privateCopyBusy.value=false
  }
}
const editorMediaUnsaved=computed(()=>{
  if(!editorMode.value||!preview.value)return false
  if(preview.value.type==='photo'){
    if(inlinePhotoText.value?.text.trim())return true
    if(cropSavedId.value)return false
    return !!cropResult.value||!!cropBusy.value||cropLeft.value!==0
      ||cropTop.value!==0||cropWidth.value!==100||cropHeight.value!==100
      ||cropTurns.value!==0||photoBrightness.value!==100
      ||photoContrast.value!==100||photoSaturation.value!==100
      ||textMarks.value.length>0||shapeMarks.value.length>0
      ||strokeMarks.value.length>0||photoBlackouts.value.length>0
  }
  if(preview.value.type==='audio')
    return !audioClipSavedId.value&&(
      !!audioClip.value||audioClipBusy.value||trimStart.value!==0
      ||(audioDuration.value>0
        &&Math.abs(trimEnd.value-Math.min(audioDuration.value,60))>0.051))
  return (!stillSavedId.value&&(!!still.value||stillBusy.value))
    ||!!videoApplied.value
    ||(videoDuration.value>0&&(videoTrimStart.value>0.001
      ||Math.abs(videoTrimEnd.value-videoDuration.value)>0.051))
})
// Never silently lose an edited metadata tab or save one half of a mixed
// draft. Separate derivative save and metadata-copy save are intentional
// independent operations, NOT one transactional in-place revision.
const editorReady=computed(()=>{
  if(!editorMode.value||!activeSession.value||!fileUrl.value||!preview.value
    ||busy.value||privateCopyBusy.value||privateTagForm.value
    ||!!inlinePhotoText.value)return false
  if(editorTab.value==='review')return false
  if(editorTab.value==='info')
    return !!privateCopyValidation.value&&!editorMediaUnsaved.value
  if(privateCopyChanged.value)return false
  if(preview.value.type==='photo')
    return !!cropResult.value&&!cropBusy.value&&!showBefore.value
      &&!cropSavedId.value
  if(preview.value.type==='audio')
    return !!audioClip.value&&!audioClipBusy.value&&!audioClipSavedId.value
  return !!still.value&&!stillBusy.value&&!stillSavedId.value
})
const editorUnsaved=computed(()=>editorMode.value
  &&(privateCopyChanged.value||editorMediaUnsaved.value
    ||!!inlinePhotoText.value?.text.trim()
    ||(privateTagForm.value&&privateTagText.value.trim().length>0)))
function resetEditorDraft():void{
  clearTextMarks()
  clearCrop()
  cropLeft.value=0;cropTop.value=0
  cropWidth.value=100;cropHeight.value=100;cropTurns.value=0
  cropAspectPreset.value='original'
  photoBrightness.value=100;photoContrast.value=100;photoSaturation.value=100
  clearAudioClip()
  trimStart.value=0
  trimEnd.value=Math.min(audioDuration.value,60)
  clearStill()
  clearVideoTrim()
  resetPrivateCopyDraft()
}
function editorViewerPath():string|null{
  const target=current.value
  return target?'/browser/file/'+target.protocol+'/'+target.id:null
}
async function returnFromEditor():Promise<void>{
  const path=editorViewerPath()
  if(!path)return
  // Editor is normally pushed from Viewer. Pop that one editor entry so
  // the next native Back goes straight to Browser, not a duplicate Viewer.
  if(window.history.state?.back===path)await router.back()
  else await router.replace(path) // validated direct editor deep link/reload
}
async function cancelEditor():Promise<void>{
  if(!editorMode.value)return
  await returnFromEditor()
}
async function saveEditor():Promise<void>{
  if(!editorReady.value||!editorMode.value||!preview.value||!current.value)return
  if(editorTab.value==='info'){await savePersonalMetadataCopy();return}
  const before=viewerKey(current.value)
  const kind=preview.value.type
  if(kind==='photo')await saveCroppedPhoto()
  else if(kind==='audio')await saveAudioFragment()
  else await saveStillToBrowser()
  if(!activeSession.value||!editorMode.value||!current.value
    ||viewerKey(current.value)!==before)return
  const success=kind==='photo'?!!cropSavedId.value
    :kind==='audio'?!!audioClipSavedId.value:!!stillSavedId.value
  if(success){
    notice.value='Производный файл зашифрован в локальной очереди Browser. Подтверждение облака отдельно.'
    await returnFromEditor()
  }
}
watch([paintCanvas,strokeMarks,draftStroke,cropResult,compositionWidth],()=>{
  renderPaintCanvas()
},{flush:'post'})
watch(photoComposition,element=>{
  compositionObserver?.disconnect()
  compositionObserver=null
  compositionWidth.value=0
  if(!element||typeof ResizeObserver==='undefined')return
  compositionWidth.value=element.getBoundingClientRect().width
  compositionObserver=new ResizeObserver(entries=>{
    compositionWidth.value=entries[0]?.contentRect.width??0
  })
  compositionObserver.observe(element)
})
watch([cropLeft,cropTop,cropWidth,cropHeight,cropTurns,
  photoBrightness,photoContrast,photoSaturation],()=>{
  clearTextMarks()
  clearCrop()
})
watch([trimStart,trimEnd],()=>{clearAudioClip()})
watch([videoTrimStart,videoTrimEnd],()=>{
  if(videoPreviewActive.value)stopVideoPreview()
})
// The shared Shell exposes only a callable action. All media content,
// filenames and permissions remain inside FileViewerView. The callback
// is cleared on lock, route change and unmount.
watch([fileUrl,preview,activeSession,editorMode,editorReady],()=>{
  if(editorMode.value){
    setViewerShellActions({download,editor:{
      cancel:()=>{void cancelEditor()},
      save:()=>{void saveEditor()},
      canSave:editorReady.value,
    }})
  }else{
    setViewerShellActions(activeSession.value&&fileUrl.value&&preview.value
      ?{download}:null)
  }
},{immediate:true})
watch(editorMode,opened=>{
  panel.value=null
  editorTab.value='media'
  if(opened)resetPrivateCopyDraft()
})
watch(activeSession,(next,previous)=>{
  // A CSRF/session reauthentication may replace Session with a new object
  // containing the SAME key package and physical device. Never erase a
  // user's current trim bounds or volatile preview just for online status.
  // A new key package/device/account is a REAL trust boundary: wipe.
  if(next&&previous
    &&next.accountId===previous.accountId
    &&next.deviceId===previous.deviceId
    &&next.pkg===previous.pkg
    &&next.device===previous.device){
    void refreshIndex()
    // Bootstrap deliberately exposes cached, offline-only state before the
    // signed device proof completes. A cloud-only deep link attempted during
    // that window needs a retry after online proof, not a permanent offline
    // error. Never restart an already opened preview/unsaved editor work.
    if(!previous.online&&next.online&&!fileUrl.value)
      void openFile()
    return
  }
  clearBlob();clearIndex()
  void refreshIndex()
  void openFile()
},{immediate:true})
watch([()=>route.params.protocol,()=>route.params.id],()=>{
  const identity=activeSession.value,target=current.value
  if(identity&&target)
    noteViewerPosition(identity.accountId,identity.deviceId,viewerKey(target))
  void openFile()
  // A deep link from Browser may point beyond Viewer's initial 50 rows.
  // Rebuild only when the new opaque ID is not in the loaded index.
  if(current.value&&!files.value.some(row=>row.key===viewerKey(current.value!)))
    void refreshIndex()
})
// Browser history Back, the shell dock and the explicit breadcrumb all
// converge here. Never put a private search term or folder path into a URL.
onBeforeRouteLeave((to)=>{
  if(editorMode.value&&privateCopyBusy.value&&!privateCopySavedId.value)
    return false
  if(editorMode.value&&editorUnsaved.value){
    if(!window.confirm('Отменить несохранённые изменения файла? Исходный файл останется без изменений.'))
      return false
    resetEditorDraft()
  }
  if(to.path==='/browser'){
    const identity=activeSession.value
    if(identity)armBrowserReturn(identity.accountId,identity.deviceId)
    else discardBrowserReturnContext()
  }else if(to.name!=='browser-viewer'&&to.name!=='browser-editor')
    discardBrowserReturnContext()
})
onMounted(()=>window.addEventListener('keydown',onKeyDown))
onUnmounted(()=>{
  setViewerShellActions(null)
  compositionObserver?.disconnect()
  window.removeEventListener('keydown',onKeyDown)
  clearBlob();clearIndex()
})
</script>

<template>
  <section class="foundation-content file-viewer"
    :class="{'file-viewer-editor-route':editorMode}"
    data-testid="file-viewer">

    <div v-if="!activeSession" class="foundation-card">
      <p>Для просмотра зашифрованных файлов необходим вход.</p>
      <RouterLink to="/settings">Открыть доступ</RouterLink>
    </div>
    <div v-else-if="!current" role="alert" class="error-text">
      Некорректный адрес файла.
    </div>
    <template v-else>
      <div class="file-viewer-fixed" data-testid="file-viewer-fixed">
        <nav class="file-viewer-path browser-breadcrumb"
          data-testid="file-viewer-path" aria-label="Путь Browser">
          <RouterLink to="/browser" class="file-viewer-back" aria-label="В Browser">‹</RouterLink>
          <span class="file-viewer-path-name">Browser / {{ preview?.name??'Файл' }}</span>
        </nav>
      <div ref="stage" class="file-viewer-stage"
        data-testid="file-viewer-stage"
        @touchstart.passive="onTouchStart" @touchend.passive="onTouchEnd">
        <div v-if="busy" role="status" class="file-viewer-wait">Открываем защищённый файл…</div>
        <img v-else-if="!editorMode&&fileUrl&&preview?.type==='photo'" ref="photoElement"
          :src="fileUrl" :alt="preview?.name??'Фото'" draggable="false"
          data-testid="file-viewer-image">
        <video v-else-if="!editorMode&&fileUrl&&preview?.type==='video'" :key="fileUrl"
          ref="videoElement" :src="fileUrl" controls playsinline preload="metadata"
          data-testid="file-viewer-video"/>
        <div v-else-if="!editorMode&&fileUrl&&preview?.type==='audio'" class="file-viewer-audio">
          <span aria-hidden="true">♫</span>
          <audio :key="fileUrl" ref="audioElement" :src="fileUrl"
            controls preload="metadata" @loadedmetadata="onAudioMetadata"
            data-testid="file-viewer-audio"/>
        </div>
        <p v-else class="muted">Файл не открыт.</p>
        <button type="button" class="file-viewer-stage-fullscreen"
          aria-label="На весь экран" :disabled="!fileUrl" @click="toggleFullscreen">⛶</button>
      </div>
      <section class="file-viewer-summary" data-testid="file-viewer-summary">
        <div class="file-viewer-summary-name">{{ preview?.name??'Защищённый файл' }}</div>
        <div class="file-viewer-summary-id">ID: {{ current.id.slice(0,8) }}</div>
        <p class="file-viewer-summary-description">{{ preview?.description||'Описание не добавлено' }}</p>
        <div class="file-viewer-summary-dates">
          <span>Создан: {{ preview?.capturedAt
            ?new Date(preview.capturedAt).toLocaleDateString('ru-RU'):'—' }}</span>
          <span>Удаление: {{ preview?.expiresAt
            ?new Date(preview.expiresAt).toLocaleDateString('ru-RU'):'—' }}</span>
        </div>
      </section>
      <nav class="file-viewer-actions" aria-label="Действия с файлом"
        data-testid="file-viewer-actions">
        <button type="button" :disabled="!fileUrl" data-testid="viewer-action-info"
          @click="openPanel('info')">Информация</button>
        <button type="button" disabled
          title="Публичный предпросмотр требует отдельной проверки Safe-версии и прав доступа">
          Публичная карточка</button>
        <button type="button" :disabled="!fileUrl" data-testid="viewer-action-edit"
          @click="openPanel('editor')">Редактировать</button>
      </nav>
      <div class="file-viewer-navigation">
        <button type="button" aria-label="Предыдущий файл"
          :disabled="!adjacent.previous||busy"
          @click="navigate(adjacent.previous)">‹</button>
        <span class="muted" data-testid="file-viewer-position">
          {{ adjacent.position?adjacent.position+' / '+adjacent.total:
            'Вне загруженного списка' }}
        </span>
        <button type="button" aria-label="Следующий файл"
          :disabled="!adjacent.next||busy"
          @click="navigate(adjacent.next)">›</button>
      </div>
      </div>
      <div v-show="panel!==null||editorMode" class="file-viewer-overlay"
        data-testid="file-viewer-sheet-layer" @click.self="closePanel">
        <section class="file-viewer-sheet"
          :role="editorMode?undefined:'dialog'"
          :aria-modal="editorMode?undefined:'true'"
          :aria-label="editorMode?undefined:panel==='editor'?'Редактирование файла':'Информация о файле'"
          @keydown="onSheetKeydown">
          <header v-if="!editorMode" class="file-viewer-sheet-heading">
            <h2>{{ panel==='editor'?'Редактирование':'Информация' }}</h2>
            <button ref="sheetClose" type="button" data-testid="viewer-panel-close"
              @click="closePanel">Закрыть</button>
          </header>
          <div v-else class="file-editor-route-heading">
            <nav class="file-editor-route-path" aria-label="Путь редактора">
              <button type="button" @click="cancelEditor" aria-label="Вернуться к файлу">‹</button>
              <span>Browser › {{ preview?.name??'Файл' }}</span>
            </nav>
            <h1>{{ preview?.type==='photo'?'Редактировать фото':
              preview?.type==='audio'?'Редактировать аудио':'Редактировать видео' }}</h1>
            <nav class="file-editor-route-tabs" aria-label="Вкладки редактора"
              data-testid="file-editor-tabs">
              <button type="button" :aria-current="editorTab==='info'?'page':undefined"
                @click="selectEditorTab('info')">Информация</button>
              <button type="button" :aria-current="editorTab==='media'?'page':undefined"
                @click="selectEditorTab('media')">
                {{ preview?.type==='photo'?'Фото':preview?.type==='audio'?'Аудио':'Видео' }}
              </button>
              <button type="button" :aria-current="editorTab==='review'?'page':undefined"
                @click="selectEditorTab('review')">Проверка</button>
            </nav>
          </div>
          <div ref="editorBody" class="file-viewer-sheet-body">
            <p v-if="editorMode&&busy" role="status" class="file-viewer-wait">
              Открываем защищённый файл…
            </p>
            <p v-if="editorMode&&error" role="alert" class="error-text">{{ error }}</p>
            <p v-if="editorMode&&!activeSession" role="alert" class="error-text">
              Для редактирования требуется подтверждённая сессия.
            </p>
            <div v-show="panel==='editor'||(editorMode&&editorTab==='media')"
              class="file-viewer-editor-sections">
              <div v-if="editorMode&&fileUrl&&preview" class="file-editor-source"
                data-testid="file-editor-source">
                <img v-if="preview.type==='photo'" ref="photoElement"
                  :src="fileUrl" :alt="preview.name" draggable="false"
                  data-testid="file-viewer-image">
                <video v-else-if="preview.type==='video'" :key="fileUrl"
                  ref="videoElement" :src="fileUrl" controls playsinline preload="metadata"
                  @loadedmetadata="onVideoMetadata" @durationchange="onVideoMetadata"
                  @timeupdate="onVideoTimeUpdate"
                  data-testid="file-viewer-video"/>
                <audio v-else :key="fileUrl" ref="audioElement" :src="fileUrl"
                  controls preload="metadata" @loadedmetadata="onAudioMetadata"
                  data-testid="file-viewer-audio"/>
              </div>
      <section v-if="preview?.type==='photo'&&fileUrl"
        class="file-viewer-photo-editor" data-testid="file-viewer-photo-editor">
        <h2>Кадрирование и поворот</h2>
        <p class="muted">Создайте отдельную JPEG-копию, затем добавьте,
          переместите и отредактируйте надписи прямо на её предпросмотре.
          Маски приватности и изменение оригинала недоступны.</p>
        <div class="file-viewer-photo-aspects"
          data-testid="file-viewer-crop-aspects" aria-label="Пропорции кадра">
          <span>Пропорции</span>
          <button type="button" data-testid="file-viewer-aspect-original"
            :disabled="cropBusy" :aria-pressed="cropAspectPreset==='original'"
            @click="applyPhotoAspect('original')">Исходные</button>
          <button type="button" data-testid="file-viewer-aspect-square"
            :disabled="cropBusy" :aria-pressed="cropAspectPreset==='1:1'"
            @click="applyPhotoAspect('1:1')">1:1</button>
          <button type="button" data-testid="file-viewer-aspect-four-three"
            :disabled="cropBusy" :aria-pressed="cropAspectPreset==='4:3'"
            @click="applyPhotoAspect('4:3')">4:3</button>
          <button type="button" data-testid="file-viewer-aspect-sixteen-nine"
            :disabled="cropBusy" :aria-pressed="cropAspectPreset==='16:9'"
            @click="applyPhotoAspect('16:9')">16:9</button>
        </div>
        <div class="file-viewer-crop-controls">
          <label>Слева · {{ cropLeft }}%
            <input v-model.number="cropLeft" type="range" min="0" step="1"
              :max="100-cropWidth" data-testid="file-viewer-crop-left" @input="markCropCustom">
          </label>
          <label>Сверху · {{ cropTop }}%
            <input v-model.number="cropTop" type="range" min="0" step="1"
              :max="100-cropHeight" data-testid="file-viewer-crop-top" @input="markCropCustom">
          </label>
          <label>Ширина · {{ cropWidth }}%
            <input v-model.number="cropWidth" type="range" min="10" step="1"
              :max="100-cropLeft" data-testid="file-viewer-crop-width" @input="markCropCustom">
          </label>
          <label>Высота · {{ cropHeight }}%
            <input v-model.number="cropHeight" type="range" min="10" step="1"
              :max="100-cropTop" data-testid="file-viewer-crop-height" @input="markCropCustom">
          </label>
          <label>Поворот
            <select :value="cropTurns" data-testid="file-viewer-crop-turn"
              @change="setCropTurns">
              <option value="0">0°</option>
              <option value="1">90°</option>
              <option value="2">180°</option>
              <option value="3">270°</option>
            </select>
          </label>
        </div>
        <div class="file-viewer-photo-rotate-controls">
          <button type="button" data-testid="file-viewer-rotate-left"
            :disabled="cropBusy" @click="turnPhoto(-1)">−90°</button>
          <span>Поворот: {{ cropTurns*90 }}°</span>
          <button type="button" data-testid="file-viewer-rotate-right"
            :disabled="cropBusy" @click="turnPhoto(1)">+90°</button>
        </div>
        <h3 class="file-viewer-adjustments-heading">Цвет и свет</h3>
        <div class="file-viewer-crop-controls">
          <label>Яркость · {{ photoBrightness }}%
            <input v-model.number="photoBrightness" type="range" min="0" max="200"
              step="10" data-testid="file-viewer-photo-brightness">
          </label>
          <label>Контраст · {{ photoContrast }}%
            <input v-model.number="photoContrast" type="range" min="0" max="200"
              step="10" data-testid="file-viewer-photo-contrast">
          </label>
          <label>Насыщенность · {{ photoSaturation }}%
            <input v-model.number="photoSaturation" type="range" min="0" max="200"
              step="10" data-testid="file-viewer-photo-saturation">
          </label>
        </div>
        <button type="button" :disabled="busy||cropBusy||showBefore"
          data-testid="file-viewer-create-crop"
          @click="createCroppedPhoto">
          {{ cropBusy?'Обработка…':'Создать JPEG-копию' }}
        </button>
        <div v-if="cropResult&&cropUrl" class="file-viewer-still-preview">
          <div class="file-viewer-photo-history-bar">
            <button type="button" data-testid="file-viewer-photo-compare"
              :disabled="cropBusy" :aria-pressed="showBefore"
              @click="toggleBeforeAfter">
              {{ showBefore?'Показать после':'До / После' }}
            </button>
            <button type="button" data-testid="file-viewer-photo-undo"
              :disabled="showBefore||!canUndoPhoto||cropBusy"
              @click="travelPhotoEdit(-1)">↶ Отменить</button>
            <button type="button" data-testid="file-viewer-photo-redo"
              :disabled="showBefore||!canRedoPhoto||cropBusy"
              @click="travelPhotoEdit(1)">Повторить ↷</button>
            <button type="button" data-testid="file-viewer-photo-reset"
              :disabled="showBefore||cropBusy||!canUndoPhoto"
              @click="resetPhotoAnnotations">Сбросить аннотации</button>
          </div>
          <p class="muted">Undo/Redo восстанавливает текст, фигуры и штрихи.
            Кадрирование и цветовые параметры пока не входят в историю.</p>
          <p v-if="showBefore" class="muted"
            data-testid="file-viewer-photo-before-notice">
            Сейчас показан исходный файл. Переключитесь на обработанную
            копию, чтобы продолжить редактирование, сохранить или скачать её.
          </p>
          <div class="file-viewer-photo-composition-wrap">
            <div ref="photoComposition" class="file-viewer-photo-composition"
              data-testid="file-viewer-photo-composition">
              <img :src="showBefore?fileUrl:(composedPhotoUrl||cropUrl)"
                :alt="showBefore?(preview?.name??'Исходное фото'):croppedFileName"
                data-testid="file-viewer-crop-preview" draggable="false"
                :class="{'file-viewer-photo-text-target':!activePaintTool&&!showBefore}"
                @click="beginInlinePhotoTextAt">
              <template v-if="!showBefore&&!composedPhotoUrl">
                <svg v-for="shape in shapeMarks" :key="shape.id"
                  class="file-viewer-photo-shape-layer"
                  :class="{selected:selectedShapeId===shape.id}"
                  :data-testid="'file-viewer-shape-layer-'+shape.id"
                  :style="{left:shape.x+'%',top:shape.y+'%',
                    width:shape.width+'%',height:shape.height+'%'}"
                  viewBox="0 0 100 100"
                  :preserveAspectRatio="shape.kind==='circle'||shape.kind==='square'
                    ?'xMinYMin meet':'none'"
                  :stroke="shape.stroke"
                  :stroke-width="shape.strokeWidth*10000/(900*shape.width)"
                  stroke-linejoin="round" stroke-linecap="round"
                  :fill="shape.filled&&shape.kind!=='arrow'?shape.fill:'none'"
                  @click="selectPhotoShape(shape.id)"
                  @pointerdown="startShapeDrag($event,shape.id)"
                  @pointermove="moveShapeDrag"
                  @pointerup="endShapeDrag" @pointercancel="endShapeDrag">
                  <rect x="0" y="0" width="100" height="100"
                    fill="transparent" stroke="none"/>
                  <path v-if="shape.kind==='arrow'"
                    d="M5 95 L95 5 M60 5 H95 V40"/>
                  <circle v-else-if="shape.kind==='circle'"
                    cx="50" cy="50" r="48"/>
                  <rect v-else-if="shape.kind==='square'"
                    x="2" y="2" width="96" height="96"/>
                  <path v-else-if="shape.kind==='triangle'"
                    d="M50 2 L98 98 L2 98 Z"/>
                  <path v-else d="M50 2 L63 34 L97 37
                    L72 59 L80 95 L50 78 L20 95 L28 59 L3 37 L37 34 Z"/>
                </svg>
                <canvas ref="paintCanvas"
                  class="file-viewer-photo-paint-layer"
                  :class="{drawing:!!activePaintTool}"
                  :aria-label="activePaintTool?'Рисование на фотографии':'Слой рисунка'"
                  data-testid="file-viewer-photo-paint-canvas"
                  @pointerdown="beginPaintStroke"
                  @pointermove="updatePaintStroke"
                  @pointerup="finishPaintStroke"
                  @pointercancel="finishPaintStroke($event,true)"/>
                <button v-for="mark in textMarks" :key="mark.id"
                  type="button" class="file-viewer-photo-text-layer"
                  :class="{selected:selectedTextId===mark.id}"
                  :data-testid="'file-viewer-text-layer-'+mark.id"
                  :disabled="cropBusy||!!activePaintTool" :style="{
                    left:mark.x+'%',top:mark.y+'%',
                    maxWidth:(100-mark.x)+'%',
                    fontSize:photoTextFont(mark),color:mark.color,
                  }"
                  @click="selectPhotoText(mark.id)"
                  @dblclick.stop="editInlinePhotoText(mark.id)"
                  @pointerdown="startPhotoTextDrag($event,mark.id)"
                  @pointermove="movePhotoTextDrag"
                  @pointerup="stopPhotoTextDrag"
                  @pointercancel="stopPhotoTextDrag">
                  {{ mark.text }}
                </button>
                <button v-for="mask in photoBlackouts" :key="mask.id"
                  type="button" class="file-viewer-photo-blackout-layer"
                  :class="{selected:selectedBlackoutId===mask.id}"
                  :data-testid="'file-viewer-blackout-layer-'+mask.id"
                  :disabled="cropBusy||!!activePaintTool"
                  :style="{left:mask.x+'%',top:mask.y+'%',
                    width:mask.width+'%',height:mask.height+'%'}"
                  :aria-label="'Закрытая область '+mask.x+' '+mask.y"
                  @click="selectPhotoBlackout(mask.id)"
                  @pointerdown="beginBlackoutDrag($event,mask.id)"
                  @pointermove="moveBlackoutDrag"
                  @pointerup="endBlackoutDrag"
                  @pointercancel="endBlackoutDrag">
                </button>
              </template>
              <div v-if="inlinePhotoText&&!showBefore"
                class="file-viewer-photo-inline-input"
                :class="{'align-end':inlinePhotoText.x>55}"
                :style="{left:inlinePhotoText.x+'%',top:inlinePhotoText.y+'%'}"
                data-testid="file-viewer-inline-text-editor">
                <textarea ref="inlineTextInput"
                  :value="inlinePhotoText.text"
                  maxlength="220" rows="2"
                  aria-label="Текст надписи на фотографии"
                  placeholder="Текст…"
                  data-testid="file-viewer-inline-text-input"
                  @input="updateInlinePhotoText"
                  @keydown.enter.exact.stop.prevent="commitInlinePhotoText"
                  @keydown.esc.stop.prevent="cancelInlinePhotoText"
                  @blur="commitInlinePhotoText"/>
                <div class="file-viewer-photo-inline-actions">
                  <button type="button" data-testid="file-viewer-inline-text-done"
                    @pointerdown.prevent
                    @click="commitInlinePhotoText">Готово</button>
                  <button type="button" data-testid="file-viewer-inline-text-cancel"
                    @pointerdown.prevent
                    @click="cancelInlinePhotoText">Отмена</button>
                </div>
              </div>
            </div>
          </div>
          <p class="muted">{{ cropResult.width }} × {{ cropResult.height }}
            · {{ croppedFileName }}</p>
          <div v-if="!showBefore" class="file-viewer-photo-text-editor"
            data-testid="file-viewer-photo-draw-editor">
            <div class="file-viewer-photo-text-head">
              <strong>Рисовать ({{ strokeMarks.length }}/{{ MAX_PHOTO_STROKES }})</strong>
              <div class="file-viewer-photo-draw-tools">
                <button type="button" data-testid="file-viewer-tool-brush"
                  :class="{selected:activePaintTool==='brush'}"
                  :disabled="cropBusy" @click="choosePhotoTool('brush')">Кисть</button>
                <button type="button" data-testid="file-viewer-tool-pencil"
                  :class="{selected:activePaintTool==='pencil'}"
                  :disabled="cropBusy" @click="choosePhotoTool('pencil')">Карандаш</button>
                <button type="button" data-testid="file-viewer-tool-eraser"
                  :class="{selected:activePaintTool==='eraser'}"
                  :disabled="cropBusy" @click="choosePhotoTool('eraser')">Ластик</button>
              </div>
            </div>
            <div class="file-viewer-photo-text-settings">
              <label>Цвет кисти / карандаша
                <input type="color" :value="paintColor"
                  :disabled="cropBusy" data-testid="file-viewer-paint-color"
                  @input="setPaintColor">
              </label>
              <label>Толщина · {{ paintWidth }}
                <input type="range" min="2" max="36" step="1"
                  :value="paintWidth" :disabled="cropBusy"
                  data-testid="file-viewer-paint-width"
                  @input="setPaintWidth">
              </label>
            </div>
            <p class="muted">Выберите инструмент и рисуйте на фотографии.
              Ластик стирает только нанесённые штрихи, не оригинал,
              текст или фигуры. Рисунок хранится только в памяти
              до зашифрованного сохранения копии.</p>
          </div>
          <div v-if="!showBefore" class="file-viewer-photo-text-editor"
            data-testid="file-viewer-photo-text-editor">
            <div class="file-viewer-photo-text-head">
              <strong>Надписи ({{ textMarks.length }}/{{ MAX_TEXT_MARKS }})</strong>
              <button type="button" data-testid="file-viewer-add-text"
                :disabled="cropBusy||textMarks.length>=MAX_TEXT_MARKS"
                @click="addPhotoText">Добавить текст</button>
            </div>
            <p v-if="!textMarks.length" class="muted">
              Нажми на фотографию, чтобы добавить текст. Пустая надпись
              не создаётся. Для отмены ввода нажмите Escape.
            </p>
            <p v-else class="muted">Нажмите на свободную область фотографии,
              чтобы создать ещё одну надпись. Двойное нажатие по существующей
              надписи открывает редактирование прямо на изображении.</p>
            <p v-if="inlineTextError" role="alert" class="error-text"
              data-testid="file-viewer-inline-text-error">{{ inlineTextError }}</p>
            <div v-for="(mark,index) in textMarks" :key="mark.id"
              class="file-viewer-photo-text-row"
              :class="{selected:selectedTextId===mark.id}">
              <button type="button" :disabled="cropBusy"
                :data-testid="'file-viewer-select-text-'+index"
                @click="selectPhotoText(mark.id)">
                {{ mark.text||'Пустая надпись' }}
              </button>
              <button type="button" :disabled="cropBusy"
                :aria-label="'Редактировать надпись '+(index+1)+' на фото'"
                @click="editInlinePhotoText(mark.id)">На фото</button>
              <button type="button" :disabled="cropBusy"
                :data-testid="'file-viewer-delete-text-'+index"
                :aria-label="'Удалить надпись '+(index+1)"
                @click="deletePhotoText(mark.id)">Удалить</button>
            </div>
            <div v-if="selectedText" class="file-viewer-photo-text-settings">
              <label>Текст
                <textarea :value="selectedText.text" maxlength="220" rows="2"
                  :disabled="cropBusy" data-testid="file-viewer-edit-text"
                  @input="setTextValue"/>
              </label>
              <label>Цвет текста
                <input type="color" :value="selectedText.color"
                  :disabled="cropBusy" data-testid="file-viewer-text-color"
                  @input="setTextColor">
              </label>
              <label>Размер · {{ selectedText.size }}% ширины кадра
                <input type="range" min="2" max="12" step="1"
                  :value="selectedText.size" :disabled="cropBusy"
                  data-testid="file-viewer-text-size"
                  @input="setTextSize">
              </label>
              <label>Позиция по X (%)
                <input type="number" min="0" max="85" step="1"
                  :value="selectedText.x" :disabled="cropBusy"
                  data-testid="file-viewer-text-x"
                  @input="setTextCoordinate('x',$event)">
              </label>
              <label>Позиция по Y (%)
                <input type="number" min="0" max="85" step="1"
                  :value="selectedText.y" :disabled="cropBusy"
                  data-testid="file-viewer-text-y"
                  @input="setTextCoordinate('y',$event)">
              </label>
            </div>
          </div>
          <div v-if="!showBefore" class="file-viewer-photo-text-editor"
            data-testid="file-viewer-photo-shape-editor">
            <div class="file-viewer-photo-text-head">
              <strong>Фигуры ({{ shapeMarks.length }}/{{ MAX_SHAPE_MARKS }})</strong>
              <button type="button" data-testid="file-viewer-add-shape"
                :disabled="cropBusy||shapeMarks.length>=MAX_SHAPE_MARKS"
                @click="addPhotoShape">Добавить фигуру</button>
            </div>
            <p v-if="!shapeMarks.length" class="muted">Выберите одну из пяти
              фигур: она появится на фотографии. Положение и размер можно
              изменить на изображении или в полях ниже.</p>
            <div class="file-viewer-shape-choices" role="group"
              aria-label="Фигуры" data-testid="file-viewer-shape-choices">
              <button v-for="kind in shapeTypes" :key="kind.kind"
                type="button" class="file-viewer-shape-choice"
                :data-testid="'file-viewer-shape-type-'+kind.kind"
                :aria-label="kind.label"
                :title="kind.label"
                :aria-pressed="selectedShape?.kind===kind.kind"
                :disabled="cropBusy||showBefore||(
                  !selectedShape&&shapeMarks.length>=MAX_SHAPE_MARKS)"
                @click="choosePhotoShapeKind(kind.kind)">
                <span aria-hidden="true" class="file-viewer-shape-glyph">{{kind.glyph}}</span>
                <span class="file-viewer-shape-label">{{kind.label}}</span>
              </button>
            </div>
            <template v-if="selectedShape">
              <div class="file-viewer-shape-setting-row"
                data-testid="file-viewer-shape-stroke-row">
                <label>Цвет рамки
                  <input type="color" :value="selectedShape.stroke"
                    :disabled="cropBusy" data-testid="file-viewer-shape-stroke"
                    @input="setShapeColor('stroke',$event)">
                </label>
                <label>Толщина рамки · {{ selectedShape.strokeWidth }}
                  <input type="range" min="1" max="28" step="1"
                    :value="selectedShape.strokeWidth" :disabled="cropBusy"
                    data-testid="file-viewer-shape-stroke-width"
                    @input="setShapeStrokeWidth">
                </label>
              </div>
              <div class="file-viewer-shape-setting-row"
                data-testid="file-viewer-shape-fill-row">
                <label>Цвет заливки
                  <input type="color" :value="selectedShape.fill"
                    :disabled="cropBusy" data-testid="file-viewer-shape-fill"
                    @input="setShapeColor('fill',$event)">
                </label>
                <label class="file-viewer-shape-filled">Залить фигуру
                  <input type="checkbox" :checked="selectedShape.filled"
                    :disabled="cropBusy" data-testid="file-viewer-shape-filled"
                    @change="setShapeFilled">
                </label>
              </div>
            </template>
            <div v-for="(shape,index) in shapeMarks" :key="shape.id"
              class="file-viewer-photo-text-row"
              :class="{selected:selectedShapeId===shape.id}">
              <button type="button" :disabled="cropBusy"
                :data-testid="'file-viewer-select-shape-'+index"
                @click="selectPhotoShape(shape.id)">{{ shape.kind }}</button>
              <button type="button" :disabled="cropBusy"
                :data-testid="'file-viewer-delete-shape-'+index"
                :aria-label="'Удалить фигуру '+(index+1)"
                @click="deletePhotoShape(shape.id)">Удалить</button>
            </div>
            <div v-if="selectedShape"
              class="file-viewer-photo-text-settings file-viewer-shape-geometry">
              <label>Позиция X (%)
                <input type="number" min="0" :max="100-selectedShape.width"
                  step="1" :value="selectedShape.x" :disabled="cropBusy"
                  data-testid="file-viewer-shape-x"
                  @input="setShapeNumber('x',$event)">
              </label>
              <label>Позиция Y (%)
                <input type="number" min="0" :max="100-selectedShape.height"
                  step="1" :value="selectedShape.y" :disabled="cropBusy"
                  data-testid="file-viewer-shape-y"
                  @input="setShapeNumber('y',$event)">
              </label>
              <label>Ширина (%)
                <input type="number" min="5" :max="100-selectedShape.x"
                  step="1" :value="selectedShape.width" :disabled="cropBusy"
                  data-testid="file-viewer-shape-width"
                  @input="setShapeNumber('width',$event)">
              </label>
              <label>Высота (%)
                <input type="number" min="5" :max="100-selectedShape.y"
                  step="1" :value="selectedShape.height" :disabled="cropBusy"
                  data-testid="file-viewer-shape-height"
                  @input="setShapeNumber('height',$event)">
              </label>
            </div>
          </div>
          <div v-if="!showBefore" class="file-viewer-photo-text-editor"
            data-testid="file-viewer-photo-blackout-editor">
            <div class="file-viewer-photo-text-head">
              <strong>Закрыть области ({{ photoBlackouts.length }}/{{ MAX_PHOTO_BLACKOUTS }})</strong>
              <button type="button" data-testid="file-viewer-add-blackout"
                :disabled="cropBusy||photoBlackouts.length>=MAX_PHOTO_BLACKOUTS"
                @click="addPhotoBlackout">Закрыть область</button>
            </div>
            <p class="muted">Полностью непрозрачный чёрный прямоугольник.
              Его пиксели записываются поверх готового изображения
              в новой личной JPEG-копии. Исходный файл остаётся доступным
              в рамках собственных разрешений.</p>
            <div v-for="(mask,index) in photoBlackouts" :key="mask.id"
              class="file-viewer-photo-text-row"
              :class="{selected:selectedBlackoutId===mask.id}">
              <button type="button" :disabled="cropBusy"
                :data-testid="'file-viewer-select-blackout-'+index"
                @click="selectPhotoBlackout(mask.id)">
                Область {{ index+1 }} · {{ mask.width }}×{{ mask.height }}%
              </button>
              <button type="button" :disabled="cropBusy"
                :data-testid="'file-viewer-delete-blackout-'+index"
                @click="deletePhotoBlackout(mask.id)">Удалить</button>
            </div>
            <div v-if="selectedBlackout" class="file-viewer-photo-text-settings">
              <label>Слева (%)
                <input type="number" min="0" :max="100-selectedBlackout.width"
                  step="1" :value="selectedBlackout.x" :disabled="cropBusy"
                  data-testid="file-viewer-blackout-x"
                  @input="editPhotoBlackout('x',$event)">
              </label>
              <label>Сверху (%)
                <input type="number" min="0" :max="100-selectedBlackout.height"
                  step="1" :value="selectedBlackout.y" :disabled="cropBusy"
                  data-testid="file-viewer-blackout-y"
                  @input="editPhotoBlackout('y',$event)">
              </label>
              <label>Ширина (%)
                <input type="number" min="5" :max="100-selectedBlackout.x"
                  step="1" :value="selectedBlackout.width" :disabled="cropBusy"
                  data-testid="file-viewer-blackout-width"
                  @input="editPhotoBlackout('width',$event)">
              </label>
              <label>Высота (%)
                <input type="number" min="5" :max="100-selectedBlackout.y"
                  step="1" :value="selectedBlackout.height" :disabled="cropBusy"
                  data-testid="file-viewer-blackout-height"
                  @input="editPhotoBlackout('height',$event)">
              </label>
            </div>
            <p class="muted">Это не публикация Safe Media и не отзыв
              доступа к оригиналу. Безопасность публичной версии требует
              отдельной проверки прав доступа и метаданных.</p>
          </div>
          <div v-if="!showBefore&&photoBlackouts.length&&safeSourceEligible
            &&!cropSavedId" class="file-viewer-photo-text-editor"
            data-testid="file-viewer-safe-intent">
            <label class="file-viewer-shape-filled">
              <input v-model="safeCandidateIntent" type="checkbox"
                :disabled="cropBusy" data-testid="file-viewer-mark-safe-candidate">
              Отметить новую копию кандидатом для адресной Safe-передачи
            </label>
            <p class="muted">Отмечается только результат этого редактора.
              После сохранения и подтверждения облачной синхронизации
              передать адресату можно будет только отдельный зашифрованный
              JPEG. Оригинал останется доступен по своим независимым правам.
              Это не публичная карточка и не автоматическая проверка
              того, что все чувствительные участки закрыты.</p>
          </div>
          <p v-if="textMarks.length||shapeMarks.length||strokeMarks.length
            ||photoBlackouts.length" class="muted">
            При сохранении или скачивании надписи, фигуры, штрихи и
            закрытые области превращаются в пиксели нового JPEG.
            Редактируемые черновики не отправляются серверу открытым текстом.
          </p>
          <div v-if="!showBefore" class="file-viewer-still-actions">
            <button type="button" :disabled="cropBusy||!!cropSavedId"
              data-testid="file-viewer-save-crop" @click="saveCroppedPhoto">
              {{ cropSavedId?'Сохранено в Browser':'Сохранить зашифрованно в Browser' }}
            </button>
            <button type="button" :disabled="cropBusy"
              data-testid="file-viewer-download-crop"
              @click="downloadCroppedPhoto">Скачать JPEG на устройство</button>
            <RouterLink v-if="cropSavedId"
              :to="{name:'browser-viewer',params:{protocol:'media',id:cropSavedId}}">
              Открыть сохранённую копию
            </RouterLink>
          </div>
        </div>
        <p class="muted">Копия — независимый личный E2EE-файл. Доступы,
          GPS, задание и TTL оригинала автоматически не наследуются.
          Яркость, контраст и насыщенность применяются к пикселям
          только при создании копии. Надписи, фигуры и отдельный
          рисованный слой накладываются поверх итогового кадра.
          Ластик не удаляет пиксели исходной фотографии.
          Это не маска приватности.</p>
        <p v-if="cropNotice" role="status" data-testid="file-viewer-crop-status">
          {{ cropNotice }}</p>
        <p v-if="cropError" role="alert" data-testid="file-viewer-crop-error">
          {{ cropError }}</p>
      </section>
      <section v-if="preview?.type==='audio'&&fileUrl"
        class="file-viewer-audio-editor" data-testid="file-viewer-audio-editor">
        <div class="file-viewer-still-heading">
          <div>
            <h2>Обрезка аудио</h2>
            <p class="muted">Выберите диапазон, затем создайте отдельный WAV.</p>
          </div>
        </div>
        <template v-if="audioDuration>0">
          <label>Начало · {{ trimStart.toFixed(1) }} с
            <input v-model.number="trimStart" type="range" min="0"
              :max="audioDuration" step="0.1"
              data-testid="file-viewer-audio-start">
          </label>
          <label>Конец · {{ trimEnd.toFixed(1) }} с
            <input v-model.number="trimEnd" type="range" min="0"
              :max="audioDuration" step="0.1"
              data-testid="file-viewer-audio-end">
          </label>
          <button type="button" data-testid="file-viewer-make-wav"
            :disabled="busy||audioClipBusy||trimEnd-trimStart<0.05"
            @click="makeAudioFragment">
            {{ audioClipBusy?'Обработка…':'Создать WAV-фрагмент' }}
          </button>
        </template>
        <p v-else class="muted">Длительность аудиозаписи пока не определена.</p>
        <div v-if="audioClip&&audioClipUrl" class="file-viewer-still-preview">
          <audio :src="audioClipUrl" controls
            data-testid="file-viewer-wav-preview"/>
          <p class="muted">{{ audioClipFileName }}
            · {{ ((audioClip.endMs-audioClip.startMs)/1000).toFixed(1) }} с
            · {{ audioClip.channels }} кан. · {{ audioClip.sampleRate }} Гц</p>
          <div class="file-viewer-still-actions">
            <button type="button" data-testid="file-viewer-save-wav"
              :disabled="audioClipBusy||!!audioClipSavedId"
              @click="saveAudioFragment">
              {{ audioClipSavedId?'Сохранено в Browser':'Сохранить зашифрованно в Browser' }}
            </button>
            <button type="button" data-testid="file-viewer-download-wav"
              :disabled="audioClipBusy" @click="downloadAudioFragment">
              Скачать WAV на устройство
            </button>
            <RouterLink v-if="audioClipSavedId"
              :to="{name:'browser-viewer',params:{protocol:'media',id:audioClipSavedId}}">
              Открыть сохранённый WAV
            </RouterLink>
          </div>
        </div>
        <p class="muted">Оригинал не изменяется. Фрагмент — отдельный личный файл:
          права доступа, GPS, задание и срок исходной записи не наследуются.
          Редактирование ограничено файлами, доступными для локального
          декодирования (до 32 МиБ входных данных).</p>
        <p v-if="audioClipNotice" role="status" data-testid="file-viewer-wav-status">
          {{ audioClipNotice }}</p>
        <p v-if="audioClipError" role="alert" data-testid="file-viewer-wav-error">
          {{ audioClipError }}</p>
      </section>
      <section v-if="editorMode&&preview?.type==='video'&&fileUrl"
        class="file-editor-video-trim" data-testid="file-editor-video-trim">
        <h2>Обрезка видео</h2>
        <p class="muted">Выберите начало и конец, затем просмотрите диапазон.
          Границы сохраняются только в черновике: новый MP4 не создаётся.</p>
        <template v-if="videoDuration>0">
          <div class="file-editor-video-trim-controls">
            <label>Начало · {{ videoTrimStart.toFixed(1) }} с
              <input v-model.number="videoTrimStart" type="range"
                min="0" :max="videoDuration" step="0.05"
                data-testid="file-editor-video-start">
            </label>
            <label>Конец · {{ videoTrimEnd.toFixed(1) }} с
              <input v-model.number="videoTrimEnd" type="range"
                min="0" :max="videoDuration" step="0.05"
                data-testid="file-editor-video-end">
            </label>
          </div>
          <p class="muted" data-testid="file-editor-video-selected">
            Выбрано: {{ videoSelectedLength.toFixed(1) }} с из
            {{ videoDuration.toFixed(1) }} с
          </p>
          <div class="file-editor-video-trim-actions">
            <button type="button" data-testid="file-editor-video-preview"
              :disabled="!videoRangeValid||videoPreviewActive"
              @click="previewVideoSelection">Просмотреть фрагмент</button>
            <button type="button" data-testid="file-editor-video-apply"
              :disabled="!videoRangeValid"
              @click="applyVideoSelection">Применить обрезку</button>
            <button type="button" data-testid="file-editor-video-undo"
              :disabled="videoHistoryIndex===0"
              @click="travelVideoSelection(-1)">Undo</button>
            <button type="button" data-testid="file-editor-video-redo"
              :disabled="videoHistoryIndex>=videoTrimHistory.length-1"
              @click="travelVideoSelection(1)">Redo</button>
            <button type="button" data-testid="file-editor-video-reset"
              @click="resetVideoSelection">Отменить изменения</button>
          </div>
          <p v-if="videoApplied" class="muted"
            data-testid="file-editor-video-applied">
            Применён локальный диапазон
            {{ videoApplied.start.toFixed(1) }}–{{ videoApplied.end.toFixed(1) }} с.
            Исходный файл не изменён.
          </p>
        </template>
        <p v-else class="muted" data-testid="file-editor-video-no-duration">
          Длительность исходного видео не определена браузером.
          Обрезка недоступна до получения корректных медиаметаданных.
        </p>
        <p v-if="videoTrimNotice" role="status"
          data-testid="file-editor-video-status">{{ videoTrimNotice }}</p>
      </section>
      <section v-if="preview?.type==='video'&&fileUrl"
        class="file-viewer-still" data-testid="file-viewer-still">
        <div class="file-viewer-still-heading">
          <div>
            <h2>Стоп-кадр</h2>
            <p class="muted">Выберите момент на видеоплеере и создайте JPEG-копию кадра.</p>
          </div>
          <button type="button" data-testid="file-viewer-create-still"
            :disabled="busy||stillBusy" @click="createStill">
            {{ stillBusy?'Обработка…':'Создать стоп-кадр' }}
          </button>
        </div>
        <div v-if="still&&stillUrl" class="file-viewer-still-preview">
          <img :src="stillUrl" :alt="stillFileName"
            data-testid="file-viewer-still-image">
          <p class="muted">{{ still.width }} × {{ still.height }} ·
            {{ (still.timeMs/1000).toFixed(2) }} сек. · {{ stillFileName }}</p>
          <div class="file-viewer-still-actions">
            <button type="button" :disabled="stillBusy||!!stillSavedId"
              data-testid="file-viewer-save-still"
              @click="saveStillToBrowser">
              {{ stillSavedId?'Сохранено в Browser':'Сохранить зашифрованно в Browser' }}
            </button>
            <button type="button" :disabled="stillBusy"
              data-testid="file-viewer-download-still"
              @click="downloadStill">Скачать JPEG на устройство</button>
            <RouterLink v-if="stillSavedId"
              :to="{name:'browser-viewer',params:{protocol:'media',id:stillSavedId}}">
              Открыть сохранённый файл
            </RouterLink>
          </div>
        </div>
        <p class="muted">Стоп-кадр — отдельный личный файл: права доступа,
          задание, GPS и срок исходного видео не наследуются.
          Исходное видео не изменяется.</p>
        <p v-if="stillNotice" role="status" data-testid="file-viewer-still-status">
          {{ stillNotice }}</p>
        <p v-if="stillError" role="alert" data-testid="file-viewer-still-error">
          {{ stillError }}</p>
      </section>
            </div>
            <div v-show="panel==='info'||(editorMode&&editorTab==='info')">
      <section v-if="editorMode&&preview"
        class="file-editor-private-copy" data-testid="file-editor-private-copy">
        <h2>Информация · личная копия</h2>
        <p class="muted">Изменения информации создают <strong>новый личный
          зашифрованный файл</strong>. Подписанный оригинал и задание остаются
          без изменений. GPS, разрешения на чтение и срок хранения не
          копируются. Подтверждение облака отдельно.</p>
        <template v-if="personalCopyEligible">
          <label for="personal-copy-name">Название файла</label>
          <input id="personal-copy-name" v-model="privateCopyDraft.name"
            type="text" maxlength="160" autocomplete="off"
            :disabled="privateCopyBusy" data-testid="private-copy-name"/>
          <label for="personal-copy-description">Описание</label>
          <textarea id="personal-copy-description"
            v-model="privateCopyDraft.description" rows="3"
            maxlength="4000" :disabled="privateCopyBusy"
            data-testid="private-copy-description"/>
          <label for="personal-copy-category">Категория</label>
          <input id="personal-copy-category" v-model="privateCopyDraft.category"
            maxlength="64" autocomplete="off" :disabled="privateCopyBusy"
            data-testid="private-copy-category"/>
          <span class="file-editor-private-tag-label">Теги</span>
          <div class="file-editor-private-tags" data-testid="private-copy-tags">
            <span v-for="(tag,index) in privateCopyDraft.tags" :key="tag"
              class="file-editor-private-tag">
              <button type="button" :disabled="privateCopyBusy"
                :aria-label="'Изменить тег '+tag"
                @click="openPrivateTagEditor(index)">{{ tag }}</button>
              <button type="button" :disabled="privateCopyBusy"
                :aria-label="'Удалить тег '+tag"
                @click="removePrivateTag(index)">×</button>
            </span>
            <button type="button" :disabled="privateCopyBusy
              ||privateCopyDraft.tags.length>=12" class="file-editor-add-tag"
              data-testid="private-copy-add-tag"
              @click="openPrivateTagEditor(null)">Добавить тег</button>
          </div>
          <div v-if="privateTagForm" class="file-editor-private-tag-form"
            data-testid="private-copy-tag-editor">
            <label for="personal-copy-tag-text">
              {{ privateTagEditIndex===null?'Новый тег':'Изменить тег' }}
            </label>
            <input id="personal-copy-tag-text" v-model="privateTagText"
              type="text" maxlength="48" autocomplete="off"
              data-testid="private-copy-tag-text" @keydown.enter.prevent="commitPrivateTag"/>
            <div>
              <button type="button" @click="commitPrivateTag">Готово</button>
              <button type="button" @click="closePrivateTagEditor">Отмена</button>
            </div>
          </div>
          <p v-if="privateCopyChanged&&!privateCopyValidation"
            class="error-text" data-testid="private-copy-invalid">
            Проверьте название, описание, категорию и теги.
            Расширение файла менять нельзя; до 12 уникальных тегов.
          </p>
          <p v-if="privateCopyChanged&&editorMediaUnsaved"
            class="error-text" data-testid="private-copy-mixed-warning">
            Есть также несохранённые правки медиа. Нельзя сохранить лишь
            часть изменений: завершите или отмените одну операцию, затем другую.
          </p>
          <p v-if="privateTagForm" class="muted">
            Сначала подтвердите или отмените изменение тега.
          </p>
          <p v-if="privateCopyChanged&&!editorMediaUnsaved
              &&!!privateCopyValidation" class="muted"
            data-testid="private-copy-save-hint">
            Нажмите «Сохранить» в шапке для создания новой E2EE-копии.
            Действие потребует подтверждения.
          </p>
        </template>
        <p v-else class="muted" data-testid="private-copy-unavailable">
          Изменение информации недоступно: требуется подтверждённый
          локальный личный MediaFile. Для файлов заданий, облачных
          источников и просроченных файлов нужна отдельная проверенная
          серверная политика. Исходные сведения доступны ниже только для чтения.
        </p>
        <p v-if="privateCopyBusy" role="status">Шифруем отдельную копию…</p>
        <p v-if="privateCopyError" class="error-text" role="alert"
          data-testid="private-copy-error">{{ privateCopyError }}</p>
      </section>
      <div v-if="preview" class="file-viewer-information" data-testid="file-viewer-info">
        <div class="file-viewer-info-heading">
          <div>
            <h2>{{ preview.name }}</h2>
            <p class="muted">
              {{ preview.type==='photo'?'Фото':preview.type==='video'?'Видео':'Аудио' }}
              · {{ preview.origin==='local'?'Расшифровано локально':'Получено из облака и расшифровано локально' }}
            </p>
          </div>
          <button type="button" @click="download">Скачать</button>
        </div>
        <p v-if="preview.description">{{ preview.description }}</p>
        <dl>
          <template v-if="preview.capturedAt">
            <dt>Дата</dt><dd>{{ new Date(preview.capturedAt).toLocaleString('ru-RU') }}</dd>
          </template>
          <dt>Тип</dt><dd>{{ preview.mime }}</dd>
          <dt>ID</dt><dd><code>{{ current.id }}</code></dd>
          <template v-if="preview.category">
            <dt>Категория</dt><dd>{{ preview.category }}</dd>
          </template>
          <template v-if="preview.tags.length">
            <dt>Теги</dt><dd>{{ preview.tags.join(', ') }}</dd>
          </template>
          <template v-if="preview.gps">
            <dt>GPS</dt>
            <dd>{{ preview.gps.latitude }}, {{ preview.gps.longitude }}
              · ±{{ Math.round(preview.gps.accuracyMeters) }} м</dd>
          </template>
          <template v-if="preview.expiresAt">
            <dt>Хранение до</dt><dd>{{ new Date(preview.expiresAt).toLocaleDateString('ru-RU') }}</dd>
          </template>
        </dl>
        <p class="muted">Приватные данные расшифрованы на устройстве.
          Скачивание — только после явного подтверждения.</p>
      </div>
            </div>
            <section v-if="editorMode" v-show="editorTab==='review'"
              class="file-editor-review" data-testid="file-editor-review">
              <h2>Проверка куратором</h2>
              <p>Решения куратора требуют подтверждённых ролей, политики задания
                и серверного аудита. Этот раздел пока доступен только для просмотра.</p>
              <div class="file-editor-review-controls">
                <button disabled type="button">Принять</button>
                <button disabled type="button">Исправить</button>
                <button disabled type="button">Переснять</button>
                <button disabled type="button">Отклонить</button>
              </div>
            </section>
          </div>
        </section>
      </div>
      <div class="file-viewer-feedback" aria-live="polite">
      <p v-if="indexIncomplete" class="muted"
        data-testid="file-viewer-index-incomplete">
        Проверено до 500 облачных записей соответствующего типа.
        Каталог может содержать ещё файлы; список навигации неполный.
      </p>
      <button v-if="photoCursor||mediaCursor" type="button"
        data-testid="file-viewer-load-more"
        :disabled="indexBusy" @click="loadMore">Загрузить ещё файлы для навигации</button>
      <p v-if="indexBusy" class="muted">Обновляется список доступных файлов…</p>
      <p v-if="notice" role="status" class="muted">{{ notice }}</p>
      <p v-if="error" role="alert" class="error-text">{{ error }}</p>
      </div>
    </template>
  </section>
</template>
