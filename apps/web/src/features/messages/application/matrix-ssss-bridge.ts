import type {MatrixClient} from 'matrix-js-sdk'
import type {CryptoCallbacks} from 'matrix-js-sdk/lib/crypto-api'
import {activeSession,requireSession} from '../../identity/application/session'
import {recoverMatrixSecretStorageKey} from './matrix-recovery-escrow'
import {getBoundMatrixCredentials} from './matrix-binding'

/**
 * P2-02D3: Matrix SDK CryptoCallbacks.getSecretStorageKey bridge.
 *
 * Recovery is PB3-root-signed + AKEK-unsealed, but that ALONE cannot prove
 * that the key unlocks the CURRENT Matrix 4S account data. Check the SDK's
 * independently fetched default key id and authenticated key MAC before
 * handing any key bytes to Rust Crypto. Never auto-create/rotate Matrix 4S.
 */
type SsssCallback=NonNullable<CryptoCallbacks['getSecretStorageKey']>
type OfferedKeys=Parameters<SsssCallback>[0]
const algorithm='m.secret_storage.v1.aes-hmac-sha2'
const secrets=new Set([
  'm.cross_signing.master','m.cross_signing.self_signing',
  'm.cross_signing.user_signing','m.megolm_backup.v1',
])

export async function getVerifiedPB3Matrix4SKey(
  client:MatrixClient,offered:OfferedKeys,name:string,
):ReturnType<SsssCallback>{
  const s=requireSession()
  if(!s.online||(typeof navigator!=='undefined'&&navigator.onLine===false))
    throw Error('matrix.ssss_pb3_offline')
  // Only cross-signing / backup secret names are eligible; other
  // undocumented Matrix extension secrets require explicit review.
  if(!secrets.has(name))return null
  const checked=()=>{
    const now=activeSession.value
    if(!now||!now.online||now.accountId!==s.accountId
      ||now.deviceId!==s.deviceId||now.pkg.revision!==s.pkg.revision
      ||now.pkg.akek!==s.pkg.akek
      ||now.pkg.accountSpki!==s.pkg.accountSpki)
      throw Error('matrix.ssss_session_changed')
  }
  const bound=await getBoundMatrixCredentials()
  checked()
  if(!bound||client.getUserId()!==bound.contract.matrixUserId
    ||client.getDeviceId()!==bound.contract.matrixDeviceId
    ||client.baseUrl!==bound.contract.homeserverUrl)
    throw Error('matrix.ssss_device_binding_mismatch')
  let publicKey:Awaited<ReturnType<typeof client.secretStorage.getKey>>
  try{publicKey=await client.secretStorage.getKey()}
  catch{throw Error('matrix.ssss_metadata_unavailable')}
  checked()
  if(!publicKey)throw Error('matrix.ssss_default_key_missing')
  const [keyId,info]=publicKey
  if(!keyId||info.algorithm!==algorithm
    ||!Object.prototype.hasOwnProperty.call(offered.keys,keyId)
    ||offered.keys[keyId]?.algorithm!==algorithm)
    throw Error('matrix.ssss_key_id_not_authorized')
  const raw=await recoverMatrixSecretStorageKey()
  checked()
  if(!raw)return null
  let allowed=false
  try{
    allowed=await client.secretStorage.checkKey(raw,info)
      &&await client.secretStorage.checkKey(raw,offered.keys[keyId]!)
    checked()
    if(!allowed)throw Error('matrix.ssss_wrong_key')
    // Ownership of these fresh bytes passes directly to the official SDK;
    // the wrapper never logs or persists them. SDK may retain a temporary
    // copy; the next integration must verify its lifetime on real devices.
    return [keyId,raw]
  }finally{
    if(!allowed)raw.fill(0)
  }
}
