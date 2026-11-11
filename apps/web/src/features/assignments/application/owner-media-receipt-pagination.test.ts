import {describe,it,expect} from 'vitest'
import type {AssignmentMediaSubmission} from './assignment-outbox'
import {appendOwnerMediaReceiptPage} from './owner-media-receipt-pagination'

const id=(n:number)=>'00000000-0000-4000-8000-'+n.toString(16).padStart(12,'0')
function receipt(n:number):AssignmentMediaSubmission{
  return {
    submissionId:id(n),mediaId:id(n+1000),mediaGrantId:id(n+2000),
    contributorAccountId:id(9000),mediaType:'photo',
    capturedInAssignment:false,
    contract:'{}',signature:'fixture',mediaContractHash:'a'.repeat(64),
  }
}
describe('P2 bounded owner receipt pagination',()=>{
  it('shows a signed-candidate list beyond the first 50 without implicit grant',()=>{
    const first=Array.from({length:50},(_,i)=>receipt(i+1))
    const next=appendOwnerMediaReceiptPage([],{
      items:first,nextCursor:id(50),
    },null)
    expect(next.items).toHaveLength(50)
    expect(next.nextCursor).toBe(id(50))
    const more=appendOwnerMediaReceiptPage(next.items,{
      items:[receipt(51)],nextCursor:null,
    },next.nextCursor)
    expect(more.items).toHaveLength(51)
    expect(more.items[50]?.submissionId).toBe(id(51))
    expect(more.nextCursor).toBeNull()
  })
  it('refuses replay, duplicates, backwards cursor and malformed pages',()=>{
    const first=Array.from({length:50},(_,i)=>receipt(i+1))
    const current=appendOwnerMediaReceiptPage([],{
      items:first,nextCursor:id(50),
    },null)
    for(const page of [
      {items:[receipt(50)],nextCursor:null},
      {items:[receipt(51),receipt(51)],nextCursor:null},
      {items:[receipt(52),receipt(51)],nextCursor:null},
      {items:[receipt(51)],nextCursor:id(51)},
      {items:[receipt(51)],nextCursor:id(49)},
      {items:[receipt(50),receipt(51)],nextCursor:null},
    ]){
      expect(()=>appendOwnerMediaReceiptPage(
        current.items,page,current.nextCursor,
      )).toThrow('assignment.invalid_receipt_page')
    }
    expect(()=>appendOwnerMediaReceiptPage([],{
      items:[receipt(1)],nextCursor:id(1),
    },null)).toThrow('assignment.invalid_receipt_page')
    expect(()=>appendOwnerMediaReceiptPage(current.items,{
      items:[receipt(51)],nextCursor:null,
    },null)).toThrow('assignment.invalid_receipt_page')
  })
})
