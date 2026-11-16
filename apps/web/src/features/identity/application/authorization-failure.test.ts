import { afterEach, describe, expect, it } from 'vitest'
import { authFailure,clearAuthFailure,markInvalidRecoveryKey,authFailureCopy } from './authorization-failure'
afterEach(clearAuthFailure)
describe('approved Authorization Error 1.0: verified error admission',()=>{
 it('allows only proven local Recovery Key parsing errors',()=>{
  expect(markInvalidRecoveryKey(new Error('identity.invalid_checksum'))).toBe(true)
  expect(authFailure.value).toBe('key')
  expect(authFailureCopy.key.title).toBe('Вход с этим ключом невозможен')
 })
 it('never claims deleted, revoked or wiped on 401, timeout or network failure',()=>{
  for(const code of ['api.http_401','api.http_404','identity.offline',
    'identity.account_locked','identity.invalid_package','Failed to fetch']){
    clearAuthFailure()
    expect(markInvalidRecoveryKey(new Error(code))).toBe(false)
    expect(authFailure.value).toBeNull()
  }
 })
})
