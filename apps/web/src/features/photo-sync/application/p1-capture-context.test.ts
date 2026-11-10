import 'fake-indexeddb/auto'
import { describe, expect, it } from 'vitest'
import { signedPhotoContract } from './p1-photo'
import type { StoredPhoto } from './p1-photo'

function photo(capture?:StoredPhoto['capture']):StoredPhoto{
  // Only contract serialization is under test. Ciphertext manifest validation
  // has its own fixture-based server/browser tests.
  return {
    photoId:'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    operationId:'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
    createdAt:1_800_000_000_000,
    expiresAt:1_801_123_200_000,
    assets:[],
    ...(capture?{capture}:{}),
  } as unknown as StoredPhoto
}

describe('P1-04 assignment-context photo contracts',()=>{
  it('preserves personal capture v1 without assignment metadata',()=>{
    const c=JSON.parse(signedPhotoContract(photo()))
    expect(c.version).toBe(1)
    expect(c).not.toHaveProperty('capture')
  })
  it('signs the complete immutable assignment policy binding in v2',()=>{
    const scope={
      assignmentId:'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
      ownerAccountId:'dddddddd-dddd-4ddd-8ddd-dddddddddddd',
      policyRevision:1,
      policyHash:'e'.repeat(64),
      capturedAt:1_800_000_000_000,
    }
    const c=JSON.parse(signedPhotoContract(photo(scope)))
    expect(c.version).toBe(2)
    expect(c.capture).toEqual(scope)
    expect(Object.keys(c.capture)).toEqual([
      'assignmentId','ownerAccountId','policyRevision','policyHash','capturedAt',
    ])
  })
})
