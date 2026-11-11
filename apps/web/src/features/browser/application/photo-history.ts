import type {PhotoTextMark} from './photo-text'
import type {PhotoShapeMark} from './photo-shapes'
import type {PhotoStroke} from './photo-strokes'
import type {PhotoBlackout} from './photo-blackouts'

export type PhotoEditSnapshot=Readonly<{
  text:readonly PhotoTextMark[]
  shapes:readonly PhotoShapeMark[]
  strokes:readonly PhotoStroke[]
  blackouts:readonly PhotoBlackout[]
}>
export type PhotoEditHistory=Readonly<{
  states:readonly PhotoEditSnapshot[]
  cursor:number
}>
export const MAX_PHOTO_HISTORY=50
export function emptyPhotoSnapshot():PhotoEditSnapshot{
  return {text:[],shapes:[],strokes:[],blackouts:[]}
}
function cloneSnapshot(s:PhotoEditSnapshot):PhotoEditSnapshot{
  return {
    text:s.text.map(t=>({...t})),
    shapes:s.shapes.map(shape=>({...shape})),
    strokes:s.strokes.map(stroke=>({
      ...stroke,points:stroke.points.map(p=>({...p})),
    })),
    blackouts:s.blackouts.map(mask=>({...mask})),
  }
}
export function initialPhotoHistory():PhotoEditHistory{
  return {states:[emptyPhotoSnapshot()],cursor:0}
}
export function recordPhotoEdit(
  history:PhotoEditHistory,snapshot:PhotoEditSnapshot,
):PhotoEditHistory{
  const next=cloneSnapshot(snapshot)
  const current=history.states[history.cursor]
  if(!current||JSON.stringify(current)===JSON.stringify(next))return history
  const states=[...history.states.slice(0,history.cursor+1),next]
  if(states.length>MAX_PHOTO_HISTORY)states.shift()
  return {states,cursor:states.length-1}
}
export function travelPhotoHistory(
  history:PhotoEditHistory,delta:-1|1,
):{history:PhotoEditHistory;snapshot:PhotoEditSnapshot}|null{
  const next=history.cursor+delta
  if(next<0||next>=history.states.length)return null
  return {history:{states:history.states,cursor:next},
    snapshot:cloneSnapshot(history.states[next]!)}
}
export function canPhotoUndo(history:PhotoEditHistory):boolean{
  return history.cursor>0
}
export function canPhotoRedo(history:PhotoEditHistory):boolean{
  return history.cursor<history.states.length-1
}
