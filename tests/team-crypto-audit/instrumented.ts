import {test as base,expect} from '@playwright/test'
import {writeFileSync} from 'node:fs'
import {join} from 'node:path'
// Record transport metadata only. No cookies, headers with credentials,
// request/response bodies, plaintext, identities or ciphertext are exported.
export const test=base.extend({browser:[async({browser},use,workerInfo)=>{
  const events:unknown[]=[]
  const original=browser.newContext.bind(browser)
  browser.newContext=async(...args)=>{
    const context=await original(...args)
    context.on('page',page=>page.on('response',async response=>{
      const path=new URL(response.url()).pathname
      if(!/^\/(identity|assignments|media-shares)\/v[12]\//.test(path))return
      const request=response.request()
      const event:Record<string,unknown>={at:Date.now(),path:path.replace(/[a-f0-9]{8}-[a-f0-9-]{27,}/g,':id'),
        method:request.method(),status:response.status(),accept:request.headers().accept??null,
        mime:response.headers()['content-type']??null}
      if(response.status()===422&&path==='/media-shares/v1/grants'){
        try{const c=JSON.parse(request.postDataJSON().contract)
          event.grant={version:c.version,scope:c.scope,expiryMinusHostMs:c.expiresAt-Date.now(),
            selfRecipient:c.ownerAccountId===c.recipientAccountId,
            signatureChars:request.postDataJSON().signature.length}}
        catch{event.grantParseError=true}
      }
      events.push(event)
    }))
    return context
  }
  await use(browser)
  browser.newContext=original
  writeFileSync(join(process.env.PB3_ACCEPTANCE_ARTIFACTS!,'media-network-'+workerInfo.workerIndex+'.json'),JSON.stringify(events),{mode:0o600})
},{scope:'worker'}]})
export {expect}
