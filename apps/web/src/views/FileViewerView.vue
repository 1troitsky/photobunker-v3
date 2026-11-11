<script setup lang="ts">
import {computed,onMounted,onUnmounted,ref,watch} from 'vue'
import {RouterLink,useRoute,useRouter} from 'vue-router'
import {activeSession} from '../features/identity/application/session'
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
import {captureVideoStill,stillName} from '../features/browser/application/video-still'
import {audioClipName,makeWavClip} from '../features/browser/application/audio-wav'
import {cropFileName,cropPhoto} from '../features/browser/application/photo-crop'
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
import {
  initialPhotoHistory,recordPhotoEdit,travelPhotoHistory,
  canPhotoUndo,canPhotoRedo,
} from '../features/browser/application/photo-history'
import type {PhotoEditHistory,PhotoEditSnapshot} from '../features/browser/application/photo-history'
import type {PhotoTextMark} from '../features/browser/application/photo-text'
import type {WavClip} from '../features/browser/application/audio-wav'
import type {VideoStill} from '../features/browser/application/video-still'
import {buildCatalog} from '../features/browser/application/catalog'
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
const stage=ref<HTMLElement|null>(null)
const photoElement=ref<HTMLImageElement|null>(null)
const cropLeft=ref(0),cropTop=ref(0),cropWidth=ref(100),cropHeight=ref(100)
const cropTurns=ref<CropSelection['turns']>(0)
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
const cropUrl=ref('')
const cropBusy=ref(false)
const cropError=ref('')
const cropNotice=ref('')
const cropSavedId=ref<string|null>(null)
const photoComposition=ref<HTMLElement|null>(null)
const compositionWidth=ref(0)
let compositionObserver:ResizeObserver|null=null
const textMarks=ref<PhotoTextMark[]>([])
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
const selectedTextId=ref<string|null>(null)
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
const busy=ref(false)
const error=ref('')
const notice=ref('')
const fileUrl=ref('')
const fileBlob=ref<Blob|null>(null)
const preview=ref<Preview|null>(null)
const files=computed(()=>buildCatalog(
  photoLocal.value,photoCloud.value,mediaLocal.value,mediaCloud.value,
))
const adjacent=computed(()=>current.value
  ?adjacentFiles(files.value,current.value)
  :{previous:null,next:null,position:0,total:0})
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
  return {text:textMarks.value,shapes:shapeMarks.value,strokes:strokeMarks.value}
}
function commitPhotoEdit():void{
  paintHistory.value=recordPhotoEdit(paintHistory.value,currentPhotoEdits())
}
function travelPhotoEdit(delta:-1|1):void{
  if(cropBusy.value||draftStroke.value)return
  const next=travelPhotoHistory(paintHistory.value,delta)
  if(!next)return
  paintHistory.value=next.history
  textMarks.value=[...next.snapshot.text]
  shapeMarks.value=[...next.snapshot.shapes]
  strokeMarks.value=[...next.snapshot.strokes]
  if(!textMarks.value.some(mark=>mark.id===selectedTextId.value))
    selectedTextId.value=null
  if(!shapeMarks.value.some(mark=>mark.id===selectedShapeId.value))
    selectedShapeId.value=null
  invalidateTextOutput()
}
function resetPhotoAnnotations():void{
  if(cropBusy.value||draftStroke.value)return
  if(!textMarks.value.length&&!shapeMarks.value.length
    &&!strokeMarks.value.length)return
  textMarks.value=[]
  shapeMarks.value=[]
  strokeMarks.value=[]
  selectedTextId.value=null
  selectedShapeId.value=null
  invalidateTextOutput()
  commitPhotoEdit()
}
function replaceTextMarks(updated:PhotoTextMark[]):void{
  if(cropBusy.value)return
  textMarks.value=updated
  invalidateTextOutput()
  if(!draggingMark)commitPhotoEdit()
}
function clearTextMarks():void{
  ++textRevision
  textMarks.value=[]
  shapeMarks.value=[]
  strokeMarks.value=[]
  draftStroke.value=null
  strokePointer=null
  activePaintTool.value=null
  paintHistory.value=initialPhotoHistory()
  selectedTextId.value=null
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
function addPhotoShape():void{
  if(!cropResult.value||cropBusy.value||shapeMarks.value.length>=MAX_SHAPE_MARKS)return
  const mark:PhotoShapeMark={
    id:crypto.randomUUID(),kind:'arrow',x:20,y:25,width:35,height:25,
    stroke:'#1ed760',strokeWidth:6,fill:'#60a5fa',filled:false,
  }
  replaceShapeMarks([...shapeMarks.value,mark])
  selectedShapeId.value=mark.id
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
function setShapeKind(event:Event):void{
  const kind=(event.target as HTMLSelectElement).value
  if(['arrow','circle','square','triangle','star'].includes(kind))
    editPhotoShape({kind:kind as ShapeKind})
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
  if(draggingShape?.pointerId!==event.pointerId)return
  const target=event.currentTarget as Element
  if(target.hasPointerCapture(event.pointerId))
    target.releasePointerCapture(event.pointerId)
  draggingShape=null
  commitPhotoEdit()
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
  if(cropBusy.value||!cropResult.value)return
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
  if(!canvas||!tool||!cropResult.value||cropBusy.value
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
  const width=Math.max(1,Math.round(Math.min(900,
    canvas.clientWidth*(window.devicePixelRatio||1))))
  const height=Math.max(1,Math.round(width*result.height/result.width))
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
function clearCrop():void{
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
function setCropTurns(event:Event):void{
  const next=Number((event.target as HTMLSelectElement).value)
  if(next===0||next===1||next===2||next===3)cropTurns.value=next
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
  clearTextMarks()
  clearCrop()
  cropLeft.value=0;cropTop.value=0
  cropWidth.value=100;cropHeight.value=100;cropTurns.value=0
  photoBrightness.value=100;photoContrast.value=100;photoSaturation.value=100
  clearStill()
  clearAudioClip()
  audioDuration.value=0
  trimStart.value=0
  trimEnd.value=0
  ++fileEpoch
  if(fileUrl.value)URL.revokeObjectURL(fileUrl.value)
  fileUrl.value=''
  fileBlob.value=null
  preview.value=null
  busy.value=false
}
function clearIndex():void{
  ++catalogEpoch
  photoLocal.value=[];photoCloud.value=[]
  mediaLocal.value=[];mediaCloud.value=[]
  photoCursor.value=null;mediaCursor.value=null
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
  clearIndex()
  const epoch=catalogEpoch
  if(!session)return
  indexBusy.value=true
  try{
    const [photos,media]=await Promise.all([listLocalPhotos(),listLocalMedia()])
    if(session!==activeSession.value||epoch!==catalogEpoch)return
    photoLocal.value=photos;mediaLocal.value=media
    if(!session.online||offline())return
    const [p,m]=await Promise.allSettled([listCloudPhotos(),listCloudMedia()])
    if(session!==activeSession.value||epoch!==catalogEpoch)return
    if(p.status==='fulfilled'){
      photoCloud.value=p.value.items
      photoCursor.value=p.value.nextCursor
    }
    if(m.status==='fulfilled'){
      mediaCloud.value=m.value.items
      mediaCursor.value=m.value.nextCursor
    }
    if(p.status==='rejected'||m.status==='rejected')
      notice.value='Часть облачного каталога недоступна. Локальные файлы остаются доступны.'
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
    if(p.status==='fulfilled'&&p.value){
      photoCloud.value=[...photoCloud.value,...p.value.items]
      photoCursor.value=p.value.nextCursor
    }
    if(m.status==='fulfilled'&&m.value){
      mediaCloud.value=[...mediaCloud.value,...m.value.items]
      mediaCursor.value=m.value.nextCursor
    }
    if(p.status==='rejected'||m.status==='rejected')
      notice.value='Не все страницы каталога удалось загрузить.'
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
  }catch(e){
    if(sameSession(session,epoch))error.value=explain(e)
  }finally{if(sameSession(session,epoch))busy.value=false}
}
async function navigate(item:CatalogItem|null):Promise<void>{
  if(!item||busy.value)return
  await router.push({
    name:'browser-viewer',params:{protocol:item.source,id:item.id},
  })
}
function onKeyDown(event:KeyboardEvent):void{
  if(event.defaultPrevented||event.altKey||event.ctrlKey||event.metaKey
    ||event.target instanceof HTMLElement&&event.target.closest(
      'input,textarea,select,video,audio,button,[contenteditable="true"]'))return
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
  if(!session||!img||!target||!source||cropBusy.value
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
):Promise<Blob>{
  validateTextMarks(marks)
  if(!marks.length&&!shapes.length&&!strokes.length)return source
  return (await flattenPhotoAnnotations(source,marks,shapes,strokes)).blob
}
function setComposedCrop(blob:Blob):void{
  clearComposition()
  composedPhotoBlob=blob
  composedPhotoUrl.value=URL.createObjectURL(blob)
}
async function saveCroppedPhoto():Promise<void>{
  const session=activeSession.value,result=cropResult.value
  const name=croppedFileName.value
  const epoch=cropEpoch,currentEpoch=fileEpoch
  const version=textRevision
  const marks=textMarks.value.map(mark=>({...mark}))
  const shapes=shapeMarks.value.map(shape=>({...shape}))
  const strokes=strokeMarks.value.map(stroke=>({...stroke,
    points:stroke.points.map(point=>({...point})),
  }))
  if(!session||!result||!name||cropBusy.value||preview.value?.type!=='photo'
    ||cropSavedId.value)return
  cropBusy.value=true;cropError.value='';cropNotice.value=''
  try{
    const flattened=composedPhotoBlob??await preparedCropWithText(result.blob,marks,shapes,strokes)
    if(!sameSession(session,currentEpoch)||epoch!==cropEpoch
      ||version!==textRevision)return
    const id=await enqueueEncryptedMedia(
      new File([flattened],name,{type:'image/jpeg'}))
    if(sameSession(session,currentEpoch)&&epoch===cropEpoch
      &&version===textRevision){
      if(marks.length||shapes.length||strokes.length)setComposedCrop(flattened)
      cropSavedId.value=id
      cropNotice.value='Новая JPEG-копия зашифрована в очереди Browser. Облачная синхронизация подтверждается отдельно.'
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
  if(!session||!result||!cropUrl.value||!name||cropBusy.value
    ||preview.value?.type!=='photo')return
  if(!window.confirm('Скачать JPEG-копию на устройство? Файл будет вне защищённого Browser и может появиться в системной галерее.'))return
  cropBusy.value=true;cropError.value=''
  try{
    const flattened=composedPhotoBlob??await preparedCropWithText(result.blob,marks,shapes,strokes)
    if(!sameSession(session,currentEpoch)||epoch!==cropEpoch
      ||version!==textRevision)return
    if((marks.length||shapes.length||strokes.length)&&!composedPhotoUrl.value)
      setComposedCrop(flattened)
    const anchor=document.createElement('a')
    anchor.href=marks.length||shapes.length||strokes.length
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
    return
  }
  clearBlob();clearIndex()
  void refreshIndex()
  void openFile()
},{immediate:true})
watch([()=>route.params.protocol,()=>route.params.id],()=>{void openFile()})
onMounted(()=>window.addEventListener('keydown',onKeyDown))
onUnmounted(()=>{
  compositionObserver?.disconnect()
  window.removeEventListener('keydown',onKeyDown)
  clearBlob();clearIndex()
})
</script>

<template>
  <section class="foundation-content file-viewer" data-testid="file-viewer">
    <header class="file-viewer-header">
      <RouterLink to="/browser" class="file-viewer-back">‹ Browser</RouterLink>
      <div>
        <h1>Просмотр файла</h1>
        <p class="muted" v-if="current">{{ current.id.slice(0,8) }}</p>
      </div>
      <button type="button" :disabled="!fileUrl"
        @click="toggleFullscreen">На весь экран</button>
    </header>
    <div v-if="!activeSession" class="foundation-card">
      <p>Для просмотра зашифрованных файлов необходим вход.</p>
      <RouterLink to="/settings">Открыть доступ</RouterLink>
    </div>
    <div v-else-if="!current" role="alert" class="error-text">
      Некорректный адрес файла.
    </div>
    <template v-else>
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
      <div ref="stage" class="file-viewer-stage"
        data-testid="file-viewer-stage"
        @touchstart.passive="onTouchStart" @touchend.passive="onTouchEnd">
        <div v-if="busy" role="status" class="file-viewer-wait">Открываем защищённый файл…</div>
        <img v-else-if="fileUrl&&preview?.type==='photo'" ref="photoElement"
          :src="fileUrl" :alt="preview?.name??'Фото'" draggable="false"
          data-testid="file-viewer-image">
        <video v-else-if="fileUrl&&preview?.type==='video'" :key="fileUrl"
          ref="videoElement" :src="fileUrl" controls playsinline preload="metadata"
          data-testid="file-viewer-video"/>
        <div v-else-if="fileUrl&&preview?.type==='audio'" class="file-viewer-audio">
          <span aria-hidden="true">♫</span>
          <audio :key="fileUrl" ref="audioElement" :src="fileUrl"
            controls preload="metadata" @loadedmetadata="onAudioMetadata"
            data-testid="file-viewer-audio"/>
        </div>
        <p v-else class="muted">Файл не открыт.</p>
      </div>
      <section v-if="preview?.type==='photo'&&fileUrl"
        class="file-viewer-photo-editor" data-testid="file-viewer-photo-editor">
        <h2>Кадрирование и поворот</h2>
        <p class="muted">Создайте отдельную JPEG-копию, затем добавьте,
          переместите и отредактируйте надписи прямо на её предпросмотре.
          Маски приватности и изменение оригинала недоступны.</p>
        <div class="file-viewer-crop-controls">
          <label>Слева · {{ cropLeft }}%
            <input v-model.number="cropLeft" type="range" min="0" step="1"
              :max="100-cropWidth" data-testid="file-viewer-crop-left">
          </label>
          <label>Сверху · {{ cropTop }}%
            <input v-model.number="cropTop" type="range" min="0" step="1"
              :max="100-cropHeight" data-testid="file-viewer-crop-top">
          </label>
          <label>Ширина · {{ cropWidth }}%
            <input v-model.number="cropWidth" type="range" min="10" step="1"
              :max="100-cropLeft" data-testid="file-viewer-crop-width">
          </label>
          <label>Высота · {{ cropHeight }}%
            <input v-model.number="cropHeight" type="range" min="10" step="1"
              :max="100-cropTop" data-testid="file-viewer-crop-height">
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
        <button type="button" :disabled="busy||cropBusy"
          data-testid="file-viewer-create-crop"
          @click="createCroppedPhoto">
          {{ cropBusy?'Обработка…':'Создать JPEG-копию' }}
        </button>
        <div v-if="cropResult&&cropUrl" class="file-viewer-still-preview">
          <div class="file-viewer-photo-history-bar">
            <button type="button" data-testid="file-viewer-photo-undo"
              :disabled="!canUndoPhoto||cropBusy"
              @click="travelPhotoEdit(-1)">↶ Отменить</button>
            <button type="button" data-testid="file-viewer-photo-redo"
              :disabled="!canRedoPhoto||cropBusy"
              @click="travelPhotoEdit(1)">Повторить ↷</button>
            <button type="button" data-testid="file-viewer-photo-reset"
              :disabled="cropBusy||!canUndoPhoto"
              @click="resetPhotoAnnotations">Сбросить аннотации</button>
          </div>
          <p class="muted">Undo/Redo восстанавливает текст, фигуры и штрихи.
            Кадрирование и цветовые параметры пока не входят в историю.</p>
          <div class="file-viewer-photo-composition-wrap">
            <div ref="photoComposition" class="file-viewer-photo-composition"
              data-testid="file-viewer-photo-composition">
              <img :src="composedPhotoUrl||cropUrl" :alt="croppedFileName"
                data-testid="file-viewer-crop-preview" draggable="false">
              <template v-if="!composedPhotoUrl">
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
                  :disabled="cropBusy" :style="{
                    left:mark.x+'%',top:mark.y+'%',
                    maxWidth:(100-mark.x)+'%',
                    fontSize:photoTextFont(mark),color:mark.color,
                  }"
                  @click="selectPhotoText(mark.id)"
                  @pointerdown="startPhotoTextDrag($event,mark.id)"
                  @pointermove="movePhotoTextDrag"
                  @pointerup="stopPhotoTextDrag"
                  @pointercancel="stopPhotoTextDrag">
                  {{ mark.text }}
                </button>
              </template>
            </div>
          </div>
          <p class="muted">{{ cropResult.width }} × {{ cropResult.height }}
            · {{ croppedFileName }}</p>
          <div class="file-viewer-photo-text-editor"
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
          <div class="file-viewer-photo-text-editor"
            data-testid="file-viewer-photo-text-editor">
            <div class="file-viewer-photo-text-head">
              <strong>Надписи ({{ textMarks.length }}/{{ MAX_TEXT_MARKS }})</strong>
              <button type="button" data-testid="file-viewer-add-text"
                :disabled="cropBusy||textMarks.length>=MAX_TEXT_MARKS"
                @click="addPhotoText">Добавить текст</button>
            </div>
            <p v-if="!textMarks.length" class="muted">Добавьте надпись.
              Перетаскивайте её по фотографии мышью или пальцем.
              Координаты можно изменить вручную.</p>
            <div v-for="(mark,index) in textMarks" :key="mark.id"
              class="file-viewer-photo-text-row"
              :class="{selected:selectedTextId===mark.id}">
              <button type="button" :disabled="cropBusy"
                :data-testid="'file-viewer-select-text-'+index"
                @click="selectPhotoText(mark.id)">
                {{ mark.text||'Пустая надпись' }}
              </button>
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
          <div class="file-viewer-photo-text-editor"
            data-testid="file-viewer-photo-shape-editor">
            <div class="file-viewer-photo-text-head">
              <strong>Фигуры ({{ shapeMarks.length }}/{{ MAX_SHAPE_MARKS }})</strong>
              <button type="button" data-testid="file-viewer-add-shape"
                :disabled="cropBusy||shapeMarks.length>=MAX_SHAPE_MARKS"
                @click="addPhotoShape">Добавить фигуру</button>
            </div>
            <p v-if="!shapeMarks.length" class="muted">Можно добавить стрелку,
              круг, квадрат, треугольник или звезду, настроить рамку и заливку,
              переместить фигуру на изображении.</p>
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
            <div v-if="selectedShape" class="file-viewer-photo-text-settings">
              <label>Фигура
                <select :value="selectedShape.kind" :disabled="cropBusy"
                  data-testid="file-viewer-shape-kind" @change="setShapeKind">
                  <option value="arrow">Стрелка</option>
                  <option value="circle">Круг</option>
                  <option value="square">Квадрат</option>
                  <option value="triangle">Треугольник</option>
                  <option value="star">Звезда</option>
                </select>
              </label>
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
          <p v-if="textMarks.length||shapeMarks.length||strokeMarks.length"
            class="muted">При сохранении или скачивании надписи, фигуры
            и штрихи превращаются в пиксели JPEG. Ни черновики, ни параметры
            рисунка не отправляются серверу открытым текстом.</p>
          <div class="file-viewer-still-actions">
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
      <button v-if="photoCursor||mediaCursor" type="button"
        :disabled="indexBusy" @click="loadMore">Загрузить ещё файлы для навигации</button>
      <p v-if="indexBusy" class="muted">Обновляется список доступных файлов…</p>
      <p v-if="notice" role="status" class="muted">{{ notice }}</p>
      <p v-if="error" role="alert" class="error-text">{{ error }}</p>
    </template>
  </section>
</template>
