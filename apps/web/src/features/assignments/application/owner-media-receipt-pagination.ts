import type { AssignmentMediaSubmission } from './assignment-outbox'

type ReceiptPage={
  items:AssignmentMediaSubmission[]
  nextCursor:string|null
}

/**
 * The server orders by the immutable submission UUID. Never merge a replayed,
 * reordered or backwards page into the owner's confirmed receipt list.
 * 50 is the server's exact bounded page size, not the assignment quota.
 */
export function appendOwnerMediaReceiptPage(
  existing:AssignmentMediaSubmission[],
  page:ReceiptPage,after:string|null,
):{items:AssignmentMediaSubmission[];nextCursor:string|null}{
  if(!page||!Array.isArray(page.items)||page.items.length>50
    ||!Array.isArray(existing)
    ||(page.nextCursor!==null&&typeof page.nextCursor!=='string'))
    throw Error('assignment.invalid_receipt_page')
  const seen=new Set(existing.map(item=>item.submissionId))
  let previous=after
  for(const item of page.items){
    const id=item?.submissionId
    if(typeof id!=='string'||!(/^[0-9a-f]{8}-[0-9a-f-]{27,}$/.test(id))
      ||seen.has(id)||(previous!==null&&id<=previous))
      throw Error('assignment.invalid_receipt_page')
    seen.add(id)
    previous=id
  }
  if(page.nextCursor!==null&&(
    page.items.length!==50
    ||page.nextCursor!==page.items[page.items.length-1]?.submissionId
    ||(after!==null&&page.nextCursor<=after)
  ))throw Error('assignment.invalid_receipt_page')
  if(existing.length>0&&after===null)
    throw Error('assignment.invalid_receipt_page')
  return {items:[...existing,...page.items],nextCursor:page.nextCursor}
}
