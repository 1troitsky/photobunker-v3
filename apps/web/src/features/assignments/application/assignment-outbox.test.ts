import 'fake-indexeddb/auto'
import { afterEach, describe, expect, it } from 'vitest'
import { freshPackage } from '../../identity/infrastructure/crypto'
import { activeSession } from '../../identity/application/session'
import type { Session } from '../../identity/application/session'
import {
  queueAssignmentCreation, listLocalAssignmentDrafts, listAssignmentOperations,
} from './assignment-outbox'

afterEach(()=>{activeSession.value=null})

async function account(id:string):Promise<void>{
  const {pkg}=await freshPackage(id)
  activeSession.value={
    accountId:id,deviceId:'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
    pkg,online:false,
  } as unknown as Session
}

describe('P1-04 assignment Local-First encrypted operation outbox',()=>{
  it('stores only signed ciphertext before any HTTP acknowledgement',async()=>{
    await account('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa')
    const id=await queueAssignmentCreation({
      title:'Confidential Assignment',
      instructions:'Capture 30 photographs, never publish the location',
      photoGoal:30,
    })
    expect(id).toMatch(/^[a-f0-9-]{36}$/)
    const [local]=await listLocalAssignmentDrafts()
    expect(local.state).toBe('queued')
    expect(local.photoGoal).toBe(30)
    expect(JSON.stringify(local)).not.toContain('Confidential')
    const [operation]=await listAssignmentOperations()
    expect(operation.kind).toBe('create')
    expect(operation.state).toBe('queued')
    expect(operation.signature.length).toBeGreaterThan(50)
    expect(operation.contract).not.toContain('Confidential')
    expect(operation.contract).not.toContain('never publish')
    const contract=JSON.parse(operation.contract)
    expect(contract.assignmentId).toBe(id)
    expect(contract.privateEnvelope.ciphertext).toMatch(/^[A-Za-z0-9_-]+$/)
  })
  it('isolates local draft listings per account and rejects invalid progress targets',async()=>{
    await account('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb')
    expect(await listLocalAssignmentDrafts()).toEqual([])
    await expect(queueAssignmentCreation({
      title:'Invalid',instructions:'',photoGoal:10000,
    })).rejects.toThrow('assignment.invalid_goal')
  })
})
