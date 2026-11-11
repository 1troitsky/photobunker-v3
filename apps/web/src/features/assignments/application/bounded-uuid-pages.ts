const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/
/**
 * Shared defensive cursor invariant for account-scoped Fieldwork overview and
 * recipient invitation feeds. Never trust a server-provided next cursor to
 * advance past unseen rows, go backwards, duplicate a row, or loop forever.
 */
export function appendBoundedUuidPage<T>(
  previous:T[],
  page:{items:T[];nextCursor:string|null},
  after:string|null,
  getId:(item:T)=>string,
):{items:T[];nextCursor:string|null}{
  if(!page||!Array.isArray(page.items)||page.items.length>50
    ||(after!==null&&!uuid.test(after))
    ||page.nextCursor!==null&&(
      typeof page.nextCursor!=='string'
      ||page.items.length!==50
      ||getId(page.items[49]!)!==page.nextCursor))
    throw Error('assignment.invalid_cursor_page')
  const seen=new Set(previous.map(getId))
  let last=after??''
  if(previous.length>0){
    const tail=getId(previous[previous.length-1]!)
    if(last&&tail!==last)throw Error('assignment.invalid_cursor_page')
    last=tail
  }
  for(const entry of page.items){
    if(!entry)throw Error('assignment.invalid_cursor_page')
    const id=getId(entry)
    if(typeof id!=='string'||!uuid.test(id)||seen.has(id)
      ||(last!==''&&id<=last))
      throw Error('assignment.invalid_cursor_page')
    last=id
    seen.add(id)
  }
  return {items:[...previous,...page.items],nextCursor:page.nextCursor}
}
