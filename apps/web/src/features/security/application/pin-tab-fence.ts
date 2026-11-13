/**
 * Best-effort cross-tab *notification*, NOT authorization or a revocation
 * protocol. PIN, keys, ciphertext and recovery material are never sent.
 *
 * A message only prompts the receiver to re-read its own IndexedDB row.
 * No action may be taken solely because a foreign tab sent a string. This
 * does not reach suspended tabs/workers or already-copied account packages.
 */
const CHANNEL='photobunker.identity.pin-seal.v1'

export type PinSealNotice=Readonly<{
  v:1
  kind:'pin-sealed'
  accountId:string
  deviceId:string
}>

function validScope(accountId:unknown,deviceId:unknown):
  accountId is string {
  return typeof accountId==='string' &&
    /^[A-Za-z0-9-]{8,64}$/.test(accountId) &&
    typeof deviceId==='string' &&
    /^[A-Za-z0-9-]{8,64}$/.test(deviceId)
}

function parseNotice(value:unknown):PinSealNotice|null {
  if(!value||typeof value!=='object'||Array.isArray(value))return null
  const obj=value as Record<string,unknown>
  if(Object.keys(obj).sort().join('|')!==
    ['accountId','deviceId','kind','v'].sort().join('|') ||
    obj.v!==1 || obj.kind!=='pin-sealed' ||
    !validScope(obj.accountId,obj.deviceId))return null
  return {
    v:1,kind:'pin-sealed',
    accountId:obj.accountId as string,
    deviceId:obj.deviceId as string,
  }
}

/** Call after a SUCCESSFUL durable devices-row seal transaction only. */
export function publishPinDeviceSealed(scope:{
  accountId:string
  deviceId:string
}):boolean {
  if(!validScope(scope.accountId,scope.deviceId) ||
     typeof BroadcastChannel==='undefined')return false
  let channel:BroadcastChannel|undefined
  try{
    channel=new BroadcastChannel(CHANNEL)
    const notice:PinSealNotice={
      v:1,kind:'pin-sealed',
      accountId:scope.accountId,deviceId:scope.deviceId,
    }
    channel.postMessage(notice)
    return true
  }catch{
    // This is advisory only. No false claim that the other tab was locked.
    return false
  }finally{
    channel?.close()
  }
}

/**
 * Receivers MUST revalidate a persisted sealed row before dropping or
 * replacing their active Session. This callback itself has no authority.
 */
export function watchPinDeviceSealed(
  onHint:(notice:PinSealNotice)=>void,
):()=>void {
  if(typeof BroadcastChannel==='undefined')return ()=>{}
  let channel:BroadcastChannel
  try{channel=new BroadcastChannel(CHANNEL)}
  catch{return ()=>{}}
  let disposed=false
  channel.onmessage=(event:MessageEvent<unknown>)=>{
    if(disposed)return
    const notice=parseNotice(event.data)
    if(notice)onHint(notice)
  }
  return ()=>{
    disposed=true
    channel.onmessage=null
    channel.close()
  }
}
