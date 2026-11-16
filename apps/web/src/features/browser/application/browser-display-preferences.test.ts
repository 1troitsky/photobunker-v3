import {describe,expect,it} from 'vitest'
import {
  BROWSER_OPEN_FIRST_KEY,BROWSER_FOLDERS_FIRST_KEY,
  readBrowserOpeningSection,readBrowserFoldersFirst,
  saveBrowserOpeningSection,saveBrowserFoldersFirst,
} from './browser-display-preferences'

describe('Browser v3 local presentation choices',()=>{
  it('defaults to the existing safe All section and folders above files',()=>{
    const data=new Map<string,string>()
    const store={
      getItem:(key:string)=>data.get(key)??null,
      setItem:(key:string,val:string)=>{data.set(key,val)},
    }
    expect(readBrowserOpeningSection(store)).toBe('all')
    expect(readBrowserFoldersFirst(store)).toBe(true)
    expect(saveBrowserOpeningSection('personal',store)).toBe(true)
    expect(readBrowserOpeningSection(store)).toBe('personal')
    expect(saveBrowserOpeningSection('assignments',store)).toBe(true)
    expect(readBrowserOpeningSection(store)).toBe('assignments')
    expect(saveBrowserOpeningSection('archive',store)).toBe(true)
    expect(readBrowserOpeningSection(store)).toBe('archive')
    expect(saveBrowserFoldersFirst(false,store)).toBe(true)
    expect(readBrowserFoldersFirst(store)).toBe(false)
    expect(saveBrowserFoldersFirst(true,store)).toBe(true)
    expect(readBrowserFoldersFirst(store)).toBe(true)
    expect([...data.keys()].sort()).toEqual([
      BROWSER_FOLDERS_FIRST_KEY,BROWSER_OPEN_FIRST_KEY,
    ].sort())
    expect([...data.values()]).not.toContain('photo:')
  })
  it('refuses malformed or blocked storage without losing access to catalog',()=>{
    const blocked={
      getItem:()=>{throw Error('disabled')},
      setItem:()=>{throw Error('disabled')},
    }
    expect(readBrowserOpeningSection(blocked)).toBe('all')
    expect(readBrowserFoldersFirst(blocked)).toBe(true)
    expect(saveBrowserOpeningSection('personal',blocked)).toBe(false)
    expect(saveBrowserFoldersFirst(false,blocked)).toBe(false)
    const malformed={
      getItem:(key:string)=>key===BROWSER_OPEN_FIRST_KEY?'../../private':
        'definitely not a boolean',
      setItem:()=>{},
    }
    expect(readBrowserOpeningSection(malformed)).toBe('all')
    expect(readBrowserFoldersFirst(malformed)).toBe(true)
  })
})
