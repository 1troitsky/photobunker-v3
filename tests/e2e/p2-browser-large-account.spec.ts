import {expect,test} from '@playwright/test'

/**
 * Issue #194: Stress opaque indices and independently encrypted synthetic metadata.
 * Synthetic index rows are NOT server-authorized E2EE media; the second test
 * separately proves real PG18/Garage ciphertext authorization/decryption.
 */
test('P2 Browser 10k+ metadata: AES-GCM fixtures, 201 cursor pages, bounded search, stable sort',async({browser})=>{
  test.setTimeout(200000)
  const context=await browser.newContext()
  const page=await context.newPage()
  try{
    await page.goto('/settings')
    await expect(page.locator('body')).toBeVisible()
    const result=await page.evaluate(async()=>{
      const {appendAuthenticatedCatalogPage}=await import(
        '/src/features/browser/application/authenticated-catalog-page.ts')
      const {loadBoundedCatalogIndex}=await import(
        '/src/features/browser/application/bounded-catalog-expansion.ts')
      const {buildCatalog,filterCatalog,scopeCatalogFolders}=await import(
        '/src/features/browser/application/catalog.ts')
      const started=performance.now()
      const TOTAL=10051
      const id=(n:number)=>'00000000-0000-4000-8000-'+n.toString(16).padStart(12,'0')
      const rows=Array.from({length:TOTAL},(_,i)=>({
        mediaId:id(i+1),
        mediaType:(i%3===0?'photo':i%3===1?'video':'audio') as 'photo'|'video'|'audio',
        plainBytes:8192+i%701,
        expiresAt:Date.now()+86400000+(i%31)*86400000,
      }))
      const key=await crypto.subtle.generateKey({name:'AES-GCM',length:256},
        false,['encrypt','decrypt'])
      const encoder=new TextEncoder()
      const encrypted:Array<{nonce:Uint8Array,cipher:Uint8Array}>=[]
      let cryptoBytes=0
      // Explicit batch bound prevents unbounded concurrent WebCrypto promises.
      for(let offset=0;offset<TOTAL;offset+=100){
        const batch=await Promise.all(rows.slice(offset,offset+100).map(async(row,i)=>{
          const nonce=crypto.getRandomValues(new Uint8Array(12))
          const privateMetadata=encoder.encode(JSON.stringify({
            fileName:'SYNTHETIC-PRIVATE-'+row.mediaId+'.wav',
            folder:'PRIVATE-FOLDER-'+String((offset+i)%257),
            tag:'NOT-FOR-SERVER',
          }))
          const cipher=new Uint8Array(await crypto.subtle.encrypt(
            {name:'AES-GCM',iv:nonce},key,privateMetadata))
          return {nonce,cipher}
        }))
        for(const item of batch){
          encrypted.push(item)
          cryptoBytes+=item.cipher.byteLength
        }
      }
      const decoded=new TextDecoder().decode(await crypto.subtle.decrypt(
        {name:'AES-GCM',iv:encrypted[517]!.nonce},
        key,encrypted[517]!.cipher))
      if(!decoded.includes('SYNTHETIC-PRIVATE-'+id(518)))
        throw Error('Synthetic AES-GCM round trip failed')
      const noPlaintextIndex=JSON.stringify(rows).includes('SYNTHETIC-PRIVATE-')===false
      const getId=(item:{mediaId:string})=>item.mediaId
      type Row=typeof rows[number]
      let accumulated:Row[]=[]
      let cursor:string|null=null
      let pages=0
      const allSeen=new Set<string>()
      for(let offset=0;offset<TOTAL;offset+=50){
        const items=rows.slice(offset,offset+50)
        const nextCursor=offset+50<TOTAL?items[items.length-1]!.mediaId:null
        const checked=appendAuthenticatedCatalogPage(
          accumulated,{items,nextCursor},cursor,getId)
        // Cursor is not a count: must advance exactly once per validated page.
        for(const item of items){
          if(allSeen.has(item.mediaId))throw Error('Duplicate index item accepted')
          allSeen.add(item.mediaId)
        }
        if(checked.items.length!==offset+items.length)
          throw Error('Catalog page skipped or duplicated entries')
        accumulated=checked.items
        cursor=checked.nextCursor
        pages++
      }
      if(cursor!==null||allSeen.size!==TOTAL||accumulated.length!==TOTAL)
        throw Error('Cursor traversal incomplete')
      const catalog=buildCatalog([],[],[],accumulated)
      const largest=filterCatalog(catalog,{type:'all',query:'',sort:'size-largest'})
      const smallest=filterCatalog(catalog,{type:'all',query:'',sort:'size-smallest'})
      if(largest.length!==TOTAL||smallest.length!==TOTAL
        ||largest[0]!.bytes!<largest[largest.length-1]!.bytes!
        ||smallest[0]!.bytes!>smallest[smallest.length-1]!.bytes!)
        throw Error('Size sort lost items or order')
      const matches=new Set([catalog[517]!.key])
      const query='not-for-server'
      const withoutPrivate=filterCatalog(catalog,{type:'all',query,sort:'newest'})
      const withPrivate=filterCatalog(catalog,{type:'all',query,sort:'newest',
        privateMatches:matches})
      if(withoutPrivate.length!==0||withPrivate.length!==1
        ||withPrivate[0]!.key!==catalog[517]!.key)
        throw Error('Private search matched unexpected opaque rows')
      const placement:Record<string,string>={}
      for(let i=0;i<catalog.length;i++)
        placement[catalog[i]!.key]='virtual-folder-'+String(i%257)
      const oneFolder=scopeCatalogFolders(catalog,placement,'virtual-folder-8',false)
      const everyFolder=scopeCatalogFolders(catalog,placement,'virtual-folder-8',true)
      if(oneFolder.length!==Math.floor(TOTAL/257)+(8<TOTAL%257?1:0)
        ||everyFolder.length!==TOTAL)
        throw Error('Folder scoping dropped or expanded index incorrectly')
      // Opt-in extended search is intentionally capped at 10 x 50 rows.
      let networkPages=0
      const bounded=await loadBoundedCatalogIndex(
        async(after?:string)=>{
          const start=after===undefined?0:parseInt(after.slice(-12),16)
          const items=rows.slice(start,start+50)
          networkPages++
          return {items,nextCursor:start+50<TOTAL?items[items.length-1]!.mediaId:null}
        },getId,()=>true,10)
      if(bounded.items.length!==500||bounded.complete||bounded.pages!==10
        ||networkPages!==10||!bounded.nextCursor)
        throw Error('Search scanned beyond bounded 10-page window')
      let duplicateRejected=false
      try{
        appendAuthenticatedCatalogPage(
          accumulated,{items:[rows[0]!],nextCursor:null},null,getId)
      }catch(e){duplicateRejected=(e as Error).message==='browser.invalid_cloud_catalog_page'}
      let replayRejected=false
      try{
        appendAuthenticatedCatalogPage(
          rows.slice(0,50),{items:rows.slice(0,50),nextCursor:id(50)},id(50),getId)
      }catch(e){replayRejected=(e as Error).message==='browser.invalid_cloud_catalog_page'}
      let cursorRollbackRejected=false
      try{
        appendAuthenticatedCatalogPage(
          rows.slice(0,50),{items:rows.slice(50,100),nextCursor:id(49)},id(50),getId)
      }catch(e){cursorRollbackRejected=(e as Error).message==='browser.invalid_cloud_catalog_page'}
      let malformedPageRejected=false
      try{
        appendAuthenticatedCatalogPage(
          rows.slice(0,50),{items:rows.slice(50,101),nextCursor:id(101)},id(50),getId)
      }catch(e){malformedPageRejected=(e as Error).message==='browser.invalid_cloud_catalog_page'}
      if(!duplicateRejected||!replayRejected||!cursorRollbackRejected
        ||!malformedPageRejected||!noPlaintextIndex)
        throw Error('Unsafe index accepted, or private metadata leaked into index')
      return {
        total:TOTAL,pages,validated:allSeen.size,encryptedMetadata:encrypted.length,
        aesGcmCipherBytes:cryptoBytes,virtualFolders:257,
        narrowedFolder:oneFolder.length,privateHits:withPrivate.length,
        opaqueHits:withoutPrivate.length,boundedPages:networkPages,
        boundedRows:bounded.items.length,replayRejected,cursorRollbackRejected,
        malformedPageRejected,duplicateRejected,noPlaintextIndex,
        elapsedMs:Math.round(performance.now()-started),
        maxConcurrentCryptoJobs:100,
      }
    })
    expect(result.total).toBe(10051)
    expect(result.pages).toBe(202)
    expect(result.validated).toBe(result.total)
    expect(result.encryptedMetadata).toBe(result.total)
    expect(result.noPlaintextIndex).toBe(true)
    expect(result.boundedRows).toBe(500)
    expect(result.aesGcmCipherBytes).toBeGreaterThan(result.total*32)
    // Metrics are counts and elapsed time only: emit safe CI log evidence.
    console.log('PB3_QA_194_SYNTHETIC_10K '+JSON.stringify(result))
    await test.info().attach('10k-synthetic-index-metrics.json',{
      body:JSON.stringify(result,null,2),contentType:'application/json'})
  }finally{await context.close()}
})

test('P2 Browser: 10k index cannot grant access; real E2EE deep link page 2 is server-authorized',async({browser})=>{
  test.setTimeout(190000)
  const aContext=await browser.newContext(),bContext=await browser.newContext()
  const a=await aContext.newPage(),b=await bContext.newPage()
  const secretName='LARGE-ACCOUNT-REAL-E2EE.wav'
  const id=(n:number)=>'00000000-0000-4000-8000-'+n.toString(16).padStart(12,'0')
  const opaque=(n:number)=>({
    mediaId:id(n),mediaType:'audio',plainBytes:8192,
    expiresAt:Date.now()+3600000,
  })
  try{
    await a.goto('/settings')
    await a.getByRole('button',{name:'Создать ключ'}).click()
    const recoveryKey=await a.locator('#generated-key').inputValue()
    await a.getByLabel('Я сохранил ключ восстановления').check()
    await a.getByRole('button',{name:'Завершить регистрацию'}).click()
    await expect(a.getByText('Подтверждённая сессия')).toBeVisible()
    await a.goto('/browser')
    const picker=a.getByTestId('media-import-file')
    await expect(picker).toBeEnabled({timeout:30000})
    await picker.setInputFiles({
      name:secretName,mimeType:'audio/wav',buffer:Buffer.alloc(8192,0x5a),
    })
    await expect(a.locator('.media-import-p1')
      .getByText('Файл зашифрован и сохранён на устройстве.'))
      .toBeVisible({timeout:30000})
    await a.evaluate(async()=>{
      const m=await import('/src/features/media/application/media-outbox.ts')
      await m.synchronizeMedia()
    })
    const mediaId=await a.evaluate(async()=>{
      const m=await import('/src/features/media/application/media-outbox.ts')
      const local=await m.listLocalMedia()
      if(local.length!==1||local[0]!.state!=='synced')
        throw Error('Genuine cloud ACK missing')
      return local[0]!.mediaId
    })
    await b.goto('/settings')
    await b.locator('#recovery-key').fill(recoveryKey)
    await b.getByRole('button',{name:'Восстановить',exact:true}).click()
    await expect(b.getByText('Подтверждённая сессия')).toBeVisible()
    // Read the real, account-authorized cloud index BEFORE injecting hostile
    // synthetic index rows; the fake rows never carry manifests or keys.
    const authentic=await b.evaluate(async()=>{
      const m=await import('/src/features/media/application/media-outbox.ts')
      return (await m.listCloudMedia()).items
    })
    expect(authentic).toHaveLength(1)
    expect(authentic[0]!.mediaId).toBe(mediaId)
    const requests:string[]=[]
    b.on('request',request=>{
      const url=request.url()
      if(url.includes('/media/v1')||url.includes('/photos/v1'))
        requests.push(url+(request.postData()??''))
    })
    let servedFirst=0,servedSecond=0
    await b.route(/\/media\/v1(?:\?after=[^#]*)?$/,async route=>{
      const after=new URL(route.request().url()).searchParams.get('after')
      if(after===null){
        servedFirst++
        await route.fulfill({status:200,contentType:'application/json',
          body:JSON.stringify({items:Array.from({length:50},(_,i)=>opaque(i+1)),
            nextCursor:id(50)})})
        return
      }
      expect(after).toBe(id(50))
      servedSecond++
      await route.fulfill({status:200,contentType:'application/json',
        body:JSON.stringify({items:[authentic[0]],nextCursor:null})})
    })
    await b.goto('/browser/file/media/'+mediaId)
    await expect(b.getByTestId('file-viewer-audio'))
      .toBeVisible({timeout:40000})
    await expect(b.getByTestId('file-viewer-info'))
      .toContainText(secretName,{timeout:40000})
    await expect(b.getByTestId('file-viewer-position'))
      .toHaveText('51 / 51',{timeout:30000})
    expect(servedFirst).toBeGreaterThan(0)
    expect(servedSecond).toBeGreaterThan(0)
    const plain=await b.evaluate(async targetId=>{
      const m=await import('/src/features/media/application/media-outbox.ts')
      const file=await m.readCloudMedia(targetId)
      const bytes=new Uint8Array(await file.blob.arrayBuffer())
      return {name:file.metadata.fileName,size:bytes.length,
        first:bytes[0],last:bytes.at(-1)}
    },mediaId)
    expect(plain).toEqual({name:secretName,size:8192,first:0x5a,last:0x5a})
    // Synthetic non-existent ID cannot manufacture a valid signed manifest,
    // chunk, receipt or decryption capability for the recovered account.
    await b.unroute(/\/media\/v1(?:\?after=[^#]*)?$/)
    const fakeDenied=await b.evaluate(async fakeId=>{
      const m=await import('/src/features/media/application/media-outbox.ts')
      try{await m.readCloudMediaMetadata(fakeId);return false}
      catch(e){return /^api\.http_(403|404|410)$/.test((e as Error).message)}
    },id(1))
    expect(fakeDenied).toBe(true)
    expect(requests.join('\n')).not.toContain(secretName)
    expect(requests.join('\n')).not.toContain('SYNTHETIC-PRIVATE')
    console.log('PB3_QA_194_E2EE '+JSON.stringify({
      indexPage1:50,indexPage2:1,authenticMedia:true,
      decryptedBytes:plain.size,fakeIdDenied:true,requests:requests.length,
    }))
    await test.info().attach('real-e2ee-two-page-evidence.json',{
      body:JSON.stringify({actualCiphertextAccount:true,realMediaIdVerified:true,
        serverReceiptVerified:true,viewerPosition:'51 / 51',
        firstPageOpaqueRows:50,realSecondPageRows:1,
        fakeIdDenied:true,requestedEndpointCount:requests.length},null,2),
      contentType:'application/json'})
  }finally{await aContext.close();await bContext.close()}
})
