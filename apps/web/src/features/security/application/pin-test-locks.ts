/**
 * Deterministic TEST-ONLY Web Locks simulation for independent Vue tabs
 * sharing one origin. Never imported by shipped app code.
 */
type Mode='shared'|'exclusive'
type LockView={name:string;mode:Mode}
type Pending<T>={
  mode:Mode
  name:string
  work:(lock:LockView|null)=>T|Promise<T>
  resolve:(result:T)=>void
  reject:(error:unknown)=>void
}
export class TestPinLockManager{
  private readonly held=new Map<string,{shared:number;exclusive:boolean}>()
  private readonly queue:Pending<unknown>[]=[]

  request<T>(
    name:string,options:{mode?:Mode;ifAvailable?:boolean},
    work:(lock:LockView|null)=>T|Promise<T>,
  ):Promise<T>{
    const mode=options.mode??'exclusive'
    if(mode!=='shared'&&mode!=='exclusive')
      return Promise.reject(new Error('test.invalid_lock_mode'))
    return new Promise<T>((resolve,reject)=>{
      const entry:Pending<T>={name,mode,work,resolve,reject}
      if(this.available(entry))this.run(entry)
      else if(options.ifAvailable){
        Promise.resolve().then(()=>work(null)).then(resolve,reject)
      }else{
        this.queue.push(entry as Pending<unknown>)
      }
    })
  }

  private available(entry:Pick<Pending<unknown>,'name'|'mode'>):boolean{
    const state=this.held.get(entry.name)
    return !state||(!state.exclusive && entry.mode==='shared')
  }
  private run<T>(entry:Pending<T>):void{
    const old=this.held.get(entry.name)??{shared:0,exclusive:false}
    if(entry.mode==='shared')old.shared++
    else old.exclusive=true
    this.held.set(entry.name,old)
    Promise.resolve().then(()=>entry.work({
      name:entry.name,mode:entry.mode,
    })).then(entry.resolve,entry.reject).finally(()=>{
      const state=this.held.get(entry.name)
      if(state){
        if(entry.mode==='shared')state.shared--
        else state.exclusive=false
        if(state.shared===0&&!state.exclusive)this.held.delete(entry.name)
      }
      this.drain()
    })
  }
  private drain():void{
    for(let i=0;i<this.queue.length;){
      const entry=this.queue[i]
      if(!this.available(entry)){i++;continue}
      this.queue.splice(i,1)
      this.run(entry)
    }
  }
  heldNames():string[]{return [...this.held.keys()]}
}
