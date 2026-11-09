// PB2 AES-GCM frame contract, reused with an isolated PB3 local vault.
export type AssetKind = 'master'|'original'|'edit'|'thumbnail'|'metadata'
export type Scope = Readonly<{ accountId:string; deviceId:string; generation:number }>
export type StorageBackend = 'opfs'|'idb-blob'
export type WrappedDEK = Readonly<{iv:string;ciphertext:string}>
export type CipherFrame = Readonly<{
  index:number; offset:number; bytes:number; plainBytes:number; iv:string; digest:string
}>
export type CipherManifest = Readonly<{
  version:1; algorithm:'AES-256-GCM'; chunkBytes:number
  accountId:string; photoId:string; assetId:string; kind:AssetKind
  revision:number; expiresAt:number; plainBytes:number; cipherBytes:number
  frames:CipherFrame[]; cipherDigest:string; wrappedDEK:WrappedDEK
  backend:StorageBackend; storageKey:string
}>
