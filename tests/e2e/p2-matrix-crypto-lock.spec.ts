import {test,expect} from '@playwright/test'

test('P2 RustCrypto Web Locks: two same-origin tabs cannot share one store',async({browser})=>{
  test.setTimeout(90_000)
  const context=await browser.newContext()
  const first=await context.newPage()
  const second=await context.newPage()
  const scope='pb3-matrix-'+'e'.repeat(64)
  try{
    await first.goto('/messages')
    await second.goto('/messages')
    // Exercise the actual browser lock manager, not an in-memory mock.
    await first.evaluate(async key=>{
      const {acquireMatrixCryptoLease}=await import(
        '/src/features/messages/application/matrix-crypto-lease.ts')
      const lease=await acquireMatrixCryptoLease(key)
      ;(window as Window & {pb3MatrixTestLease?:typeof lease})
        .pb3MatrixTestLease=lease
    },scope)
    const conflict=await second.evaluate(async key=>{
      const {acquireMatrixCryptoLease}=await import(
        '/src/features/messages/application/matrix-crypto-lease.ts')
      try{
        const lease=await acquireMatrixCryptoLease(key)
        await lease.release()
        return 'INCORRECTLY_ACQUIRED'
      }catch(e){return e instanceof Error?e.message:'unexpected'}
    },scope)
    expect(conflict).toBe('matrix.crypto_store_in_use')

    await first.evaluate(async()=>{
      const target=window as Window & {
        pb3MatrixTestLease?:{release():Promise<void>}
      }
      await target.pb3MatrixTestLease?.release()
      delete target.pb3MatrixTestLease
    })
    const secondAcquired=await second.evaluate(async key=>{
      const {acquireMatrixCryptoLease}=await import(
        '/src/features/messages/application/matrix-crypto-lease.ts')
      const lease=await acquireMatrixCryptoLease(key)
      await lease.release()
      return true
    },scope)
    expect(secondAcquired).toBe(true)
  }finally{
    await first.close()
    await second.close()
    await context.close()
  }
})
