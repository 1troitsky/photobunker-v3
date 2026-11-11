import type {StoredPhoto,CloudPhoto} from '../../photo-sync/application/p1-photo'
import type {StoredMedia,CloudMedia} from '../../media/application/media-outbox'

export type CatalogType='photo'|'video'|'audio'
export type CatalogFilter='all'|CatalogType
export type CatalogSort='newest'|'oldest'|'expiry'|'size-largest'|'size-smallest'
export type CatalogView='list'|'grid'

export type CatalogItem={
  key:string
  id:string
  type:CatalogType
  local:boolean
  cloud:boolean
  state:'queued'|'retry'|'synced'|'conflict'|null
  createdAt:number|null
  expiresAt:number
  bytes:number|null
  source:'photo'|'media'
}

/**
 * Read-only union of two existing encrypted outbox protocols and their
 * authoritative server indexes. No plaintext file names, tags or GPS are
 * indexed; cloud-only rows never masquerade as locally available.
 */
export function buildCatalog(
  localPhotos:readonly StoredPhoto[],cloudPhotos:readonly CloudPhoto[],
  localMedia:readonly StoredMedia[],cloudMedia:readonly CloudMedia[],
):CatalogItem[]{
  const rows=new Map<string,CatalogItem>()
  for(const p of localPhotos){
    const key='photo:'+p.photoId
    rows.set(key,{
      key,id:p.photoId,type:'photo',local:true,cloud:false,
      state:p.state,createdAt:p.createdAt,expiresAt:p.expiresAt,
      bytes:null,source:'photo',
    })
  }
  for(const p of cloudPhotos){
    const key='photo:'+p.photoId
    const old=rows.get(key)
    if(old)rows.set(key,{...old,cloud:true})
    else rows.set(key,{
      key,id:p.photoId,type:'photo',local:false,cloud:true,
      state:null,createdAt:null,expiresAt:p.expiresAt,
      bytes:null,source:'photo',
    })
  }
  for(const m of localMedia){
    const key='media:'+m.mediaId
    rows.set(key,{
      key,id:m.mediaId,type:m.mediaType,local:true,cloud:false,
      state:m.state,createdAt:m.createdAt,expiresAt:m.expiresAt,
      bytes:m.plainBytes,source:'media',
    })
  }
  for(const m of cloudMedia){
    const key='media:'+m.mediaId
    const old=rows.get(key)
    if(old)rows.set(key,{...old,cloud:true})
    else rows.set(key,{
      key,id:m.mediaId,type:m.mediaType,local:false,cloud:true,
      state:null,createdAt:null,expiresAt:m.expiresAt,
      bytes:m.plainBytes,source:'media',
    })
  }
  return [...rows.values()]
}

export function filterCatalog(
  rows:readonly CatalogItem[],options:{
    type:CatalogFilter;query:string;sort:CatalogSort
    privateMatches?:ReadonlySet<string>
  },
):CatalogItem[]{
  const query=options.query.trim().toLowerCase()
  return rows
    .filter(row=>(options.type==='all'||row.type===options.type)
      &&(!query||row.id.toLowerCase().includes(query)
        ||options.privateMatches?.has(row.key)===true))
    .sort((a,b)=>{
      const byId=a.key.localeCompare(b.key)
      if(options.sort==='expiry')
        return a.expiresAt-b.expiresAt||byId
      if(options.sort==='size-largest'||options.sort==='size-smallest'){
        // Photo indexes do not expose reliable plaintext byte counts.
        // Unknown/malformed values sort LAST in either direction. Never
        // invent a zero-byte value or download plaintext for sorting.
        const aa=a.bytes!==null&&Number.isSafeInteger(a.bytes)&&a.bytes>=0
          ?a.bytes:null
        const bb=b.bytes!==null&&Number.isSafeInteger(b.bytes)&&b.bytes>=0
          ?b.bytes:null
        if(aa===null&&bb!==null)return 1
        if(aa!==null&&bb===null)return -1
        if(aa!==null&&bb!==null&&aa!==bb)
          return options.sort==='size-largest'?bb-aa:aa-bb
        return byId
      }
      // Cloud-only list endpoints expose neither name nor creation time.
      // Keep unknown timestamps AFTER known timestamps in both directions.
      const aa=a.createdAt,bb=b.createdAt
      if(aa===null&&bb!==null)return 1
      if(aa!==null&&bb===null)return -1
      if(aa!==null&&bb!==null&&aa!==bb)
        return options.sort==='newest'?bb-aa:aa-bb
      return byId
    })
}

/**
 * Pure presentation scope over an already authenticated and loaded catalog.
 * "All folders" never fetches additional server pages or broadens ACLs;
 * it only disables the virtual folder placement filter for visible rows.
 */
export function scopeCatalogFolders(
  rows:readonly CatalogItem[],
  placements:Readonly<Record<string,string>>,
  selectedFolder:string|null,
  allLoadedFolders:boolean,
):CatalogItem[]{
  return allLoadedFolders?[...rows]
    :rows.filter(row=>(placements[row.key]??null)===selectedFolder)
}
