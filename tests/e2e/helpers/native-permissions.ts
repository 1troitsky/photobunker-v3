import {expect,type Page} from '@playwright/test'

/** Real Chromium permission revocation, scoped to GPS in THIS browser context.
 * clearPermissions() also revokes camera on macOS and ends the native stream;
 * that tests camera loss instead of the intended stale-GPS security boundary.
 * No navigator result, permission status or application state is mocked.
 */
export async function revokeGeolocation(page:Page):Promise<void>{
  const cdp=await page.context().newCDPSession(page)
  try{
    const {targetInfo}=await cdp.send('Target.getTargetInfo')
    await cdp.send('Browser.setPermission',{
      permission:{name:'geolocation'},setting:'denied',
      origin:new URL(page.url()).origin,browserContextId:targetInfo.browserContextId,
    })
  }finally{await cdp.detach()}
  await expect.poll(()=>page.evaluate(async()=>
    (await navigator.permissions.query({name:'geolocation'})).state)).not.toBe('granted')
  await expect.poll(()=>page.locator('video').evaluate(video=>{
    const stream=(video as HTMLVideoElement).srcObject as MediaStream|null
    return stream?.getVideoTracks().some(track=>track.readyState==='live')??false
  })).toBe(true)
}
