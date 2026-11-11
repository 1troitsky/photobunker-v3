import {describe,it,expect} from 'vitest'
import {appendOwnerMediaReceiptPage} from './owner-media-receipt-pagination'
import type {AssignmentPhotoSubmission} from './assignment-outbox'

const id=(n:number)=>'00000000-0000-4000-8000-'+n.toString(16).padStart(12,'0')
const fixture=(n:number):AssignmentPhotoSubmission=>({
  submissionId:id(n),photoId:id(n+100),
  photoGrantId:id(n+200),contributorAccountId:id(999),
})
describe('P2 legacy P1 photo owner pagination',()=>{
  it('loads 52 separately authorized legacy photo receipts without truncating at 50',()=>{
    const first=appendOwnerMediaReceiptPage([],{
      items:Array.from({length:50},(_,n)=>fixture(n+1)),
      nextCursor:id(50),
    },null)
    expect(first.items).toHaveLength(50)
    const after=appendOwnerMediaReceiptPage(first.items,{
      items:[fixture(51),fixture(52)],nextCursor:null,
    },first.nextCursor)
    expect(after.items).toHaveLength(52)
    expect(after.nextCursor).toBeNull()
  })
  it('rejects repeated P1 grant receipts and cursor rollback',()=>{
    const first=appendOwnerMediaReceiptPage([],{
      items:Array.from({length:50},(_,n)=>fixture(n+1)),
      nextCursor:id(50),
    },null)
    for(const page of [
      {items:[fixture(50)],nextCursor:null},
      {items:[fixture(52),fixture(51)],nextCursor:null},
      {items:[fixture(51)],nextCursor:id(48)},
    ]){
      expect(()=>appendOwnerMediaReceiptPage(
        first.items,page,first.nextCursor,
      )).toThrow('assignment.invalid_receipt_page')
    }
  })
})
