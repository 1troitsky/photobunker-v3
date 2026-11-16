import { afterEach, describe, expect, it } from 'vitest'
import {
 defaultVisual,readVisual,saveCompleteAppearance,savedVisual,restoreVisual,
 validateVisual,
} from './visual-preferences'
import { appearanceStorageKey, defaultDock, savedDock, restoreDock } from './dock-preferences'
import { defaultLaunch, savedLaunch, resolveStartRoute } from './appearance-preferences'
type Store={data:Record<string,string>;getItem:(k:string)=>string|null;setItem:(k:string,v:string)=>void}
function memory(initial:Record<string,string>={}):Store{
 const data={...initial}
 return {data,getItem:k=>data[k]??null,setItem:(k,v)=>{data[k]=v}}
}
afterEach(()=>{
 savedVisual.value={...defaultVisual};restoreVisual()
 savedDock.value=[...defaultDock];restoreDock();savedLaunch.value=defaultLaunch
})
describe('owner-approved Fieldwork Appearance 1.3: atomic visual preferences',()=>{
 it('defaults to neutral dark and never trusts malformed visual data',()=>{
  expect(readVisual(memory())).toEqual(defaultVisual)
  expect(validateVisual({...defaultVisual,accent:'blue'})).toBeNull()
  expect(validateVisual({...defaultVisual,unexpected:'x'})).toBeNull()
  expect(validateVisual(defaultVisual)).toEqual(defaultVisual)
 })
 it('saves all seven settings (Dock, Launch, 4 visual values) as ONE local bundle',()=>{
  const store=memory()
  const visual={theme:'system',accent:'coral',size:'large',language:'en'}
  expect(saveCompleteAppearance(['browser','camera','settings'],'browser',visual,store)).toBe(true)
  expect(Object.keys(store.data)).toEqual([appearanceStorageKey])
  expect(JSON.parse(store.data[appearanceStorageKey]!)).toEqual({
   version:2,dock:['browser','camera','settings'],launch:'browser',visual,
  })
  expect(readVisual(store)).toEqual(visual)
  expect(resolveStartRoute(store)).toBe('/browser')
 })
 it('keeps old saved Dock and Start prefs working with absent new visual section',()=>{
  const store=memory({[appearanceStorageKey]:JSON.stringify({
   version:2,dock:['camera','settings','browser'],launch:'camera',
  })})
  expect(readVisual(store)).toEqual(defaultVisual)
 })
 it('does not mutate any saved value if storage fails',()=>{
  const before=JSON.stringify(savedVisual.value)
  const store:Store={data:{},getItem:()=>null,setItem:()=>{throw Error('quota')}}
  expect(saveCompleteAppearance(['camera','settings','browser'],'camera',{
    ...defaultVisual,theme:'light',
  },store)).toBe(false)
  expect(JSON.stringify(savedVisual.value)).toBe(before)
 })
})
