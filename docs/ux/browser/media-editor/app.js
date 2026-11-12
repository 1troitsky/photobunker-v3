
(()=>{
'use strict';
const app=document.getElementById('app');
const $=(q)=>app.querySelector(q), $$=(q)=>[...app.querySelectorAll(q)];
const esc=(v)=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const clone=o=>JSON.parse(JSON.stringify(o));
const fmt=(s,prec=false)=>{s=Math.max(0,Number.isFinite(s)?s:0);const m=Math.floor(s/60);let t=Math.floor(s%60);return `${m}:${String(t).padStart(2,'0')}${prec?'.'+Math.floor((s%1)*10):''}`};
const $player=kind=>kind==='video'?$('#video-player'):$('#audio-player');
const durations={video:4,audio:8};
const defaultForm=(kind)=>({
 name:kind==='video'?'Обход главного фасада':'Звуки у здания',
 description:kind==='video'?'Короткий проход вдоль фасада. Дневное освещение.':'Фоновая запись улицы рядом с объектом.',
 gps:'41.64781, 41.63692',category:kind==='video'?'Фасад':'Документация',
 tags:kind==='video'?['архитектура','фасад']:['атмосфера','аудио'],
 expiry:'2026-11-20',autoRenew:false,assignment:'site',
 public:{enabled:true,added:true,edited:false,gps:false,description:true,tags:true,metadata:false},
 decision:'',comment:''
});
const createState=kind=>({kind,source:kind==='video'?MEDIA_VIDEO:MEDIA_AUDIO,objectURL:null,
 duration:durations[kind],start:0,end:durations[kind],applied:false,compared:false,
 undo:[{start:0,end:durations[kind]}],undoIdx:0,
 form:defaultForm(kind),saved:null,stills:[],stillURL:null,wavURL:null,wavBlob:null,peaks:null,decoded:null,decodeSource:null,
 reviewHistory:[{decision:'На рассмотрении',comment:'Ожидает решения куратора'}]});
const modes={video:createState('video'),audio:createState('audio')};
let kind='video',tab='info',mediaTool='trim',sheetTimer=null,playingPreview=false;
const state=()=>modes[kind], player=()=> $player(kind);
const events=[];
const statuses=[{type:'success',title:'Редактор открыт'}];
const controls=['#name','#description','#gps','#category','#expiry','#auto-renew','#assignment','#public-enabled','#review-comment'];

function getForm(){const f={...state().form};
 for(const [id,key] of [['name','name'],['description','description'],['gps','gps'],['category','category'],['expiry','expiry'],['assignment','assignment'],['review-comment','comment']]) f[key]=$('#'+id).value;
 f.autoRenew=$('#auto-renew').checked;
 f.public={enabled:$('#public-enabled').checked};
 $$('[data-public]').forEach(el=>f.public[el.dataset.public]=el.checked);
 f.tags=[...state().form.tags];
 f.decision=state().form.decision;
 return f;}
function take(){const s=state();return {form:clone(getForm()),start:Number(s.start.toFixed(2)),end:Number(s.end.toFixed(2)),applied:s.applied,source:s.source}};
function updateSave(){const s=state();$('#save').disabled=JSON.stringify(take())===JSON.stringify(s.saved)}
function inform(type,title){statuses.unshift({type,title});if(statuses.length>20)statuses.length=20;$('#status-text').textContent=type==='error'?'Ошибка':type==='warning'?'Предупреждение':'В работе';$('.led').className='led '+(type==='error'?'error':type==='warning'?'warning':'')}
function sheet(title,markup){clearTimeout(sheetTimer);$('#sheet-title').textContent=title;$('.sheetbody').innerHTML=markup;$('.modal-layer').hidden=false;$('.sheet').focus()}
function closeSheet(){clearLocalPreviews();$('.modal-layer').hidden=true;$('.sheetbody').innerHTML='';}
function btn(action,label,cls=''){return `<button class="sheetbutton ${cls}" data-action="${action}">${esc(label)}</button>`}
function note(title,text){sheet(title,`<div class="note">${esc(text)}</div>`+btn('close-sheet','Понятно','primary'))}
function updateTags(){const box=$('.chips');box.innerHTML=state().form.tags.map((tag,i)=>`<span class="chip"><button data-action="edit-tag" data-index="${i}">${esc(tag)}</button><button data-action="remove-tag" data-index="${i}" aria-label="Удалить тег">×</button></span>`).join('')}
function tagPicker(){const possible=['архитектура','фасад','документация','аудио','видео','атмосфера','город','интерьер','важное'];const tags=state().form.tags;
 sheet('Теги',`<div class="note">Выбери тег или добавь свой.</div>${possible.map(tag=>`<button class="sheetbutton" data-action="toggle-tag" data-tag="${esc(tag)}">${tags.includes(tag)?'✓ ':''}${esc(tag)}</button>`).join('')}<label class="field">Новый тег<input id="tag-new" maxlength="40" placeholder="Название тега"></label>${btn('add-tag','Добавить тег','primary')}`)}
function setForm(f){$('#name').value=f.name;$('#description').value=f.description;$('#gps').value=f.gps;$('#category').value=f.category;$('#expiry').value=f.expiry;$('#auto-renew').checked=f.autoRenew;$('#assignment').value=f.assignment;$('#public-enabled').checked=f.public.enabled;$$('[data-public]').forEach(el=>el.checked=Boolean(f.public[el.dataset.public]));$('#review-comment').value=f.comment;state().form=clone(f);updateTags();updatePublic();updateReview();updateMove()}
function updatePublic(){$('.public-fields').classList.toggle('off',!$('#public-enabled').checked)}
function updateMove(){const prev=state().saved?.form.assignment??'site';$('.move-warning').hidden=$('#assignment').value===prev;$('#irreversible').hidden=$('#assignment').value!=='site';updateSave()}
function updateReview(){const f=state().form;$$('[data-decision]').forEach(b=>b.classList.toggle('active',b.dataset.decision===f.decision));const res=$('[data-decision="reshoot"]');if(res)res.lastChild.textContent=kind==='video'?'Переснять':'Перезаписать';$('.review-state').textContent=state().reviewHistory.at(-1)?.decision||'На рассмотрении';const history=$('.review-history');history.innerHTML=state().reviewHistory.slice().reverse().map(x=>`<i class="dot"></i><div><strong>${esc(x.decision)}</strong><small>${esc(x.comment)}</small></div>`).join('')}
function updateModeUI(){const s=state();$('#editor-title').textContent=kind==='video'?'Редактировать видео':'Редактировать аудио';$('#media-tab-label').textContent=kind==='video'?'Видео':'Аудио';$('.crumbs button:last-child').textContent=kind==='video'?'SITE0005':'SITE0006';$$('[data-kind]').forEach(b=>b.classList.toggle('active',b.dataset.kind===kind));$('#stage-video').hidden=kind!=='video';$('#stage-audio').hidden=kind!=='audio';$('#video-tools').hidden=kind!=='video';$('#audio-tools').hidden=kind!=='audio';$('#audio-export').hidden=kind!=='audio';$('#audio-stage-title').textContent=s.form.name;const hint=$('[data-page=review] .hint');if(hint)hint.textContent=kind==='audio'?'Для исправления, перезаписи и отклонения комментарий обязателен.':'Для исправления, пересъёмки и отклонения комментарий обязателен.';$('#frame-tools').hidden=kind!=='video'||mediaTool!=='frame';$('#trim-tools').hidden=mediaTool!=='trim';
 const video=$('#video-player'),audio=$('#audio-player');
 if(kind==='video'){video.src=s.source;video.load()}else{audio.src=s.source;audio.load();void readPeaks(s)} updatePlaybackUI();updateRanges();drawWave();setForm(s.form);updateSave()}
function setMode(next){if(next===kind)return;const current=player();current.pause();state().form=getForm();state().compared=false;kind=next;mediaTool='trim';playingPreview=false;$('#audio-result').hidden=true;$('#still-result').hidden=true;$('#still-empty').hidden=true;$$('[data-mediatool]').forEach(b=>b.classList.toggle('active',b.dataset.mediatool==='trim'));changeTab('info');updateModeUI();}
function changeTab(value){tab=value;$$('[data-tab]').forEach(b=>b.classList.toggle('active',b.dataset.tab===value));$$('[data-page]').forEach(e=>e.hidden=e.dataset.page!==value);$('#scroll-area').scrollTop=0}
function changeTool(value){mediaTool=value;$$('[data-mediatool]').forEach(b=>b.classList.toggle('active',b.dataset.mediatool===value));$('#frame-tools').hidden=value!=='frame';$('#trim-tools').hidden=value!=='trim';}
function updateRanges(){const s=state();const d=Math.max(.5,s.duration);for(const [id,val] of [['trim-start',s.start],['trim-end',s.end]]){const input=$('#'+id);input.max=String(d);input.value=String(val)}$('#trim-start-out').textContent=fmt(s.start,true);$('#trim-end-out').textContent=fmt(s.end,true);$('#clip-duration').textContent=fmt(s.end-s.start,true);$('#total-time').textContent=fmt(d);$('#seek').max=String(d);updateSave()}
function editRange(which,value){const s=state(),gap=.1;value=Number(value);if(!Number.isFinite(value))return;if(which==='start'){s.start=Math.min(Math.max(0,value),Math.max(0,s.end-gap))}else{s.end=Math.max(Math.min(s.duration,value),Math.min(s.duration,s.start+gap))}s.applied=false;s.compared=false;updateRanges();updateSave()}
function record(){const s=state(),latest={start:s.start,end:s.end};if(JSON.stringify(s.undo[s.undoIdx])===JSON.stringify(latest))return;s.undo=s.undo.slice(0,s.undoIdx+1);s.undo.push(latest);if(s.undo.length>60)s.undo.shift();s.undoIdx=s.undo.length-1;updateUndo()}
function updateUndo(){const s=state();$('[data-action=undo]').disabled=s.undoIdx===0;$('[data-action=redo]').disabled=s.undoIdx===s.undo.length-1}
function undo(delta){const s=state(),next=s.undoIdx+delta;if(next<0||next>=s.undo.length)return;s.undoIdx=next;s.start=s.undo[next].start;s.end=s.undo[next].end;s.applied=false;s.compared=false;updateRanges();updateUndo()}
function resetMedia(){const s=state();s.start=0;s.end=s.duration;s.applied=false;s.compared=false;record();updateRanges();updatePlaybackUI()}
function compare(){const s=state();s.compared=!s.compared;const b=$('[data-action=compare]');b.classList.toggle('active',s.compared);b.setAttribute('aria-pressed',String(s.compared));player().pause();player().currentTime=s.compared?0:s.start;updatePlaybackUI()}
function updatePlaybackUI(){const p=player();const playing=!p.paused&&!p.ended;$('#play-shape').setAttribute('d',playing?'M7 5v14M17 5v14':'m8 5 12 7-12 7z');$('.media-play-overlay').hidden=playing||kind!=='video';if(playing)$('#status-text').textContent='В работе'}
function togglePlay(){const s=state(),p=player(),min=s.compared?0:s.start,max=s.compared?s.duration:s.end;if(!p.paused){p.pause();return}if(p.currentTime<min||p.currentTime>=max-.03)p.currentTime=min;p.play().catch(()=>inform('warning','Воспроизведение недоступно'))}
function timeUpdate(){const s=state(),p=player();if(!Number.isFinite(p.currentTime))return;$('#current-time').textContent=fmt(p.currentTime);$('#seek').value=String(Math.min(p.currentTime,s.duration));const max=s.compared?s.duration:s.end;if(!p.paused&&p.currentTime>=max-.035){p.pause();p.currentTime=max}if(kind==='audio')drawWave()}
function updateDuration(which){const p=$player(which),s=modes[which];if(Number.isFinite(p.duration)&&p.duration>0){const old=s.duration;s.duration=p.duration;if(!s.applied&&Math.abs(s.end-old)<.1){s.end=s.duration;s.undo=[{start:0,end:s.end}];s.undoIdx=0}if(kind===which)updateRanges()}}
function applyTrim(){const s=state();if(s.end<=s.start+.05){note('Обрезка','Конец должен быть позже начала.');return}s.applied=true;s.compared=false;record();player().pause();player().currentTime=s.start;updatePlaybackUI();updateSave();inform('success','Границы обрезки применены')}
function previewTrim(){const s=state();s.compared=false;player().pause();player().currentTime=s.start;player().play().catch(()=>inform('warning','Невозможно воспроизвести файл'));}
async function captureFrame(){if(kind!=='video')return;const p=$('#video-player'),s=state();if(!p.videoWidth||!p.videoHeight){note('Стоп-кадр','Видео ещё не готово к захвату кадра.');return}try{const canvas=document.createElement('canvas');canvas.width=p.videoWidth;canvas.height=p.videoHeight;const c=canvas.getContext('2d');c.drawImage(p,0,0);const data=canvas.toDataURL('image/jpeg',.91);s.stillURL=data;$('#still-image').src=data;$('#still-caption').textContent='Кадр на '+fmt(p.currentTime,true)+' · JPEG';$('#still-result').hidden=false;$('#still-empty').hidden=true;$('#still-result .saved-library-link').hidden=true;refreshOutputActions();inform('success','Стоп-кадр создан')}catch(e){inform('error','Не удалось создать стоп-кадр');note('Стоп-кадр','Не удалось получить изображение из текущего видео.')}}
function download(name,url){const a=document.createElement('a');a.href=url;a.download=name;document.body.appendChild(a);a.click();a.remove()}

/* Output actions: downloads, system share sheet (when file sharing works),
   and a separate local-first Browser collection in IndexedDB.
   System share does NOT mean a file was saved in the OS photo/music library. */
const LOCAL_LIBRARY_DB='fieldwork-file-editor-browser-v1';
const LOCAL_LIBRARY_STORE='media';
let localDbPromise;
let transientItems=[];
let outputForBrowser='';
let activePreviewUrls=[];
const bytesLabel=n=>n>1048576?(n/1048576).toFixed(1)+' МБ':Math.max(1,Math.round(n/1024))+' КБ';
const fileStem=s=>String(s||'media').replace(/[\\/<>:"|?*\x00-\x1f]/g,'-').trim().slice(0,65)||'media';
function dataImageBlob(data){
 const [header,body]=String(data||'').split(',');
 if(!header||!body||!header.includes('image/jpeg'))throw Error('Изображение недоступно');
 const bytes=Uint8Array.from(atob(body),ch=>ch.charCodeAt(0));
 return new Blob([bytes],{type:'image/jpeg'});
}
function outputFile(which){
 const s=modes[which==='still'?'video':'audio'];
 if(which==='still'&&!s.stillURL)throw Error('Сначала создай стоп-кадр');
 if(which==='wav'&&!s.wavBlob)throw Error('Сначала создай WAV-фрагмент');
 const blob=which==='still'?dataImageBlob(s.stillURL):s.wavBlob;
 const name=fileStem(s.form.name)+(which==='still'?' — стоп-кадр.jpg':' — фрагмент.wav');
 return new File([blob],name,{type:which==='still'?'image/jpeg':'audio/wav'});
}
function hasOSShare(which){
 try{const file=new File([new Uint8Array(100)],which==='still'?'frame.jpg':'clip.wav',
  {type:which==='still'?'image/jpeg':'audio/wav'});
 return typeof navigator.share==='function'&&typeof navigator.canShare==='function'&&navigator.canShare({files:[file]});
 }catch{return false}
}
function refreshOutputActions(){
 const shareStill=$('[data-action=share-still]'),shareWav=$('[data-action=share-wav]');
 if(shareStill)shareStill.hidden=!hasOSShare('still');
 if(shareWav)shareWav.hidden=!hasOSShare('wav');
}
function saveToDevice(which){
 try{
  const file=outputFile(which),url=URL.createObjectURL(file);
  download(file.name,url);
  setTimeout(()=>URL.revokeObjectURL(url),60000);
  inform('success','Скачивание запрошено');
 }catch(e){note('Сохранение',e.message)}
}
function shareToOS(which){
 // Keep navigator.share() inside the user-gesture call, without async preprocessing.
 try{
  const file=outputFile(which);
  if(!navigator.canShare?.({files:[file]})||!navigator.share){
   note('Системное меню','Передача этого файла не поддерживается браузером.');return;
  }
  navigator.share({files:[file],title:which==='still'?'Стоп-кадр':'Аудиофрагмент'})
   .then(()=>inform('success','Системное меню завершено'))
   .catch(error=>{
     if(error?.name!=='AbortError')note('Системное меню','Не удалось открыть меню для файла.');
   });
 }catch(e){note('Системное меню',e.message)}
}
function openLocalDb(){
 if(localDbPromise)return localDbPromise;
 if(!('indexedDB' in window))return Promise.resolve(null);
 localDbPromise=new Promise(resolve=>{
  try{
   const request=indexedDB.open(LOCAL_LIBRARY_DB,1);
   request.onupgradeneeded=()=>{
    const db=request.result;
    if(!db.objectStoreNames.contains(LOCAL_LIBRARY_STORE))db.createObjectStore(LOCAL_LIBRARY_STORE,{keyPath:'id'});
   };
   request.onsuccess=()=>resolve(request.result);
   request.onerror=()=>resolve(null);
   request.onblocked=()=>resolve(null);
  }catch{resolve(null)}
 });
 return localDbPromise;
}
async function libraryWrite(entry){
 const db=await openLocalDb();
 if(!db){transientItems.unshift(entry);return false}
 await new Promise((resolve,reject)=>{
  const tx=db.transaction(LOCAL_LIBRARY_STORE,'readwrite');
  tx.objectStore(LOCAL_LIBRARY_STORE).put(entry);
  tx.oncomplete=()=>resolve();tx.onerror=()=>reject(tx.error||Error('Storage error'));
  tx.onabort=()=>reject(tx.error||Error('Storage canceled'));
 });
 return true;
}
async function libraryEntries(){
 const db=await openLocalDb();
 if(!db)return [...transientItems];
 const rows=await new Promise((resolve,reject)=>{
  const tx=db.transaction(LOCAL_LIBRARY_STORE,'readonly');
  const request=tx.objectStore(LOCAL_LIBRARY_STORE).getAll();
  request.onsuccess=()=>resolve(request.result);request.onerror=()=>reject(request.error);
 });
 return rows.sort((a,b)=>b.created-b.created);
}
async function libraryRemove(id){
 const db=await openLocalDb();
 if(!db){transientItems=transientItems.filter(x=>x.id!==id);return}
 await new Promise((resolve,reject)=>{
  const tx=db.transaction(LOCAL_LIBRARY_STORE,'readwrite');
  tx.objectStore(LOCAL_LIBRARY_STORE).delete(id);
  tx.oncomplete=()=>resolve();tx.onerror=()=>reject(tx.error);
 });
}
function saveBrowserChoice(which){
 outputForBrowser=which;
 sheet('Сохранить в Browser',
  '<label class="field">Папка назначения<select id="browser-destination" class="browser-folder-select">'+
  '<option value="Мои фото">Мои фото</option>'+
  '<option value="Городские прогулки">Городские прогулки</option>'+
  '<option value="Студия">Студия</option></select></label>'+
  '<p class="hint">Файл будет отдельным элементом в выбранной папке.</p>'+
  btn('commit-browser-save','Сохранить','primary')+btn('close-sheet','Отмена'));
}
async function saveBrowserCommit(){
 const which=outputForBrowser;
 const folder=$('#browser-destination')?.value||'Мои фото';
 try{
  const file=outputFile(which);
  const entry={id:'file-'+Date.now()+'-'+Math.random().toString(36).slice(2,8),
   name:file.name,kind:which==='still'?'photo':'audio',mime:file.type,
   blob:file,created:Date.now(),folder};
  const persisted=await libraryWrite(entry);
  closeSheet();
  $$('#still-result .saved-library-link,#audio-result .saved-library-link').forEach(b=>b.hidden=false);
  inform(persisted?'success':'warning',persisted?'Сохранено в Browser':'Сохранено в текущей вкладке');
  // If IndexedDB is unavailable, the current tab still holds the file; no extra blocking dialog.
 }catch(e){note('Сохранение', 'Не удалось сохранить файл в локальную медиатеку. '+String(e.message||''))}
}
function clearLocalPreviews(){for(const u of activePreviewUrls)URL.revokeObjectURL(u);activePreviewUrls=[]}
async function showBrowserLibrary(){
 sheet('Сохранённые файлы','<div class="local-library-empty">Открываем файлы…</div>');
 try{
  const entries=await libraryEntries();
  if($('.modal-layer').hidden||$('#sheet-title').textContent!=='Сохранённые файлы')return;
  clearLocalPreviews();
  const rows=entries.map(entry=>{
   const url=URL.createObjectURL(entry.blob);activePreviewUrls.push(url);
   return '<article class="local-media-row">'+
    '<span class="local-media-preview">'+(entry.kind==='photo'?'<img src="'+url+'" alt="">':
      '<svg viewBox="0 0 24 24"><path d="M9 18V5l11-2v13M9 18c0 3-7 4-7 1s7-4 7-1m11-2c0 3-7 4-7 1s7-4 7-1"/></svg>')+'</span>'+
    '<div class="local-media-info"><strong>'+esc(entry.name)+'</strong><small>'+esc(entry.folder)+' · '+bytesLabel(entry.blob.size)+'</small>'+
    '<div class="local-media-actions"><button data-action="library-download" data-library-id="'+esc(entry.id)+'">Скачать</button>'+
    '<button class="danger" data-action="library-delete" data-library-id="'+esc(entry.id)+'">Удалить</button></div></div>'+
    (entry.kind==='audio'?'<audio controls src="'+url+'"></audio>':'')+'</article>';
  });
  $('.sheetbody').innerHTML='<div class="local-media-list">'+(rows.length?rows.join(''):'<div class="local-library-empty">Сохранённых файлов нет</div>')+'</div>';
 }catch(e){$('.sheetbody').innerHTML='<div class="local-library-empty">Не удалось открыть локальные файлы</div>'}
}
async function libraryItemAction(button,action){
 const items=await libraryEntries();
 const row=items.find(x=>x.id===button.dataset.libraryId);
 if(!row)return;
 if(action==='library-download'){
  const url=URL.createObjectURL(row.blob);download(row.name,url);setTimeout(()=>URL.revokeObjectURL(url),60000);return;
 }
 if(action==='library-delete'){await libraryRemove(row.id);await showBrowserLibrary()}
}

function setFile(f){const next=f.type.startsWith('video/')?'video':f.type.startsWith('audio/')?'audio':null;if(!next){note('Формат файла','Выбери видеофайл или аудиофайл.');return}if(next!==kind)setMode(next);const s=state();player().pause();if(s.objectURL)URL.revokeObjectURL(s.objectURL);s.source=URL.createObjectURL(f);s.objectURL=s.source;s.duration=1;s.start=0;s.end=1;s.applied=false;s.compared=false;s.peaks=null;s.decoded=null;s.decodeSource=null;s.undo=[{start:0,end:1}];s.undoIdx=0;s.form.name=f.name.replace(/\.[^.]+$/,'');player().src=s.source;player().load();setForm(s.form);updateRanges();updateUndo();inform('success','Файл выбран')}
async function readPeaks(s){
 if(s.decodeSource===s.source&&s.decoded)return s.decoded;
 const src=s.source;s.decodeSource=src;s.decoded=null;s.peaks=null;
 try{const res=await fetch(src);if(!res.ok)throw Error('audio');const ab=await res.arrayBuffer();const AC=window.AudioContext||window.webkitAudioContext;if(!AC)throw Error('AudioContext');const ac=new AC();let buffer;try{buffer=await ac.decodeAudioData(ab)}finally{await ac.close()}
 if(s.source!==src)return null;s.decoded=buffer;const samples=buffer.getChannelData(0),count=98,step=Math.max(1,Math.floor(samples.length/count));let peaks=[];
 for(let i=0;i<count;i++){let max=0;const first=i*step,end=Math.min(samples.length,first+step);for(let k=first;k<end;k+=Math.max(1,Math.floor(step/100))){max=Math.max(max,Math.abs(samples[k]))}peaks.push(Math.min(1,max))}s.peaks=peaks;if(kind==='audio')drawWave();return buffer
 }catch(e){if(s.source===src)s.decodeSource=null;return null}
}
function drawWave(){const canvas=$('#audio-wave'),ctx=canvas.getContext('2d');if(!ctx)return;const w=canvas.width,h=canvas.height;ctx.clearRect(0,0,w,h);const s=modes.audio;for(let i=0;i<98;i++){const x=i*w/98;const n=s.peaks?(.05+s.peaks[i]*.87):(.18+.72*Math.abs(Math.sin(i*.41)*Math.cos(i*.13))+Math.abs(Math.sin(i*.91))*.08);const bh=8+n*(h-14);ctx.fillStyle=i/98*(s.duration||8)<=($player('audio').currentTime||0)?'#1ed760':'#6e9583';ctx.fillRect(x+1,(h-bh)/2,w/98-2,bh)}}
function encodeWav(buffer,startSec,endSec){const sampleRate=buffer.sampleRate,channels=Math.min(buffer.numberOfChannels,2),start=Math.floor(startSec*sampleRate),end=Math.min(buffer.length,Math.ceil(endSec*sampleRate)),frames=end-start;if(frames<=0)throw Error('Пустой фрагмент');const bytes=44+frames*channels*2;const out=new ArrayBuffer(bytes),view=new DataView(out);let off=0;const four=(str)=>{for(let k=0;k<4;k++)view.setUint8(off++,str.charCodeAt(k))};four('RIFF');view.setUint32(off,bytes-8,true);off+=4;four('WAVE');four('fmt ');view.setUint32(off,16,true);off+=4;view.setUint16(off,1,true);off+=2;view.setUint16(off,channels,true);off+=2;view.setUint32(off,sampleRate,true);off+=4;view.setUint32(off,sampleRate*channels*2,true);off+=4;view.setUint16(off,channels*2,true);off+=2;view.setUint16(off,16,true);off+=2;four('data');view.setUint32(off,frames*channels*2,true);off+=4;const inputs=Array.from({length:channels},(_,k)=>buffer.getChannelData(k));for(let i=0;i<frames;i++){for(let ch=0;ch<channels;ch++){const n=Math.max(-1,Math.min(1,inputs[ch][start+i]));view.setInt16(off,n<0?n*32768:n*32767,true);off+=2}}return new Blob([out],{type:'audio/wav'})}
async function exportAudio(){if(kind!=='audio')return;const s=state(),button=$('[data-action=audio-export]');button.disabled=true;button.textContent='Создаём WAV…';try{const decoded=s.decoded||await readPeaks(s);if(!decoded)throw Error('Браузер не смог декодировать файл');const blob=encodeWav(decoded,s.start,s.end);if(s.wavURL)URL.revokeObjectURL(s.wavURL);s.wavBlob=blob;s.wavURL=URL.createObjectURL(blob);$('#audio-result-player').src=s.wavURL;$('#audio-result').hidden=false;$('#audio-result .saved-library-link').hidden=true;refreshOutputActions();inform('success','WAV-фрагмент создан')}catch(error){inform('error','Не удалось обработать аудио');note('Обработка аудио','Браузер не смог декодировать выбранный формат.')}finally{button.disabled=false;button.textContent='Создать WAV-фрагмент'}}
function saveFile(){const s=state(),data=take();if(!data.form.name.trim()){note('Название','Название файла обязательно.');return}const gps=data.form.gps.trim();if(gps){const a=gps.split(',').map(x=>x.trim());if(a.length!==2||a.some(x=>!x||!Number.isFinite(Number(x)))||Number(a[0]) < -90||Number(a[0])>90||Number(a[1]) < -180||Number(a[1])>180){note('GPS','Введите корректные широту и долготу через запятую.');return}}
 if(data.form.decision&&data.form.decision!=='accepted'&&!data.form.comment.trim()){note('Проверка','Для этого решения нужен комментарий.');return}
 if(data.form.assignment!==s.saved?.form?.assignment){sheet('Переместить файл?',`<div class="note">Файл будет перемещён в папку выбранного задания.</div>`+btn('save-confirm','Подтвердить','primary')+btn('close-sheet','Отмена'));return}
 if(s.start>0||s.end<s.duration-.1){sheet('Сохранить изменения?',`<div class="note">По правилам задания оригинал может не сохраняться. После подтверждения обрезку нельзя будет отменить.</div>`+btn('save-confirm','Сохранить','primary')+btn('close-sheet','Отмена'));return}
 finishSave();}
function finishSave(){const s=state();s.form=getForm();s.saved=clone(take());if(s.form.decision){const labels={accepted:'Принят',correction:'Исправить',reshoot:kind==='video'?'Переснять':'Перезаписать',rejected:'Отклонён'};s.reviewHistory.push({decision:labels[s.form.decision],comment:s.form.comment.trim()||'Решение куратора'})}updateReview();updateSave();closeSheet();inform('success','Изменения сохранены');}
function checkClose(){if($('#save').disabled){note('Редактор','Несохранённых изменений нет.');return}sheet('Отменить изменения?',`<div class="note">Несохранённые изменения будут отброшены.</div>`+btn('cancel-confirm','Отменить изменения','primary')+btn('close-sheet','Продолжить'))}
function restore(){const s=state();s.form=clone(s.saved.form);s.start=s.saved.start;s.end=s.saved.end;s.applied=s.saved.applied;s.undo=[{start:s.start,end:s.end}];s.undoIdx=0;setForm(s.form);updateRanges();updateUndo();closeSheet();inform('success','Изменения отменены')}
function showStatus(){sheet('Состояние приложения',statuses.map(x=>`<div class="note"><strong>${esc(x.title)}</strong></div>`).join(''))}
function showMap(){const a=$('#gps').value.split(',').map(Number);let lat=Number.isFinite(a[0])?a[0]:41.64781,lon=Number.isFinite(a[1])?a[1]:41.63692;sheet('Уточнить местоположение',`<div class="mockmap"><div class="mapworld"><div class="park"></div><div class="road a"></div><div class="road b"></div><div class="road c"></div></div><div class="pin">◎</div></div><div class="mapcoords">${lat.toFixed(6)}, ${lon.toFixed(6)}</div>`+btn('apply-map','Применить координаты','primary'));const map=$('.mockmap');let drag=null,dx=0,dy=0;map.addEventListener('pointerdown',e=>{drag={x:e.clientX,y:e.clientY,dx,dy};map.setPointerCapture(e.pointerId)});map.addEventListener('pointermove',e=>{if(!drag)return;dx=Math.max(-180,Math.min(180,drag.dx+e.clientX-drag.x));dy=Math.max(-180,Math.min(180,drag.dy+e.clientY-drag.y));$('.mapworld').style.transform=`translate(${dx}px,${dy}px)`;$('.mapcoords').textContent=`${(lat-dy*.000012).toFixed(6)}, ${(lon-dx*.000015).toFixed(6)}`});map.addEventListener('pointerup',()=>drag=null)}
function clickAction(e){const b=e.target.closest('button');if(!b||!app.contains(b))return;if(b.dataset.tab){changeTab(b.dataset.tab);return}if(b.dataset.mediatool){changeTool(b.dataset.mediatool);return}if(b.dataset.decision){state().form.decision=b.dataset.decision;updateReview();updateSave();return}const a=b.dataset.action;
 switch(a){case 'status':showStatus();break;case 'cancel':case 'back':checkClose();break;case 'save':saveFile();break;case 'save-confirm':finishSave();break;case 'cancel-confirm':restore();break;case 'close-sheet':closeSheet();break;case 'undo':undo(-1);break;case 'redo':undo(1);break;case 'reset-media':resetMedia();break;case 'compare':compare();break;case 'toggle-play':togglePlay();break;case 'apply-trim':applyTrim();break;case 'preview-trim':previewTrim();break;case 'capture-frame':void captureFrame();break;case 'download-still':saveToDevice('still');break;case 'share-still':shareToOS('still');break;case 'save-still-browser':saveBrowserChoice('still');break;case 'audio-export':void exportAudio();break;case 'download-wav':saveToDevice('wav');break;case 'share-wav':shareToOS('wav');break;case 'save-wav-browser':saveBrowserChoice('wav');break;case 'commit-browser-save':void saveBrowserCommit();break;case 'open-library':void showBrowserLibrary();break;case 'library-download':case 'library-delete':void libraryItemAction(b,a);break;case 'select-local':$('#local-media').click();break;case 'tag-picker':tagPicker();break;case 'remove-tag':state().form.tags.splice(Number(b.dataset.index),1);updateTags();updateSave();break;case 'edit-tag':{const i=Number(b.dataset.index);sheet('Изменить тег',`<label class="field">Название<input id="tag-edit" value="${esc(state().form.tags[i])}"></label>`+`<button class="sheetbutton primary" data-action="tag-rename" data-index="${i}">Сохранить</button>`);break}
 case 'tag-rename':{const i=Number(b.dataset.index),v=$('#tag-edit')?.value.trim();if(v&&i>=0){state().form.tags[i]=v;updateTags();closeSheet();updateSave()}break}
 case 'toggle-tag':{const v=b.dataset.tag,t=state().form.tags,i=t.indexOf(v);if(i>=0)t.splice(i,1);else if(t.length<30)t.push(v);tagPicker();updateTags();updateSave();break}
 case 'add-tag':{const v=$('#tag-new')?.value.trim(),t=state().form.tags;if(v&&!t.some(x=>x.toLowerCase()===v.toLowerCase())){t.push(v);updateTags();updateSave();closeSheet()}break}
 case 'map':showMap();break;case 'apply-map':$('#gps').value=$('.mapcoords')?.textContent||$('#gps').value;closeSheet();updateSave();break;
 case 'plans':sheet('Тарифы',`<div class="note">Действие доступно в разделе тарифного плана.</div>`+btn('close-sheet','Готово','primary'));break;
 default:if(b.dataset.nav)note('Навигация','Переход выполняется из рабочего приложения.');}
}
app.addEventListener('click',clickAction);
app.addEventListener('input',e=>{if(e.target.id==='seek'){const s=state(),p=player();const x=Number(e.target.value);p.currentTime=Math.max(0,Math.min(x,s.duration));timeUpdate();return}if(e.target.id==='trim-start'){editRange('start',e.target.value);return}if(e.target.id==='trim-end'){editRange('end',e.target.value);return}if(e.target.id==='name'&&kind==='audio')$('#audio-stage-title').textContent=e.target.value||'Аудиозапись';if(e.target.matches('input,textarea,select'))updateSave()});
app.addEventListener('change',e=>{if(e.target.id==='trim-start'||e.target.id==='trim-end'){record();return}if(e.target.id==='local-media'){const f=e.target.files?.[0];if(f)setFile(f);e.target.value='';return}if(e.target.id==='public-enabled')updatePublic();if(e.target.id==='assignment')updateMove();updateSave()});
$('.modal-layer').addEventListener('click',e=>{if(e.target===$('.modal-layer'))closeSheet()});
app.addEventListener('keydown',e=>{if(e.key==='Escape'&&!$('.modal-layer').hidden)closeSheet()});
$$('[data-public]').forEach(el=>el.addEventListener('change',updateSave));
for(const k of ['video','audio']){const p=$player(k);p.addEventListener('loadedmetadata',()=>updateDuration(k));p.addEventListener('play',()=>{if(kind===k)updatePlaybackUI()});p.addEventListener('pause',()=>{if(kind===k)updatePlaybackUI()});p.addEventListener('timeupdate',()=>{if(kind===k)timeUpdate()});p.addEventListener('ended',()=>{if(kind===k)updatePlaybackUI()});}
document.querySelectorAll('[data-kind]').forEach(b=>b.addEventListener('click',()=>setMode(b.dataset.kind)));
document.querySelectorAll('[data-device]').forEach(b=>b.addEventListener('click',()=>{document.getElementById('device').className='device '+b.dataset.device;document.querySelectorAll('[data-device]').forEach(n=>n.classList.toggle('selected',b===n))}));
window.addEventListener('pagehide',()=>{for(const s of Object.values(modes)){if(s.objectURL)URL.revokeObjectURL(s.objectURL);if(s.wavURL)URL.revokeObjectURL(s.wavURL)}});
for(const m of Object.values(modes))m.saved={form:clone(m.form),start:m.start,end:m.end,applied:false,source:m.source};
setForm(state().form);changeTab('info');updateModeUI();updateUndo();
})();

