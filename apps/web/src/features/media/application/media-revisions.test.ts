import {describe,it,expect} from 'vitest'
import {
  freshPackage,importSigner,sign,
} from '../../identity/infrastructure/crypto'
import {sha} from '../../local-storage/infrastructure/cipher'
import {
  verifyMediaRevisionHistory,
} from './media-revisions'
import type {
  MediaRevisionContract,MediaRevisionHistory,MediaRevisionEvent,
} from './media-revisions'

const enc=new TextEncoder()
const domain='pb3.media-revision.v1\n'
async function fixture(){
  const {pkg}=await freshPackage(crypto.randomUUID())
  const root=crypto.randomUUID()
  const second=crypto.randomUUID()
  const third=crypto.randomUUID()
  const hashes=['a'.repeat(64),'b'.repeat(64),'c'.repeat(64)]
  const signer=await importSigner(pkg.accountPkcs8)
  async function event(
    fromRevision:number,previousMediaId:string,newMediaId:string,
    previousContractHash:string,newContractHash:string,
  ):Promise<MediaRevisionEvent>{
    const c:MediaRevisionContract={
      version:1,linkId:crypto.randomUUID(),operationId:crypto.randomUUID(),
      accountId:pkg.accountId,rootMediaId:root,
      previousMediaId,newMediaId,
      rootContractHash:hashes[0]!,previousContractHash,newContractHash,
      fromRevision,toRevision:fromRevision+1,
    }
    const contract=JSON.stringify(c)
    return {
      contract,signature:await sign(signer,domain+contract),
      contractHash:await sha(enc.encode(contract)),
    }
  }
  const first=await event(1,root,second,hashes[0]!,hashes[1]!)
  const last=await event(2,second,third,hashes[1]!,hashes[2]!)
  const history:MediaRevisionHistory={
    rootMediaId:root,rootContractHash:hashes[0]!,
    revision:3,headMediaId:third,events:[first,last],
  }
  return {pkg,root,second,third,history,first,last,hashes,event}
}
describe('P1-12 signed owner MediaRevision audit chain',()=>{
  it('accepts two linear immutable version links and preserves original references',async()=>{
    const x=await fixture()
    const versions=await verifyMediaRevisionHistory(
      x.history,x.pkg.accountId,x.pkg.accountSpki,x.hashes[0])
    expect(versions).toEqual([
      {revision:1,mediaId:x.root,contractHash:x.hashes[0]},
      {revision:2,mediaId:x.second,contractHash:x.hashes[1]},
      {revision:3,mediaId:x.third,contractHash:x.hashes[2]},
    ])
  })
  it('rejects deleted, reordered, fake, wrong-owner and broken-root signed amendments',async()=>{
    const x=await fixture()
    const malformed=async(history:MediaRevisionHistory)=>
      verifyMediaRevisionHistory(history,x.pkg.accountId,
        x.pkg.accountSpki,x.hashes[0])
    await expect(malformed({...x.history,
      events:[x.last,x.first],
    })).rejects.toThrow()
    await expect(malformed({...x.history,
      events:[x.last],
    })).rejects.toThrow()
    await expect(malformed({...x.history,
      events:[x.first],
    })).rejects.toThrow()
    await expect(malformed({...x.history,
      headMediaId:crypto.randomUUID(),
    })).rejects.toThrow('media_revision.invalid_history')
    await expect(malformed({...x.history,
      rootContractHash:'f'.repeat(64),
    })).rejects.toThrow('media_revision.invalid_history')
    await expect(malformed({...x.history,events:[
      {...x.first,signature:'invalid'},x.last,
    ]})).rejects.toThrow()
    const c=JSON.parse(x.first.contract)
    c.newMediaId=crypto.randomUUID()
    const forged=JSON.stringify(c)
    await expect(malformed({...x.history,events:[{
      ...x.first,contract:forged,contractHash:await sha(enc.encode(forged)),
    },x.last]})).rejects.toThrow('media_revision.invalid_history')
    const foreign=await freshPackage(crypto.randomUUID())
    await expect(verifyMediaRevisionHistory(x.history,
      x.pkg.accountId,foreign.pkg.accountSpki))
      .rejects.toThrow('media_revision.invalid_history')
  })
  it('rejects even genuine owner-signed cycles and repeated media IDs',async()=>{
    const x=await fixture()
    const cycle=await x.event(2,x.second,x.root,x.hashes[1]!,x.hashes[0]!)
    await expect(verifyMediaRevisionHistory({...x.history,
      headMediaId:x.root,events:[x.first,cycle],
    },x.pkg.accountId,x.pkg.accountSpki))
      .rejects.toThrow('media_revision.invalid_history')
  })
})
