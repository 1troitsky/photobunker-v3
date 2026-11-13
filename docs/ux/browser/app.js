'use strict';
(() => {
const $=s=>document.querySelector(s), $$=s=>[...document.querySelectorAll(s)];
const escapeHTML=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
const folderIcon='<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 7V5a2 2 0 0 1 2-2h5l3 3h8v13H3z"/></svg>';
const colors=[['#9fb0b4','#74858a','#c5b69d','#5b6a69'],['#b4b4af','#657678','#c2bba7','#414e50'],['#94a9b3','#70868b','#d0c0aa','#455457'],['#c9b099','#718480','#bdb9a4','#45534d'],['#9db5aa','#64847a','#b0b6a1','#37574c'],['#a9bdbe','#6e7d86','#c9ac94','#45545b'],['#b1b7c6','#626b81','#cac7bc','#475063'],['#c1bea8','#657776','#d2bd9e','#465a58']];
function scene(number){const p=colors[number%colors.length],variant=number%4;const art=variant===0?'<rect x="26" y="18" width="109" height="106" fill="'+p[2]+'"/><g fill="'+p[3]+'"><rect x="38" y="47" width="18" height="23"/><rect x="69" y="47" width="18" height="23"/><rect x="101" y="47" width="18" height="23"/><rect x="38" y="82" width="18" height="24"/><rect x="69" y="82" width="18" height="24"/><rect x="101" y="82" width="18" height="24"/></g>':variant===1?'<rect x="14" y="24" width="63" height="96" fill="'+p[2]+'"/><rect x="83" y="12" width="65" height="108" fill="'+p[1]+'"/><path d="M21 42h49M21 63h49M21 85h49M90 30h52M90 52h52M90 74h52" stroke="'+p[3]+'" stroke-width="5"/>':variant===2?'<path d="M0 65 37 39 73 58 113 26 160 62V120H0z" fill="'+p[2]+'"/><path d="M0 86 38 57 89 84 124 48 160 70V120H0z" fill="'+p[3]+'"/>':'<rect x="20" y="28" width="52" height="92" fill="'+p[2]+'"/><rect x="83" y="14" width="63" height="106" fill="'+p[1]+'"/><path d="M29 45h34M29 65h34M29 85h34M92 31h44M92 49h44M92 68h44M92 87h44" stroke="'+p[3]+'" stroke-width="4"/>';
return '<svg class="scene" viewBox="0 0 160 120" preserveAspectRatio="xMidYMid slice" aria-hidden="true"><rect width="160" height="120" fill="'+p[0]+'"/><circle cx="132" cy="17" r="17" fill="#fff8e5" opacity=".35"/>'+art+'</svg>'}
const photo=(id,parent,name,sceneIndex,order,tags=[],extras={})=>({id,parent,name,kind:'photo',sceneIndex,order,tags,daysToExpiry:13,created:'7 ноя',readable:true,editable:true,deletable:true,...extras});
let entries=[
{id:'personal',parent:'all',name:'Мои фото',kind:'section',order:80},
{id:'assignments',parent:'all',name:'Задания',kind:'section',order:70},
{id:'archive',parent:'all',name:'Архив',kind:'section',order:60},
{id:'city',parent:'personal',name:'Городские прогулки',kind:'folder',order:55,created:'5 ноя'},
{id:'studio',parent:'personal',name:'Студия',kind:'folder',order:25,created:'3 ноя'},
photo('pm1','personal','ABCD0012',0,95,['город'],{daysToExpiry:3}),photo('pm2','personal','ABCD0011',4,79,['пейзаж'],{daysToExpiry:9}),
{id:'demo-v1',parent:'personal',kind:'video',name:'ABCD0014 — Обход квартала.mp4',order:93,created:'7 ноя',duration:'00:48',size:18743210,daysToExpiry:13,tags:['архитектура'],readable:true,deletable:true},
{id:'demo-a1',parent:'personal',kind:'audio',name:'ABCD0015 — Звуки улицы.m4a',order:92,created:'7 ноя',duration:'01:32',size:1539428,daysToExpiry:13,tags:['атмосфера'],readable:true,deletable:true},
photo('ct1','city','ABCD0008',1,49,['фасад']),photo('ct2','city','ABCD0009',2,48,['город']),photo('ct3','city','ABCD0010',3,47,['детали']),photo('ct4','city','ABCD0013',5,46,['город']),
{id:'demo-v2',parent:'city',kind:'video',name:'ABCD0016 — Панорама площади.mp4',order:45,created:'6 ноя',duration:'00:26',size:13274421,daysToExpiry:20,tags:['город'],readable:true,deletable:true},
photo('st1','studio','ABCD0001',6,29,['работа']),photo('st2','studio','ABCD0002',7,28,['интерьер']),photo('st3','studio','ABCD0003',0,27,['работа']),photo('st4','studio','ABCD0004',1,26,['детали']),
{id:'demo-a2',parent:'studio',kind:'audio',name:'ABCD0017 — Интервью.m4a',order:24,created:'5 ноя',duration:'02:45',size:2783417,daysToExpiry:21,tags:['интервью'],readable:true,deletable:true},
{id:'site',parent:'assignments',name:'Фасады — Site A',kind:'assignment',order:95},
{id:'interior',parent:'assignments',name:'Интерьер — зал 02',kind:'assignment',order:90},
{id:'coast',parent:'assignments',name:'Побережье — репортаж',kind:'assignment',order:85},
{id:'details',parent:'site',name:'Детали фасада',kind:'folder',order:74},
photo('s1','site','SITE0001',2,99,['фасад']),photo('s2','site','SITE0002',1,93,['фасад']),photo('s3','details','SITE0003',5,88,['детали']),photo('s4','details','SITE0004',0,87,['детали']),photo('s5','details','SITE0005',3,86,['детали']),photo('s6','details','SITE0006',7,85,['детали']),
photo('i1','interior','INT0001',6,69,['интерьер']),photo('i2','interior','INT0002',7,68,['интерьер']),photo('i3','interior','INT0003',1,67,['интерьер']),photo('i4','interior','INT0004',3,66,['интерьер']),
photo('a1','archive','ABCD0005',4,20,['архив'],{daysToExpiry:5}),photo('a2','archive','ABCD0006',5,19,['архив'],{daysToExpiry:5})];
let nextId=0;const MAX_FILE=100*1024*1024;
const state={location:'personal',view:'list',selected:new Set(),selectMode:false,expanded:new Set(),typeFilter:'all',searchFolder:'current',query:'',searchOpen:false,sort:'newest',foldersFirst:true,daysLeft:false,openFirst:'personal',dialog:'',target:'',focus:null,destination:'personal',urlAbort:null,useArchive:true,archiveAutoDelete:true};
const DAY=24*60*60*1000;
for(const e of entries){
  e.modifiedAt=Date.now()-Math.max(0,100-(e.order||45))*2*60*60*1000;
  if(e.kind==='photo' && !e.category){
    const tag=e.tags?.[0];e.category=({город:'Город',пейзаж:'Пейзаж',фасад:'Фасад',интерьер:'Интерьер',детали:'Детали',работа:'Работа'})[tag]||'Другое';
  }
  if((e.kind==='video'||e.kind==='audio')&&!e.category)e.category='Документация';
  if(e.parent==='archive')e.archivedAt=Date.now()-2*DAY;
}

const get=id=>entries.find(e=>e.id===id),kids=id=>entries.filter(e=>e.parent===id),isMedia=e=>e&&['photo','video','audio'].includes(e.kind),mediaName=e=>e.kind==='video'?'Видео':e.kind==='audio'?'Аудио':'Фото';
const isSystem=e=>!!e&&(e.kind==='section'||e.kind==='assignment');
const canSelect=e=>!!e&&!isSystem(e);
const canUploadTo=e=>!!e&&(e.id==='personal'||(state.useArchive&&e.id==='archive')||e.kind==='folder'||e.kind==='assignment');
const canWriteTo=id=>id==='all'||canUploadTo(get(id));
const folderName=id=>id==='all'?'Все':get(id)?.name||'Все';
const isAvailableLocation=e=>state.useArchive||sectionOf(e.id)!=='archive';
function directChildren(id){return kids(id).filter(e=>state.useArchive||e.id!=='archive')}

function pathLabel(id){return lineage(id).map(e=>e.name).join(' / ')}
function folderOptions({includeAll=false,includeCurrent=false,uploadOnly=false}={}){
  const folders=entries.filter(e=>!isMedia(e) && (uploadOnly?canUploadTo(e):true) && isAvailableLocation(e));
  const result=[];
  if(includeAll)result.push('<option value="all">Во всех папках</option>');
  else if(uploadOnly)result.push('<option value="all">Все (корень)</option>');
  if(includeCurrent)result.push('<option value="current">Текущая папка: '+escapeHTML(get(state.location)?.name||'Все')+'</option>');
  for(const e of folders){
    result.push('<option value="'+escapeHTML(e.id)+'">'+escapeHTML(pathLabel(e.id))+'</option>');
  }
  return result.join('');
}

function lineage(id){let out=[],current=get(id);while(current&&out.length<25){out.unshift(current);current=get(current.parent)}return out}
function descendants(id){let a=[];function walk(parent,depth){if(depth>20)return;kids(parent).forEach(e=>{a.push(e);if(!isMedia(e))walk(e.id,depth+1)})}walk(id,0);return a}
const filesIn=id=>descendants(id).filter(isMedia),sectionOf=id=>lineage(id).find(e=>['personal','assignments','archive'].includes(e.id))?.id||'all';
const noun=(n,a,b,c)=>{let k=n%10,m=n%100;return m>=11&&m<=14?c:k===1?a:k>=2&&k<=4?b:c};
function expiresAt(e){
  if(e.archivedAt!=null&&state.archiveAutoDelete)return e.archivedAt+7*DAY;
  if(e.daysToExpiry==null)return Number.POSITIVE_INFINITY;
  return Date.now()+e.daysToExpiry*DAY;
}
function prettyDate(time){return Number.isFinite(time)?new Intl.DateTimeFormat('ru-RU',{day:'numeric',month:'short'}).format(new Date(time)):'—'}
function expiry(e){
  const at=expiresAt(e);if(!Number.isFinite(at))return 'Без срока';
  const days=Math.max(0,Math.ceil((at-Date.now())/DAY));
  return state.daysLeft?'Осталось: '+days+' '+noun(days,'день','дня','дней'):'Удаление: '+prettyDate(at);
}
function modifiedLabel(e){return state.sort==='modified'?' · Изменено: '+prettyDate(e.modifiedAt):''}
function effectiveExpiry(e){if(isMedia(e))return expiresAt(e);const timestamps=descendants(e.id).filter(isMedia).map(expiresAt);return timestamps.length?Math.min(...timestamps):Infinity}
function markModified(e){if(e)e.modifiedAt=Date.now()+1}
function purgeIds(ids){
  const removed=new Set(ids);
  for(const id of ids)if(get(id)&&!isMedia(get(id)))for(const child of descendants(id))removed.add(child.id);
  entries=entries.filter(e=>{if(removed.has(e.id)){if(e.url)URL.revokeObjectURL(e.url);return false}return true});
}
function archiveSelected(ids){
  for(const id of ids){
    const e=get(id);if(!e||isSystem(e)||sectionOf(id)==='archive')continue;
    if(lineage(e.parent).some(x=>ids.includes(x.id)))continue;
    e.previousParent=e.parent;e.parent='archive';e.archivedAt=Date.now();markModified(e);
  }
}
function deleteOrArchive(ids){
  const valid=ids.filter(id=>get(id)&&!isSystem(get(id)));
  if(state.useArchive){
    const alreadyArchived=valid.filter(id=>sectionOf(id)==='archive');
    const pendingArchive=valid.filter(id=>sectionOf(id)!=='archive');
    archiveSelected(pendingArchive);
    purgeIds(alreadyArchived);
  }else purgeIds(valid);
}
function cleanupArchive(){
  if(!state.archiveAutoDelete)return false;
  const now=Date.now(),expired=entries.filter(e=>e.archivedAt!=null&&now-e.archivedAt>=7*DAY).map(e=>e.id);
  if(expired.length)purgeIds(expired);
  return expired.length>0;
}

function mediaPreview(e){if(e.kind==='photo')return e.url?'<img class="imported-thumb" src="'+escapeHTML(e.url)+'" alt="">':scene(e.sceneIndex);return '<span class="file-mark '+e.kind+'">'+(e.kind==='video'?'<svg viewBox="0 0 24 24"><rect x="3" y="5" width="14" height="14" rx="2"/><path d="m17 10 4-3v10l-4-3"/></svg>':'<svg viewBox="0 0 24 24"><path d="M9 18V5l12-2v13M9 9l12-2"/><ellipse cx="6" cy="18" rx="3" ry="2"/><ellipse cx="18" cy="16" rx="3" ry="2"/></svg>')+'</span>'}
function preview(e){if(isMedia(e))return '<span class="entry-preview">'+mediaPreview(e)+'</span>';const a=filesIn(e.id).slice(0,4);let items=a.length?Array.from({length:4},(_,i)=>a[i]?mediaPreview(a[i]):'<span class="empty-mini"></span>').join(''):folderIcon;return '<span class="entry-preview '+(a.length?'collage':'empty-folder')+'">'+items+'<span class="entry-folder-badge" aria-label="Папка">'+folderIcon+'</span></span>'}
function sorted(rows){return rows.slice().sort((a,b)=>{const x=a.entry,y=b.entry;
  if(state.foldersFirst){const rank=Number(isMedia(x))-Number(isMedia(y));if(rank)return rank}
  if(state.sort==='name')return x.name.localeCompare(y.name,'ru',{numeric:true});
  if(state.sort==='deleteSoon')return effectiveExpiry(x)-effectiveExpiry(y)||y.order-x.order;
  if(state.sort==='modified')return (y.modifiedAt||0)-(x.modifiedAt||0)||y.order-x.order;
  return state.sort==='oldest'?x.order-y.order:y.order-x.order;
})}

function visibleRows(){
  if(state.searchOpen){
    const term=state.query.trim().toLocaleLowerCase();
    let candidates=state.searchFolder==='all'
      ? entries.filter(e=>isMedia(e)&&(state.useArchive||sectionOf(e.id)!=='archive'))
      : filesIn(state.searchFolder==='current'?state.location:state.searchFolder);
    candidates=candidates.filter(e=>e.readable!==false &&
      (state.typeFilter==='all'||e.kind===state.typeFilter) &&
      (!term||(e.name+' '+(e.tags||[]).join(' ')).toLocaleLowerCase().includes(term)));
    return sorted(candidates.map(entry=>({entry,depth:0})));
  }
  if(state.view!=='tree')return sorted(directChildren(state.location).map(entry=>({entry,depth:0})));
  let rows=[];
  function walk(id,depth){sorted(directChildren(id).map(entry=>({entry,depth}))).forEach(row=>{
    rows.push(row);
    if(!isMedia(row.entry)&&state.expanded.has(row.entry.id))walk(row.entry.id,depth+1)
  })}
  walk(state.location,0);return rows;
}
function rowHTML(row){
  const e=row.entry,file=isMedia(e),selected=state.selected.has(e.id);
  const sub=file
    ?'<small>'+escapeHTML(e.created)+(e.imported?' · '+mediaName(e)+' · '+formatBytes(e.size)
      :e.kind!=='photo'?' · '+mediaName(e)+(e.duration?' · '+escapeHTML(e.duration):'')
      :' · '+expiry(e))+
      (state.sort==='deleteSoon'&&e.kind!=='photo'?' · '+expiry(e):'')+modifiedLabel(e)+'</small>'+
      (e.tags?.length?'<small class="tags">'+e.tags.map(x=>'#'+escapeHTML(x)).join(' ')+'</small>':'')+
      (e.category?'<small class="entry-category">Категория: '+escapeHTML(e.category)+'</small>':'')
    :'<small>'+filesIn(e.id).length+' '+(filesIn(e.id).some(f=>f.kind!=='photo')?'файлов':'фото')+
      (e.created?' · '+escapeHTML(e.created):'')+modifiedLabel(e)+'</small>';
  const parentPath=state.searchOpen&&state.searchFolder==='all'
    ?'<small class="entry-location">'+escapeHTML(pathLabel(e.parent))+'</small>':'';
  return '<article class="browser-entry'+(selected?' selected':'')+'" style="--depth:'+row.depth+'">'+
    (state.view==='tree'&&!state.searchOpen?'<button type="button" class="tree-expand" data-action="expand" data-id="'+escapeHTML(e.id)+'" '+(file?'disabled':'')+' aria-label="Раскрыть папку">'+(file?'':state.expanded.has(e.id)?'⌄':'›')+'</button>':'')+
    (state.selectMode&&canSelect(e)?'<input type="checkbox" class="entry-check" data-check="'+escapeHTML(e.id)+'" '+(selected?'checked':'')+' aria-label="Выбрать '+escapeHTML(e.name)+'">':'')+
    '<button type="button" class="entry-open" data-action="open" data-id="'+escapeHTML(e.id)+'">'+preview(e)+
    '<span class="entry-copy"><strong>'+escapeHTML(e.name)+'</strong>'+sub+parentPath+'</span></button>'+
    '<button type="button" class="entry-more" data-action="menu" data-id="'+escapeHTML(e.id)+'" aria-label="Действия: '+escapeHTML(e.name)+'" title="Действия">•••</button></article>';
}
function render(){
  cleanupArchive();
  const section=sectionOf(state.location);
  $('[data-section=archive]').hidden=!state.useArchive;
  $$('[data-section]').forEach(b=>{
    const on=b.dataset.section===section;b.classList.toggle('selected',on);b.setAttribute('aria-selected',String(on))
  });
  $$('[data-view]').forEach(b=>{
    const on=b.dataset.view===state.view;b.classList.toggle('selected',on);b.setAttribute('aria-pressed',String(on))
  });
  const files=filesIn(state.location),folders=directChildren(state.location).filter(e=>!isMedia(e)).length;
  $('#browser-count').textContent=files.length+(files.some(e=>e.kind!=='photo')?' файлов · ':' фото · ')+folders+' '+noun(folders,'папка','папки','папок');
  const crumbs=[{id:'all',name:'Все'},...lineage(state.location)];
  $('.path-breadcrumbs').innerHTML=crumbs.map((e,i)=>(i?'<span>›</span>':'')+
    '<button type="button" data-action="navigate" data-id="'+escapeHTML(e.id)+'" class="'+(i===crumbs.length-1?'current':'')+'">'+escapeHTML(e.name)+'</button>').join('');
  $('.path-back').disabled=state.location==='all';
  $('.browser-search').hidden=!state.searchOpen;
  if(state.searchOpen){
    $('#search-folder').innerHTML=folderOptions({includeAll:true,includeCurrent:true});
    $('#search-folder').value=state.searchFolder;
    $$('[data-type]').forEach(b=>{
      const on=b.dataset.type===state.typeFilter;b.classList.toggle('selected',on);b.setAttribute('aria-pressed',String(on))
    });
  }
  $('.selection-bar').hidden=!state.selectMode;
  if(state.selectMode)$('.selection-bar').innerHTML='<strong>Выбрано: '+state.selected.size+'</strong><button type="button" data-action="cancel">Отмена</button><button type="button" data-action="bulk">Действия</button>';
  $('#browser-items').className='browser-items '+state.view;
  const rows=visibleRows();
  $('#browser-items').innerHTML=rows.length?rows.map(rowHTML).join(''):'<div class="browser-empty">Файлы не найдены</div>';
}
function navigate(id){if(id!=='all'&&!get(id))return;if(!state.useArchive&&sectionOf(id)==='archive')id='personal';state.location=id;state.query='';state.typeFilter='all';state.searchFolder='current';state.searchOpen=false;state.selectMode=false;state.selected.clear();$('#browser-query').value='';$('#browser-content').scrollTop=0;render()}
function button(action,name,cls=''){return '<button type="button" data-action="'+action+'" class="'+cls+'">'+name+'</button>'}
function dialog(title,content,kind='generic',target=''){state.focus=document.activeElement;state.dialog=kind;state.target=target;$('#dialog-title').textContent=title;$('#dialog-content').innerHTML=content;$('#dialog-overlay').hidden=false;$('.dialog-sheet').focus()}
function close(){if(state.urlAbort){state.urlAbort.abort();state.urlAbort=null}$('#dialog-overlay').hidden=true;state.dialog='';state.target='';if(state.focus?.isConnected)state.focus.focus();state.focus=null}
function msg(title,description){dialog(title,'<div class="info">'+description+'</div>'+button('close','Готово','primary-action'),'message')}
function formatBytes(n){return n>1048576?(n/1048576).toFixed(1)+' МБ':n>1024?Math.round(n/1024)+' КБ':n+' Б'}
function typeFor(file){if(file.type.startsWith('image/'))return 'photo';if(file.type.startsWith('video/'))return 'video';if(file.type.startsWith('audio/'))return 'audio';if(file.type&&!['application/octet-stream','binary/octet-stream'].includes(file.type))return null;const ext=file.name.split('.').pop().toLowerCase();if(['jpg','jpeg','png','gif','webp','avif','heic'].includes(ext))return 'photo';if(['mp4','mov','m4v','webm','ogv'].includes(ext))return 'video';if(['wav','mp3','m4a','aac','ogg','opus','flac','weba'].includes(ext))return 'audio';return null}
function importOpen(){
  const cur=get(state.location);
  state.destination=canWriteTo(state.location)?state.location:'all';
  dialog('Загрузить файлы',
  '<label class="upload-destination">Папка назначения<select id="upload-destination" aria-label="Выбрать папку для загрузки">'+folderOptions({uploadOnly:true})+'</select></label>'+
  '<label class="upload-dropzone" id="upload-zone"><svg viewBox="0 0 24 24"><path d="M12 16V3m-5 5 5-5 5 5M4 16v4h16v-4"/></svg><strong>Выбрать файлы с устройства</strong><small>Фото, видео, аудио · можно перетащить сюда</small><input type="file" id="upload-files" accept="image/*,video/*,audio/*" multiple></label>'+
  '<div class="upload-divider">или</div>'+
  '<label class="url-row">Загрузить по ссылке<input type="url" id="upload-url" placeholder="https://example.com/file.mp4" autocomplete="off"></label>'+
  button('fetch-url','Загрузить по ссылке','primary-action')+
  '<p class="upload-feedback" id="upload-feedback" role="status" aria-live="polite"></p>'+
  '<div class="upload-note"><span>Могут потребоваться проверки прав, лимитов, шифрования и безопасной серверной загрузки.</span><span>На вашем устройстве лимит 100 МБ на файл.</span></div>','upload');
  $('#upload-destination').value=state.destination;
}
function feedback(text,error=false){const el=$('#upload-feedback');if(el){el.textContent=text;el.className='upload-feedback'+(error?' error':'')}}
function addFiles(files){let success=0,skip=0;for(const file of files){const kind=typeFor(file);if(!kind||file.size===0||file.size>MAX_FILE){skip++;continue}entries.push({id:'import-'+(++nextId),parent:state.destination,kind,name:file.name,file,created:'Сегодня',order:Date.now()+nextId/1000,modifiedAt:Date.now(),size:file.size,url:URL.createObjectURL(file),imported:true,daysToExpiry:null,tags:[],category:'',deletable:true});success++}if(!success){feedback('Не удалось добавить файлы. Проверьте формат и размер.',true);return}const destination=state.destination;close();navigate(destination);if(skip)msg('Файлы добавлены','Добавлено: '+success+'. Пропущено: '+skip+'.')}
async function fetchURL(){if(state.urlAbort)return;const input=$('#upload-url');let url;try{url=new URL(input.value.trim());if(url.protocol!=='https:')throw Error('Only HTTPS')}catch{feedback('Укажите прямую HTTPS-ссылку на файл.',true);return}const controller=new AbortController();state.urlAbort=controller;const btn=$('[data-action="fetch-url"]');btn.disabled=true;feedback('Загрузка…');try{const res=await fetch(url.toString(),{mode:'cors',credentials:'omit',signal:controller.signal});if(!res.ok)throw Error('HTTP '+res.status);const mime=(res.headers.get('content-type')||'').split(';')[0].toLowerCase();if(mime.includes('text/html'))throw Error('HTML, not file');if(Number(res.headers.get('content-length')||0)>MAX_FILE)throw Error('Too large');let chunks=[],size=0;if(res.body?.getReader){const reader=res.body.getReader();while(true){const{done,value}=await reader.read();if(done)break;size+=value.byteLength;if(size>MAX_FILE){await reader.cancel();throw Error('Too large')}chunks.push(value)}}else{const blob=await res.blob();if(blob.size>MAX_FILE)throw Error('Too large');chunks=[blob]}let name=url.pathname.split('/').pop()||'file';try{name=decodeURIComponent(name)}catch{}name=name.replace(/[\\/]/g,'_').slice(0,120);const file=new File(chunks,name,{type:mime});if(!typeFor(file))throw Error('Unknown format');if(!controller.signal.aborted&&state.dialog==='upload')addFiles([file])}catch(e){if(!controller.signal.aborted)feedback('Не удалось загрузить файл. Проверьте ссылку и доступ к ней.',true)}finally{if(state.urlAbort===controller)state.urlAbort=null;if(btn.isConnected)btn.disabled=false}}
function showPhoto(e){const image=e.url?'<img src="'+escapeHTML(e.url)+'" alt="">':scene(e.sceneIndex);dialog(e.name,'<div class="photo-large">'+image+'</div><div class="info">'+(e.imported?mediaName(e)+' · '+formatBytes(e.size):'Снято: '+e.created+' · '+expiry(e))+'</div>','preview',e.id)}
function parseTags(text){return [...new Set(text.split(',').map(x=>x.trim()).filter(Boolean))]}
function selectedMedia(){return [...state.selected].map(get).filter(isMedia)}
function categoryListHTML(){const values=[...new Set(entries.filter(isMedia).map(e=>e.category).filter(Boolean))].sort((a,b)=>a.localeCompare(b,'ru'));return '<datalist id="known-categories">'+values.map(x=>'<option value="'+escapeHTML(x)+'"></option>').join('')+'</datalist>'}
function handle(action,id){
  const item=get(id);
  if(action==='close'){close();return}
  if(action==='back'){
    let chain=lineage(state.location);
    navigate(chain.length>1?chain[chain.length-2].id:'all');return
  }
  if(action==='navigate'){navigate(id);return}
  if(action==='upload'){importOpen();return}
  if(action==='fetch-url'){void fetchURL();return}
  if(action==='create'){
    const options=folderOptions({uploadOnly:true});
    dialog('Новая папка','<label>Название<input id="folder-name" maxlength="80" placeholder="Новая папка"></label>'+ 
      '<label>Расположение<select id="folder-parent">'+options+'</select></label>'+button('create-folder','Создать папку','primary-action'));
    $('#folder-parent').value=canWriteTo(state.location)?state.location:'all';return
  }
  if(action==='create-folder'){
    const name=$('#folder-name').value.trim(),parent=$('#folder-parent').value;
    if(!name||!canWriteTo(parent)||kids(parent).some(e=>e.kind==='folder'&&e.name.toLocaleLowerCase()===name.toLocaleLowerCase()))return;
    entries.push({id:'folder-'+(++nextId),name,kind:'folder',parent,order:Date.now(),modifiedAt:Date.now(),created:'Сегодня'});
    close();navigate(parent);return
  }
  if(action==='search'){
    state.searchOpen=!state.searchOpen;
    state.searchFolder='current';state.typeFilter='all';
    if(!state.searchOpen){state.query='';$('#browser-query').value=''}
    render();if(state.searchOpen)$('#browser-query').focus();return
  }
  if(action==='select'||action==='cancel'){
    state.selectMode=action==='select'?!state.selectMode:false;
    state.selected.clear();render();return
  }
  if(action==='expand'){
    state.expanded.has(id)?state.expanded.delete(id):state.expanded.add(id);render();return
  }
  if(action==='open'){
    if(state.selectMode&&canSelect(item)){
      state.selected.has(id)?state.selected.delete(id):state.selected.add(id);render();return
    }
    if(!item)return;
    if(isMedia(item)){
      if(item.kind==='photo')showPhoto(item);
      else dialog(item.name,'<div class="info">'+mediaName(item)+(item.duration?' · '+escapeHTML(item.duration):'')+(item.size?' · '+formatBytes(item.size):'')+'</div>','item',id)
    } else navigate(id);
    return
  }
  if(action==='menu'){
    if(!item)return;
    const file=isMedia(item),system=isSystem(item);
    let actions=button('open-menu',file?'Открыть файл':'Открыть папку')+
      button('share-item','Поделиться');
    if(!system){
      actions+=button('rename',file?'Переименовать':'Переименовать папку');
      if(file)actions+=button('tags','Изменить теги')+button('category','Изменить категорию');
      if(state.useArchive && (file||item.kind==='folder') && sectionOf(item.id)!=='archive')actions+=button('archive','В архив');
      if(state.useArchive && sectionOf(item.id)==='archive')actions+=button('archive','Восстановить из архива');
      actions+=button('move','Переместить')+button('delete','Удалить','danger');
    }
    dialog(item.name,actions,'menu',item.id);return
  }
  if(action==='open-menu'){
    const cur=get(state.target),which=cur?.id;
    close();if(which)handle('open',which);return
  }
  if(action==='share'||action==='share-item'){
    const cur=action==='share-item'?get(state.target):null;
    dialog('Поделиться',
      (cur?'<div class="info">'+escapeHTML(cur.name)+'</div>':'')+
      '<label>Способ отправки<select id="share-method"><option value="link">По ссылке</option><option value="contact">Контакту</option></select></label>'+
      '<label>Разрешения<select id="share-permission"><option value="view">Только просмотр</option><option value="download">Просмотр и скачивание</option></select></label>'+
      (cur?.file&&typeof navigator.share==='function'?button('share-native','Отправить файл с устройства'): '')+
      button('share-apply','Сохранить параметры','primary-action'),
      'share',cur?.id||'');return
  }
  if(action==='share-apply'){
    const cur=get(state.target);
    if(cur)cur.sharePrefs={method:$('#share-method').value,permission:$('#share-permission').value};
    close();return
  }
  if(action==='share-native'){
    const cur=get(state.target);
    if(cur?.file&&navigator.share){
      navigator.share({files:[cur.file],title:cur.name}).catch(()=>{});
      close();
    }
    return
  }
  if(action==='rename'){
    const cur=get(state.target);if(!cur||isSystem(cur))return;
    dialog('Переименовать','<label>Название<input id="rename-name" maxlength="120" value="'+escapeHTML(cur.name)+'"></label>'+button('save-rename','Сохранить','primary-action'),'rename',cur.id);return
  }
  if(action==='save-rename'){
    const cur=get(state.target),name=$('#rename-name').value.trim();
    if(cur&&!isSystem(cur)&&name){cur.name=name;markModified(cur);close();render()}return
  }
  if(action==='tags'){
    const cur=get(state.target);if(!isMedia(cur))return;
    dialog('Теги файла','<label>Теги через запятую<input id="tags-input" value="'+escapeHTML((cur.tags||[]).join(', '))+'"></label>'+button('save-tags','Сохранить','primary-action'),'tags',cur.id);return
  }
  if(action==='save-tags'){
    const cur=get(state.target);if(!isMedia(cur))return;
    cur.tags=$('#tags-input').value.split(',').map(s=>s.trim()).filter(Boolean);markModified(cur);
    close();render();return
  }
  if(action==='category'){
    const cur=get(state.target);if(!isMedia(cur))return;
    dialog('Категория файла','<label>Категория<input id="category-single" maxlength="80" value="'+escapeHTML(cur.category||'')+'" list="known-categories"></label>'+categoryListHTML()+button('save-category','Сохранить','primary-action'),'category',cur.id);return
  }
  if(action==='save-category'){
    const cur=get(state.target);if(!isMedia(cur))return;
    cur.category=$('#category-single').value.trim().slice(0,80);markModified(cur);close();render();return
  }
  if(action==='archive'){
    if(!state.useArchive)return;
    const cur=get(state.target);if(!cur||isSystem(cur))return;
    if(sectionOf(cur.id)==='archive'){
      cur.parent=canWriteTo(cur.previousParent)?cur.previousParent:'personal';delete cur.previousParent;delete cur.archivedAt;markModified(cur)
    }else archiveSelected([cur.id]);
    close();render();return
  }
  if(action==='move'){
    const cur=get(state.target);if(!cur||isSystem(cur))return;
    const available=entries.filter(e=>canUploadTo(e) && e.id!==cur.id &&
      !lineage(e.id).some(p=>p.id===cur.id) &&
      sectionOf(e.id)===sectionOf(cur.id));
    dialog('Переместить','<label>Папка назначения<select id="move-destination">'+
      available.map(e=>'<option value="'+escapeHTML(e.id)+'">'+escapeHTML(pathLabel(e.id))+'</option>').join('')+
      '</select></label>'+button('move-confirm','Переместить','primary-action'),'move',cur.id);return
  }
  if(action==='move-confirm'){
    const cur=get(state.target),dest=$('#move-destination').value;
    if(cur&&!isSystem(cur)&&canWriteTo(dest) && sectionOf(cur.id)===sectionOf(dest) &&
      cur.id!==dest && !lineage(dest).some(e=>e.id===cur.id)){
      cur.parent=dest;markModified(cur);close();navigate(dest)
    }return
  }
  if(action==='delete'){
    const cur=get(state.target);if(!cur||isSystem(cur))return;
    const removeForever=!state.useArchive||sectionOf(cur.id)==='archive';
    dialog(removeForever?'Удалить':'Переместить в архив','<div class="info">'+(removeForever?'Удалить «':'Переместить в архив «')+escapeHTML(cur.name)+'»?</div>'+button('delete-confirm',removeForever?'Удалить':'В архив',removeForever?'danger':'primary-action'),'delete',cur.id);return
  }
  if(action==='delete-confirm'){
    const cur=get(state.target);if(!cur||isSystem(cur))return;
    deleteOrArchive([cur.id]);
    close();render();return
  }
  if(action==='settings'){
    dialog('Настройки Browser','<label>Открывать первым<select id="first-section"><option value="all">Все</option><option value="personal">Мои фото</option><option value="assignments">Задания</option><option value="archive">Архив</option></select></label>'+ 
      '<label>Сортировка<select id="sort"><option value="newest">Сначала новые</option><option value="oldest">Сначала старые</option><option value="name">По названию</option><option value="deleteSoon">По дате удаления — ближайшие</option><option value="modified">По дате изменения — новые</option></select></label>'+ 
      '<label class="settings-row"><span><strong>Папки всегда сверху</strong><small>Независимо от сортировки</small></span><input type="checkbox" id="folder-first" class="setting-toggle"></label>'+ 
      '<label class="settings-row"><span><strong>Показывать оставшиеся дни</strong><small>Вместо даты удаления</small></span><input type="checkbox" id="days-left" class="setting-toggle"></label>'+
      '<label class="settings-row"><span><strong>Использовать архив</strong><small>При выключении файлы удаляются сразу</small></span><input type="checkbox" id="archive-enabled" class="setting-toggle"></label>'+
      '<label class="settings-row"><span><strong>Автоудаление из архива через 7 дней</strong><small>После перемещения в архив</small></span><input type="checkbox" id="archive-auto" class="setting-toggle"></label>'+
      button('save-settings','Применить','primary-action'),'settings');
    $('#first-section').value=state.openFirst;$('#sort').value=state.sort;
    $('#folder-first').checked=state.foldersFirst;$('#days-left').checked=state.daysLeft;$('#archive-enabled').checked=state.useArchive;$('#archive-auto').checked=state.archiveAutoDelete;$('#archive-auto').disabled=!state.useArchive;return
  }
  if(action==='save-settings'){
    state.openFirst=$('#first-section').value;state.sort=$('#sort').value;
    state.foldersFirst=$('#folder-first').checked;state.daysLeft=$('#days-left').checked;
    state.useArchive=$('#archive-enabled').checked;state.archiveAutoDelete=$('#archive-auto').checked;
    if(!state.useArchive&&sectionOf(state.location)==='archive')state.location='personal';
    if(!state.useArchive&&state.openFirst==='archive')state.openFirst='personal';
    close();render();return
  }
  if(action==='bulk'){
    const selected=[...state.selected].map(get).filter(Boolean);
    const files=selected.filter(isMedia);
    let html=button('select-all','Выбрать всё');
    if(files.length){
      html+='<div class="bulk-summary">'+files.length+' '+noun(files.length,'файл','файла','файлов')+' выбрано</div>'+
        button('bulk-tags','Изменить теги')+button('bulk-category','Изменить категорию');
    }
    if(selected.length)html+=button('share-selected','Поделиться')+button('move-selected','Переместить')+
      button('delete-selected',state.useArchive?'В архив / удалить':'Удалить выбранное',state.useArchive?'':'danger');
    dialog('Действия',html,'bulk');return
  }
  if(action==='bulk-tags'){
    const files=selectedMedia();if(!files.length)return;
    dialog('Теги для '+files.length+' '+noun(files.length,'файла','файлов','файлов'),
      '<label>Действие<select id="bulk-tags-mode"><option value="add">Добавить теги</option><option value="replace">Заменить все теги</option><option value="remove">Удалить указанные теги</option></select></label>'+
      '<label>Теги через запятую<input id="bulk-tags-input" placeholder="например: архитектура, фасад"></label>'+
      button('apply-bulk-tags','Применить','primary-action'),'bulk-tags');return
  }
  if(action==='apply-bulk-tags'){
    const tags=parseTags($('#bulk-tags-input').value);const mode=$('#bulk-tags-mode').value;
    if(!tags.length){$('#bulk-tags-input').focus();return}
    for(const file of selectedMedia()){
      const existing=file.tags||[];
      file.tags=mode==='replace'?tags.slice():mode==='remove'?existing.filter(x=>!tags.some(t=>t.toLocaleLowerCase()===x.toLocaleLowerCase())):
        [...existing,...tags.filter(x=>!existing.some(t=>t.toLocaleLowerCase()===x.toLocaleLowerCase()))];
      markModified(file);
    }
    state.selectMode=false;state.selected.clear();close();render();return
  }
  if(action==='bulk-category'){
    const files=selectedMedia();if(!files.length)return;
    dialog('Категория для '+files.length+' '+noun(files.length,'файла','файлов','файлов'),
      '<label>Категория<input id="bulk-category-input" maxlength="80" placeholder="Введите или выберите категорию" list="known-categories"></label>'+
      categoryListHTML()+button('apply-bulk-category','Применить','primary-action'),'bulk-category');return
  }
  if(action==='apply-bulk-category'){
    const category=$('#bulk-category-input').value.trim();if(!category){$('#bulk-category-input').focus();return}
    for(const file of selectedMedia()){file.category=category;markModified(file)}
    state.selectMode=false;state.selected.clear();close();render();return
  }
  if(action==='select-all'){
    visibleRows().filter(r=>canSelect(r.entry)).forEach(r=>state.selected.add(r.entry.id));
    close();render();return
  }
  if(action==='share-selected'){
    close();handle('share');return
  }
  if(action==='move-selected'){
    dialog('Переместить','<label>Папка назначения<select id="bulk-move">'+folderOptions({uploadOnly:true})+
      '</select></label>'+button('confirm-bulk-move','Переместить','primary-action'),'bulk-move');return
  }
  if(action==='confirm-bulk-move'){
    const dest=$('#bulk-move').value;
    for(const id of state.selected){const cur=get(id);if(cur&&!isSystem(cur)&&canWriteTo(dest)&&sectionOf(cur.id)===sectionOf(dest)&&
      id!==dest&&!lineage(dest).some(e=>e.id===id)){cur.parent=dest;markModified(cur)}}
    state.selected.clear();state.selectMode=false;close();render();return
  }
  if(action==='delete-selected'){
    deleteOrArchive([...state.selected]);
    state.selected.clear();state.selectMode=false;close();render();return
  }
  if(action==='status'){
    dialog('Состояние приложения','<div class="info">В работе</div>'+button('close','Закрыть'),'status');return
  }
  if(action==='nav'){msg(id,'Раздел доступен через общую навигацию.');return}
}
$('#app').addEventListener('click',e=>{const b=e.target.closest('button');if(!b)return;if(b.dataset.section){navigate(b.dataset.section);return}if(b.dataset.view){state.view=b.dataset.view;render();return}if(b.dataset.type){state.typeFilter=b.dataset.type;render();return}if(b.dataset.nav){if(b.dataset.nav!=='Browser')handle('nav',b.dataset.nav);return}if(b.dataset.action)handle(b.dataset.action,b.dataset.id||b.dataset.tag||'')});
$$('[data-device]').forEach(b=>b.addEventListener('click',()=>{$('#device').className='device '+b.dataset.device;$$('[data-device]').forEach(x=>{x.classList.toggle('selected',x===b);x.setAttribute('aria-pressed',String(x===b))})}));
$('#app').addEventListener('change',e=>{const el=e.target;if(el.id==='upload-files'){const files=[...el.files];addFiles(files);el.value='';return}if(el.id==='upload-destination'){state.destination=el.value;return}if(el.id==='archive-enabled'){const auto=$('#archive-auto');if(auto)auto.disabled=!el.checked;return}if(el.id==='search-folder'){state.searchFolder=el.value;render();return}if(el.dataset.check){el.checked?state.selected.add(el.dataset.check):state.selected.delete(el.dataset.check);render()}});
$('#dialog-content').addEventListener('dragover',e=>{const zone=e.target.closest('#upload-zone');if(zone){e.preventDefault();zone.classList.add('dragging')}});$('#dialog-content').addEventListener('dragleave',e=>{const zone=e.target.closest('#upload-zone');if(zone)zone.classList.remove('dragging')});$('#dialog-content').addEventListener('drop',e=>{const zone=e.target.closest('#upload-zone');if(zone){e.preventDefault();zone.classList.remove('dragging');addFiles([...e.dataTransfer.files])}});
$('#browser-query').addEventListener('input',e=>{state.query=e.target.value;render()});$('#dialog-overlay').addEventListener('click',e=>{if(e.target.id==='dialog-overlay')close()});document.addEventListener('keydown',e=>{if(e.key==='Escape'&&!$('#dialog-overlay').hidden){close()}});window.addEventListener('pagehide',()=>entries.forEach(e=>{if(e.url)URL.revokeObjectURL(e.url)}));
render();
// Demo data only: sweep the visible, in-memory archive while this page is open.
setInterval(()=>{if(cleanupArchive())render()},60000);
})();
