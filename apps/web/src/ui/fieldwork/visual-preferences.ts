import { shallowRef } from 'vue'
import { appearanceStorageKey, displayedDock, savedDock, validateDock } from './dock-preferences'
import { savedLaunch, validateAppearance } from './appearance-preferences'
import type { LaunchPage, AppearanceStorage } from './appearance-preferences'

export type Theme = 'dark' | 'light' | 'system'
export type Accent = 'green' | 'gray' | 'amber' | 'coral'
export type TextSize = 'small' | 'normal' | 'large'
export type Language = 'ru' | 'en'

export interface VisualPreferences {
  readonly theme: Theme
  readonly accent: Accent
  readonly size: TextSize
  readonly language: Language
}

export const defaultVisual: VisualPreferences = Object.freeze({
  theme:'dark',accent:'green',size:'normal',language:'ru',
})
export const accentColors: Readonly<Record<Accent,string>> = {
  green:'#1ed760', gray:'#a2aba3', amber:'#e7bb65', coral:'#ef9381',
}
export const visualChoices = {
  theme:['dark','light','system'],
  accent:['green','gray','amber','coral'],
  size:['small','normal','large'],
  language:['ru','en'],
} as const

function deviceStorage():AppearanceStorage|null{
  try{return typeof window==='undefined'?null:window.localStorage}
  catch{return null}
}
export function validateVisual(raw:unknown):VisualPreferences|null{
  if(!raw||typeof raw!=='object'||Array.isArray(raw))return null
  const v=raw as Record<string,unknown>
  if(Object.keys(v).sort().join('|')!=='accent|language|size|theme'
    ||!visualChoices.theme.includes(v.theme as Theme)
    ||!visualChoices.accent.includes(v.accent as Accent)
    ||!visualChoices.size.includes(v.size as TextSize)
    ||!visualChoices.language.includes(v.language as Language))return null
  return {theme:v.theme as Theme,accent:v.accent as Accent,
    size:v.size as TextSize,language:v.language as Language}
}

export function readVisual(storage:AppearanceStorage|null=deviceStorage()):VisualPreferences{
  if(!storage)return {...defaultVisual}
  try{
    const raw=storage.getItem(appearanceStorageKey)
    if(!raw)return {...defaultVisual}
    const parsed:unknown=JSON.parse(raw)
    if(!parsed||typeof parsed!=='object'||Array.isArray(parsed))return {...defaultVisual}
    const bundle=parsed as Record<string,unknown>
    if(!validateAppearance(bundle))return {...defaultVisual}
    return validateVisual(bundle.visual)??{...defaultVisual}
  }catch{return {...defaultVisual}}
}
export const savedVisual = shallowRef<VisualPreferences>(readVisual())
export const displayedVisual = shallowRef<VisualPreferences>({...savedVisual.value})

function resolveScheme(v:VisualPreferences):'dark'|'light' {
  if(v.theme!=='system')return v.theme
  try{return window.matchMedia('(prefers-color-scheme: light)').matches?'light':'dark'}
  catch{return 'dark'}
}
function apply(v:VisualPreferences):void{
  if(typeof document==='undefined')return
  const root=document.documentElement
  const scheme=resolveScheme(v)
  root.dataset.uiScheme=scheme
  root.lang=v.language
  root.style.setProperty('--accent',accentColors[v.accent])
  root.style.setProperty('--ui-text-scale',v.size==='small'?'0.92':v.size==='large'?'1.12':'1')
  // System colors are only design tokens: never invert/alter real camera or ciphertext media.
  root.style.setProperty('--background',scheme==='light'?'#f5f6f4':'#121212')
  root.style.setProperty('--header',scheme==='light'?'#eaeeeb':'#181818')
  root.style.setProperty('--surface',scheme==='light'?'#ffffff':'#202020')
  root.style.setProperty('--outline',scheme==='light'?'#ced6d0':'#303030')
  root.style.color=scheme==='light'?'#1a231b':'#f3f3f3'
}
export function previewVisual(raw:unknown):boolean{
  const next=validateVisual(raw)
  if(!next)return false
  displayedVisual.value=next
  apply(next)
  return true
}
export function restoreVisual():void{
  displayedVisual.value={...savedVisual.value}
  apply(savedVisual.value)
}
let initialized=false
export function initializeVisualAppearance():void{
  restoreVisual()
  if(initialized||typeof window==='undefined'||!window.matchMedia)return
  initialized=true
  window.matchMedia('(prefers-color-scheme: light)').addEventListener?.('change',()=>{
    if(displayedVisual.value.theme==='system')apply(displayedVisual.value)
  })
}

/**
 * Persist Dock, start route and all visual choices in ONE validated v2 localStorage
 * document. Existing v1 Dock / v2 Launch data remains readable. No secrets stored.
 */
export function saveCompleteAppearance(
  dock:unknown, launch:unknown, visual:unknown,
  storage:AppearanceStorage|null=deviceStorage(),
):boolean{
  const base=validateAppearance({version:2,dock,launch})
  const prefs=validateVisual(visual)
  if(!base||!prefs||!storage||!validateDock(base.dock))return false
  try{
    storage.setItem(appearanceStorageKey,JSON.stringify({...base,visual:prefs}))
  }catch{return false}
  savedDock.value=[...base.dock]
  displayedDock.value=[...base.dock]
  savedLaunch.value=base.launch as LaunchPage
  savedVisual.value=prefs
  displayedVisual.value=prefs
  apply(prefs)
  return true
}
