import type {CatalogItem} from './catalog'
import {filterCatalog} from './catalog'

export type ViewerTarget={protocol:'photo'|'media';id:string}
const uuid=/^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i

/**
 * A Viewer URL may contain only an opaque known-protocol UUID.
 * Names, coordinates, categories, recovery material and signed contracts
 * never belong in route parameters or query strings.
 */
export function parseViewerTarget(protocol:unknown,id:unknown):ViewerTarget|null{
  if((protocol!=='photo'&&protocol!=='media')
    ||typeof id!=='string'||!uuid.test(id))return null
  return {protocol,id:id.toLowerCase()}
}
export function viewerKey(target:ViewerTarget):string{
  return target.protocol+':'+target.id
}
export function adjacentFiles(
  rows:readonly CatalogItem[],target:ViewerTarget,
):{previous:CatalogItem|null;next:CatalogItem|null;position:number;total:number}{
  const ordered=filterCatalog(rows,{type:'all',query:'',sort:'newest'})
  const index=ordered.findIndex(row=>row.key===viewerKey(target))
  return {
    previous:index>0?ordered[index-1]??null:null,
    next:index>=0?ordered[index+1]??null:null,
    position:index>=0?index+1:0,
    total:ordered.length,
  }
}
export function safeDownloadName(value:string,fallback:string):string{
  const clean=value
    .replace(/[\\/<>:"|?*\u0000-\u001f\u007f]/g,'_')
    .replace(/^\.+/,'').replace(/[. ]+$/,'')
    .trim().slice(0,120)
  return clean||fallback
}
