(() => {
  'use strict';
  const root = document.getElementById('app');
  if (!root || root.dataset.initialized) return;
  root.dataset.initialized = '1';
  const $ = (selector) => root.querySelector(selector);
  const els = {
    device: document.getElementById('device'),
    scene: $('#demo-scene'),
    video: $('#live-video'),
    finder: $('#finder'),
    layer: $('#sheet-layer'),
    sheet: $('#sheet-body'),
    cover: $('#privacy-cover')
  };
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, c =>
    ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const ico = (name) => `<svg class="ico" aria-hidden="true"><use href="#i-${name}"/></svg>`;
  const baseSettings = () => ({ratio:'4:3',resolution:'Высокое',videoQuality:'720p',audioQuality:'128 кбит/с',maxVideoSec:60,maxAudioSec:600,grid:false,zoom:1,torch:false,gpsTrack:true,gpsShow:true,mic:false});
  const presets = [
    {id:'standard',name:'Стандарт',...baseSettings()},
    {id:'detail',name:'Детали',...baseSettings(),ratio:'1:1',resolution:'Максимальное',grid:true},
    {id:'report',name:'Репортаж',...baseSettings(),ratio:'16:9',resolution:'Среднее',gpsShow:false}
  ];
  const assignments = [
    {id:'site',name:'Фасады — Site A',instructions:'Снять фасад здания с разных ракурсов, общий вид и детали входной группы. Координаты обязательны, если устройство может их определить.',categories:['Фасад','Детали','Документация','Другое'],shots:['Общий план','Входная группа','Фасад сбоку'],gpsRequired:true,categoryRequired:true},
    {id:'interior',name:'Интерьер — зал 02',instructions:'Общий план интерьера, освещение и архитектурные детали. GPS необязателен.',categories:['Интерьер','Детали','Освещение'],shots:['Общий план','Детали'],gpsRequired:false,categoryRequired:false},
    {id:'none',name:'Без задания (личное фото)',instructions:'Личная съёмка без требований задания.',categories:['Личное','Документация','Другое'],shots:[],gpsRequired:false,categoryRequired:false}
  ];
  const state = {
    media:'photo', mode:'demo', facing:'environment', hidden:false,
    assignment:'site',category:'Фасад',shot:'',description:'',preset:'standard',settings:baseSettings(),
    busy:false, recording:false, recordStart:0, micGranted:false, resumeVideoAfterAudio:false, gps:null, gpsStatus:'pending',
    sheet:'', captures:[], log:[{kind:'info',message:'Демонстрационный интерфейс. Снимки и видео остаются в памяти страницы.'}]
  };
  let stream = null, micStream = null, recordStream = null, recorder = null;
  let recorderTick = null, demoTick = null, geoWatch = null, feedbackTimer = null;
  let openSheetFocus = null;
  const assignment = () => assignments.find(a => a.id === state.assignment) || assignments[0];
  const currentPreset = () => presets.find(p => p.id === state.preset) || presets[0];
  const canTrack = () => state.settings.gpsTrack || assignment().gpsRequired;
  const isRecording = () => state.recording;

  function log(message,kind='info') {
    state.log.unshift({kind,message,time:new Date().toLocaleTimeString('ru-RU',{hour:'2-digit',minute:'2-digit'})});
    state.log = state.log.slice(0,20);
    $('#brand-status').textContent = kind === 'error' ? 'Ошибка' : kind === 'warning' ? 'Предупреждение' : 'В работе';
    $('#brand-led').className = 'led' + (kind === 'error' ? ' bad' : kind === 'warning' ? ' warn' : '');
  }
  function notify(message,kind='info') {
    log(message,kind);
    const toast = $('#capture-feedback');
    toast.textContent = message;
    toast.classList.toggle('error',kind==='error');
    toast.hidden = state.hidden;
    clearTimeout(feedbackTimer);
    feedbackTimer = setTimeout(() => { toast.hidden = true; },3300);
  }
  function timeText(ms) {
    const n = Math.floor(Math.max(0,ms)/1000);
    return String(Math.floor(n/60)).padStart(2,'0')+':'+String(n%60).padStart(2,'0');
  }
  function updateTimer() {
    const t = timeText(Date.now()-state.recordStart);
    $('#record-time').textContent = t;
    $('#blind-record-time').textContent = t;
    $('#audio-elapsed').textContent = t;
    if(state.recording && !state.busy && (Date.now()-state.recordStart >= (state.media==='audio'?state.settings.maxAudioSec:state.settings.maxVideoSec)*1000)) {
      stopRecording();
      log('Достигнута максимальная длительность; запись остановлена');
    }
  }
  function refresh() {
    const p = state.settings;
    [...root.querySelectorAll('[data-media]')].forEach(b => {
      const active=b.dataset.media===state.media;
      b.classList.toggle('active',active);
      b.setAttribute('aria-pressed',String(active));
      b.disabled = state.recording;
    });
    $('#shutter').classList.toggle('video',state.media!=='photo');
    $('#shutter').classList.toggle('audio',state.media==='audio');
    $('#shutter').classList.toggle('recording',state.recording);
    $('#shutter').setAttribute('aria-label',state.media==='photo'?'Снять фото':state.recording?'Остановить запись':state.media==='audio'?'Начать запись аудио':'Начать запись видео');
    $('#blind-shutter').classList.toggle('video',state.media!=='photo');
    $('#blind-shutter').classList.toggle('audio',state.media==='audio');
    $('#blind-shutter').classList.toggle('recording',state.recording);
    $('#blind-shutter').setAttribute('aria-label',state.media==='photo'?'Снять фото в слепом режиме':state.recording?'Остановить запись':state.media==='audio'?'Начать запись аудио':'Начать запись видео');
    $('#shutter').disabled=state.busy;
    $('#blind-shutter').disabled=state.busy;
    $('#record-badge').hidden=!state.recording || state.media==='audio';
    $('#audio-stage').hidden=state.media!=='audio';
    els.finder.hidden=state.media==='audio';
    $('#audio-elapsed').hidden=!state.recording || state.media!=='audio';
    $('#audio-stage').classList.toggle('recording',state.recording);
    $('#blind-timer').hidden=!state.recording;
    if(state.recording) updateTimer();
    $('#blind-note').textContent=state.media==='photo'?'Если клавиши громкости недоступны — нажмите кнопку':state.media==='audio'?'Нажмите для начала или завершения аудиозаписи':'Нажмите для начала или завершения видеозаписи';
    const ratio = p.ratio.split(':').map(Number);
    els.finder.style.aspectRatio=ratio[0]/ratio[1];
    els.scene.style.setProperty('--zoom',String(p.zoom));
    els.scene.classList.toggle('mirrored',state.facing==='user');
    els.video.classList.toggle('mirrored',state.facing==='user');
    $('#grid').hidden=!p.grid;
    $('#zoom-indicator').hidden=p.zoom===1;
    $('#zoom-indicator').textContent=p.zoom.toFixed(1)+'×';
    
    els.video.hidden=state.mode!=='live';
    els.scene.hidden=state.mode==='live';
    const torch=$('#torch-button');
    torch.classList.toggle('active',p.torch);
    torch.setAttribute('aria-pressed',String(p.torch));
    torch.disabled=state.recording || state.media==='audio';
    $('[data-action="flip"]').disabled=state.recording || state.media==='audio';
    const gps=$('#gps-status');
    gps.hidden=!p.gpsShow;
    gps.classList.toggle('ready',state.gpsStatus==='ready'&&!!state.gps);
    $('#gps-text').textContent=!canTrack()?'GPS выключен':state.gpsStatus==='ready'&&state.gps?'GPS ±'+Math.round(state.gps.accuracy)+' м':state.gpsStatus==='unavailable'?'GPS недоступен':state.gpsStatus==='requesting'?'GPS: поиск…':'GPS: ожидание';
    els.cover.hidden=!state.hidden;
  }
  function row(title,sub,action,selected) {
    return `<button class="sheet-row${selected?' selected':''}" type="button" data-action="${esc(action)}"><span><strong>${esc(title)}</strong>${sub?`<small>${esc(sub)}</small>`:''}</span>${selected?ico('check'):ico('chevron')}</button>`;
  }
  function optionList(values,selected) {
    return values.map(v=>`<option value="${esc(v)}"${v===selected?' selected':''}>${esc(v)}</option>`).join('');
  }
  function durationLabel(seconds) {return seconds < 60 ? seconds+' сек' : seconds%60===0 ? (seconds/60)+' мин' : Math.floor(seconds/60)+' мин '+(seconds%60)+' сек';}
   function toggle(label,description,id,checked,disabled=false) {
    return `<label class="setting-toggle${disabled?' setting-disabled':''}"><span><strong>${esc(label)}</strong>${description?`<small>${esc(description)}</small>`:''}</span><input id="${id}" type="checkbox" ${checked?'checked ':''}${disabled?'disabled':''}></label>`;
  }
  function field(title,id,body) {return `<label class="sheet-field">${esc(title)}${body}</label>`;}
  function openSheet(name,focusGps=false) {
    if(state.hidden)return;
    if(state.recording && name!=='status') { notify('Остановите запись перед изменением настроек','warning'); return; }
    state.sheet=name;
    const headings={assignment:'Задание и данные съёмки',settings:'Настройки камеры',status:'Состояние PhotoBunker',last:'Последняя съёмка'};
    $('#sheet-title').textContent=headings[name]||'Информация';
    renderSheet();
    els.layer.hidden=false;
    els.layer.querySelector('.sheet').focus();
    if(focusGps)requestAnimationFrame(()=>$('#gps-settings')?.scrollIntoView({block:'nearest',behavior:'smooth'}));
  }
  function closeSheet() {
    els.layer.hidden=true;
    state.sheet='';
  }
  function renderSheet() {
    let h='';
    const a=assignment(),p=state.settings;
    if(state.sheet==='assignment') {
      h=`<div class="sheet-section"><span class="section-title">Задание</span>
      ${field('Выбрать задание','task-select',`<select id="task-select">${assignments.map(x=>`<option value="${x.id}"${x.id===state.assignment?' selected':''}>${esc(x.name)}</option>`).join('')}</select>`)}
      <div class="instruction" id="task-instructions">${esc(a.instructions)}</div>
      ${a.gpsRequired?'<span class="tag">GPS обязателен по правилам задания</span>':''}${a.categoryRequired?'<span class="tag">Категория обязательна по правилам задания</span>':''}</div>
      <div class="sheet-section"><span class="section-title">Данные следующих снимков</span>
      ${field('Категория','category-select',`<select id="category-select"><option value="">Без категории</option>${optionList(a.categories,state.category)}</select>`)}
      ${a.shots.length?field('Ракурс','shot-select',`<select id="shot-select"><option value="">Свободная съёмка</option>${optionList(a.shots,state.shot)}</select>`):''}
      ${field('Описание съёмки','description',`<textarea id="description" rows="3" maxlength="2000" placeholder="Информация для будущих кадров">${esc(state.description)}</textarea>`)}
      <p class="sheet-note">Категория, ракурс и описание применяются к следующим материалам в этой демонстрации.</p></div>
      <button type="button" class="sheet-btn primary" data-action="save-assignment">Готово</button>`;
    }
    if(state.sheet==='settings') {
      h=`<div class="sheet-section"><span class="section-title">Пресеты камеры</span>
      <div class="sheet-pill-row">${presets.map(x=>`<button class="preset-pill${state.preset===x.id?' selected':''}" type="button" data-action="preset:${esc(x.id)}">${esc(x.name)}</button>`).join('')}</div>
      ${field('Название пресета','setting-name',`<input id="setting-name" maxlength="55" value="${esc(currentPreset().name)}" placeholder="Название пресета">`)}
      <div class="sheet-actions"><button type="button" class="sheet-btn primary" data-action="save-preset">${ico('save')} Сохранить пресет</button><button type="button" class="sheet-btn" data-action="add-preset">${ico('plus')} Добавить пресет</button></div>
      <p class="sheet-note" id="preset-notice">Параметры ниже можно сохранять в выбранный пресет. В макете они хранятся только до обновления страницы.</p></div>
      <div class="sheet-section"><span class="section-title">Фото</span>
      ${field('Пропорции','setting-ratio',`<select id="setting-ratio">${optionList(['1:1','4:3','3:2','16:9'],p.ratio)}</select>`)}
      ${field('Качество фото','setting-resolution',`<select id="setting-resolution">${optionList(['Максимальное','Высокое','Среднее','Низкое'],p.resolution)}</select>`)}
      <label class="sheet-slider"><span class="slider-head">Масштаб <strong id="zoom-value">${p.zoom.toFixed(1)}×</strong></span><input type="range" id="setting-zoom" min="1" max="3" step="0.1" value="${p.zoom}"></label>
      ${toggle('Сетка кадрирования 3х3','Не показывается на готовых кадрах','setting-grid',p.grid)}
      ${toggle('Фонарик','Если поддерживается устройством','setting-torch',p.torch)}
      </div>
      <div class="sheet-section"><span class="section-title">Видео</span>
      ${field('Качество видео','setting-video-quality',`<select id="setting-video-quality">${optionList(['480p','720p','1080p'],p.videoQuality)}</select>`)}
      <label class="sheet-slider"><span class="slider-head">Максимальная длительность видео <strong id="video-duration-value">${durationLabel(p.maxVideoSec)}</strong></span><input type="range" id="setting-max-video" min="5" max="300" step="5" value="${p.maxVideoSec}"></label>
      ${toggle('Записывать звук в видео','Используется разрешённый микрофон','setting-mic',p.mic)}
      </div>
      <div class="sheet-section"><span class="section-title">Аудио</span>
      ${field('Качество аудио','setting-audio-quality',`<select id="setting-audio-quality">${optionList(['64 кбит/с','128 кбит/с','192 кбит/с','256 кбит/с'],p.audioQuality)}</select>`)}
      <label class="sheet-slider"><span class="slider-head">Максимальная длительность аудио <strong id="audio-duration-value">${durationLabel(p.maxAudioSec)}</strong></span><input type="range" id="setting-max-audio" min="5" max="3000" step="5" value="${p.maxAudioSec}"></label>
      <p class="sheet-note">Аудио записывается без видеопотока. Фактический битрейт зависит от браузера и кодека.</p></div>
      <div class="sheet-section" id="gps-settings"><span class="section-title">Геолокация</span>
      ${toggle('Отслеживать GPS',a.gpsRequired?'Включено обязательно по правилам задания':'Можно выключить для следующей съёмки','setting-gps-track',canTrack(),a.gpsRequired)}
      ${toggle('Показывать GPS над кнопкой «Снять»','Это не влияет на запись координат','setting-gps-show',p.gpsShow)}
      <div class="info-stat"><span>Текущий статус</span><b>${state.gpsStatus==='ready'&&state.gps?'±'+Math.round(state.gps.accuracy)+' м':!canTrack()?'Выключен':'Ожидает координаты'}</b></div>
      <button type="button" class="sheet-btn" data-action="locate" ${!canTrack()?'disabled':''}>${ico('pin')} Определить координаты</button>
      <p class="sheet-note">Геолокация запрашивается с разрешения устройства. Браузер может приостанавливать GPS при сворачивании приложения.</p></div>
      <div class="sheet-section"><span class="section-title">Разрешения устройства</span>
      <div class="sheet-actions"><button type="button" class="sheet-btn" data-action="allow-camera">${ico('camera')} Разрешить камеру</button><button type="button" class="sheet-btn" data-action="allow-mic">${ico('mic')} Разрешить микрофон</button></div>
      <p class="sheet-note" id="permission-note">Камера нужна для фото и видео; микрофон — для аудио и видео со звуком. Браузер запросит разрешение отдельно.</p></div>`;
    }
    if(state.sheet==='status') {
      h=`<p class="sheet-note">Состояние операций. В этом HTML файлы остаются только в памяти браузера.</p>
      ${state.captures.length?`<button type="button" class="sheet-btn" data-open="last">${ico(state.captures[0].kind==='audio'?'mic':state.captures[0].kind==='video'?'video':'camera')} Последняя съёмка · ${esc(state.captures[0].name)}</button>`:''}
      ${state.log.map(x=>`<div class="sheet-section"><div class="info-stat"><span>${esc(x.time||'')}</span><b>${x.kind==='error'?'Ошибка':x.kind==='warning'?'Предупреждение':'Событие'}</b></div><span class="sheet-note">${esc(x.message)}</span></div>`).join('')}`;
    }
    if(state.sheet==='last') {
      const item=state.captures[0];
      h=item?`${item.kind==='photo'?`<img class="photo-preview-large" src="${item.url}" alt="Последний кадр">`:item.kind==='audio'?`<div class="audio-playback">${ico('mic')}<strong>Аудиозапись</strong><audio src="${item.url}" controls preload="metadata"></audio></div>`:`<div class="photo-preview-large"><video src="${item.url}" controls playsinline preload="metadata"></video></div>`}
      <div class="sheet-section"><div class="info-stat"><span>Файл</span><b>${esc(item.name)}</b></div><div class="info-stat"><span>Задание</span><b>${esc(item.assignment)}</b></div><div class="info-stat"><span>Пресет</span><b>${esc(item.preset)}</b></div><div class="info-stat"><span>Категория</span><b>${esc(item.category||'—')}</b></div><div class="info-stat"><span>Тип</span><b>${item.kind==='photo'?'Фото':item.kind==='audio'?'Аудио':'Видео'}</b></div></div>
      <button type="button" class="sheet-btn" data-action="delete-last">Убрать из демо</button>`:'<p class="sheet-note">Снимков пока нет.</p>';
    }
    els.sheet.innerHTML=h;
  }
  function stopGeo() {
    if(geoWatch!==null && navigator.geolocation)navigator.geolocation.clearWatch(geoWatch);
    geoWatch=null;state.gps=null;state.gpsStatus='pending';
    refresh();
  }
  function startGeo() {
    if(!canTrack()) {stopGeo();return;}
    if(geoWatch!==null)return;
    if(!navigator.geolocation){state.gpsStatus='unavailable';refresh();return;}
    state.gpsStatus='requesting';refresh();
    // One watch only; no background-GPS guarantee in a web app.
    try {
      geoWatch=navigator.geolocation.watchPosition(pos=>{
        if(!canTrack())return;
        state.gps={lat:pos.coords.latitude,lng:pos.coords.longitude,accuracy:pos.coords.accuracy};
        state.gpsStatus='ready';refresh();
        const gpsText=$('#gps-settings .info-stat b');if(gpsText)gpsText.textContent='±'+Math.round(state.gps.accuracy)+' м';
      },err=>{
        state.gpsStatus='unavailable';refresh();
        if(err?.code===1)log('Браузер запретил доступ к GPS','warning');
      },{enableHighAccuracy:true,maximumAge:0,timeout:15000});
    }catch {state.gpsStatus='unavailable';refresh();}
  }
  function syncGps() {
    if(canTrack()) startGeo(); else stopGeo();
  }
  function stopStream() {
    if(stream){stream.getTracks().forEach(t=>t.stop());stream=null;}
    els.video.srcObject=null;
  }
  function stopMic() {
    if(micStream){micStream.getTracks().forEach(t=>t.stop());micStream=null;}
  }
  function applyHardwareZoom(zoom) {
    if(state.mode!=='live')return;
    const track=stream?.getVideoTracks()[0];
    const supported=track?.getCapabilities?.().zoom;
    if(supported){const v=Math.max(supported.min,Math.min(supported.max,zoom));track.applyConstraints({advanced:[{zoom:v}]}).catch(()=>notify('Аппаратный масштаб недоступен','warning'));}
    else if(zoom>1)notify('Устройство не поддерживает аппаратный масштаб','warning');
  }
  async function applyHardwareTorch(on) {
    if(state.mode==='demo') {state.settings.torch=on;refresh();return true;}
    const track=stream?.getVideoTracks()[0];
    let capabilities;
    try{capabilities=track?.getCapabilities?.();}catch{}
    if(!capabilities?.torch){notify('Фонарик недоступен на этой камере','warning');state.settings.torch=false;refresh();return false;}
    try {await track.applyConstraints({advanced:[{torch:on}]});state.settings.torch=on;refresh();return true;}
    catch{notify('Не удалось переключить фонарик','warning');state.settings.torch=false;refresh();return false;}
  }
  async function startLive() {
    if(state.busy || state.recording)return;
    if(!window.isSecureContext || !navigator.mediaDevices?.getUserMedia){notify('Для камеры устройства нужен HTTPS или localhost','error');return;}
    state.busy=true;refresh();
    try {
      stopStream();
      const ideal={'480p':{width:854,height:480},'720p':{width:1280,height:720},'1080p':{width:1920,height:1080}}[state.settings.videoQuality];
       const next=await navigator.mediaDevices.getUserMedia({video:{facingMode:{ideal:state.facing},width:{ideal:ideal.width},height:{ideal:ideal.height}},audio:false});
      stream=next;
      els.video.srcObject=next;
      await els.video.play();
      state.mode='live';
      if(state.settings.torch)await applyHardwareTorch(true);
      if(state.settings.zoom>1)applyHardwareZoom(state.settings.zoom);
      if(canTrack())startGeo();
      notify('Камера устройства включена');
    } catch(err) {
      stopStream();state.mode='demo';
      notify(err?.name==='NotAllowedError'?'Нет разрешения на камеру':'Камера недоступна — остаётся демонстрация','error');
    }finally{state.busy=false;refresh();}
  }
  function switchDemo() {
    if(state.recording)return;
    stopStream();state.mode='demo';state.settings.torch=false;refresh();
    notify('Демонстрационный режим');
  }
  async function svgImage() {
    const clone=els.scene.cloneNode(true);
    clone.removeAttribute('id');clone.removeAttribute('class');clone.setAttribute('xmlns','http://www.w3.org/2000/svg');
    clone.setAttribute('width','900');clone.setAttribute('height','675');
    const source=new XMLSerializer().serializeToString(clone);
    const url=URL.createObjectURL(new Blob([source],{type:'image/svg+xml;charset=utf-8'}));
    try {const img=new Image();img.src=url;await img.decode();return img;}
    finally{URL.revokeObjectURL(url);}
  }
  function drawImageInto(canvas,img,zoom=1,flip=state.facing==='user') {
    const ctx=canvas.getContext('2d',{alpha:false});
    ctx.save();ctx.fillStyle='#15201c';ctx.fillRect(0,0,canvas.width,canvas.height);
    if(flip){ctx.translate(canvas.width,0);ctx.scale(-1,1);}
    const w=img.videoWidth||img.width, h=img.videoHeight||img.height;
    const ratio=canvas.width/canvas.height;
    let sw=w/zoom,sh=h/zoom;
    if(sw/sh>ratio)sw=sh*ratio;else sh=sw/ratio;
    ctx.drawImage(img,(w-sw)/2,(h-sh)/2,sw,sh,0,0,canvas.width,canvas.height);
    ctx.restore();
  }
  function captureSize() {
    const [x,y]=state.settings.ratio.split(':').map(Number);
    const base=state.settings.resolution==='Низкое'?640:state.settings.resolution==='Среднее'?960:state.settings.resolution==='Максимальное'?1600:1280;
    return [base,Math.round(base*y/x)];
  }
  function addCapture(item) {
    state.captures.unshift(item);
    if(state.captures.length>10){const last=state.captures.pop();URL.revokeObjectURL(last.url);}
  }
  async function takePhoto() {
    if(state.busy || state.recording)return;
    state.busy=true;refresh();
    if(!state.hidden) {
      const flash=$('#snap-flash');flash.classList.remove('show');void flash.offsetWidth;flash.classList.add('show');
    }
    try {
      const [w,h]=captureSize(),canvas=document.createElement('canvas');canvas.width=w;canvas.height=h;
      if(state.mode==='live') {
        if(els.video.readyState<2)throw Error('Камера ещё не готова');
        drawImageInto(canvas,els.video,1);
      } else drawImageInto(canvas,await svgImage(),state.settings.zoom);
      const blob=await new Promise((resolve,reject)=>canvas.toBlob(b=>b?resolve(b):reject(Error('Ошибка JPEG')),'image/jpeg',.87));
      const name='DEMO'+String(state.captures.length+1).padStart(4,'0');
      addCapture({kind:'photo',name,blob,url:URL.createObjectURL(blob),assignment:assignment().name,preset:currentPreset().name,category:state.category,shot:state.shot,description:state.description,gps:canTrack()&&state.gps?{...state.gps}:null});
      notify(name+' · снимок сохранён в памяти макета');
    }catch(err){notify('Не удалось снять фото: '+(err?.message||'ошибка'),'error');}
    finally{state.busy=false;refresh();}
  }
  function videoType() {
    if(!window.MediaRecorder)return '';
    return ['video/mp4;codecs=avc1','video/webm;codecs=vp9,opus','video/webm;codecs=vp8,opus','video/webm;codecs=vp8','video/webm','video/mp4']
      .find(x=>window.MediaRecorder.isTypeSupported?.(x))||'';
  }
  function audioType() {
    if(!window.MediaRecorder)return '';
    return ['audio/webm;codecs=opus','audio/mp4','audio/webm','audio/ogg;codecs=opus'].find(x=>window.MediaRecorder.isTypeSupported?.(x))||'';
  }
  function audioBitrate() {return parseInt(state.settings.audioQuality,10)*1000;}
  function videoBitrate() {return {'480p':1200000,'720p':3000000,'1080p':5500000}[state.settings.videoQuality]||3000000;}
  async function startVideo() {
    if(state.busy || state.recording)return;
    if(!window.MediaRecorder){notify('Этот браузер не поддерживает запись видео','error');return;}
    state.busy=true;refresh();
    try {
      let videoTrack;
      if(state.mode==='live') {
        videoTrack=stream?.getVideoTracks()[0];
        if(!videoTrack || videoTrack.readyState!=='live')throw Error('Камера ещё не готова');
        recordStream=new MediaStream([videoTrack]);
      } else {
        const canvas=document.createElement('canvas');
        const {width:vw,height:vh}={'480p':{width:854,height:480},'720p':{width:1280,height:720},'1080p':{width:1920,height:1080}}[state.settings.videoQuality];
        canvas.width=vw;canvas.height=vh;
        const img=await svgImage();
        const paint=()=>drawImageInto(canvas,img,state.settings.zoom*(1+0.008*Math.sin(Date.now()/700)),state.facing==='user');
        paint();
        if(!canvas.captureStream)throw Error('Видео в демо не поддерживается этим браузером');
        recordStream=canvas.captureStream(20);
        demoTick=setInterval(paint,50);
      }
      if(state.settings.mic){
        try {
          micStream=await navigator.mediaDevices.getUserMedia({audio:true});
          micStream.getAudioTracks().forEach(t=>recordStream.addTrack(t));
        }catch {log('Микрофон недоступен; видео записывается без звука','warning');}
      }
      const type=videoType();
      const options={...(type?{mimeType:type}:{}),videoBitsPerSecond:videoBitrate(),...(state.settings.mic?{audioBitsPerSecond:audioBitrate()}:{})};
      const localRecorder=new MediaRecorder(recordStream,options);
      const chunks=[];
      const startInfo={kind:'video',name:'VIDEO'+String(state.captures.length+1).padStart(4,'0'),assignment:assignment().name,preset:currentPreset().name,category:state.category,shot:state.shot,description:state.description,gps:canTrack()&&state.gps?{...state.gps}:null};
      localRecorder.ondataavailable=ev=>{if(ev.data?.size)chunks.push(ev.data);};
      localRecorder.onerror=()=>notify('Ошибка записи видео','error');
      localRecorder.onstop=()=>{
        clearInterval(demoTick);demoTick=null;
        stopMic();
        if(recordStream){recordStream.getTracks().filter(t=>t!==stream?.getVideoTracks()[0]).forEach(t=>t.stop());recordStream=null;}
        const blob=new Blob(chunks,{type:localRecorder.mimeType||type||'video/webm'});
        if(blob.size>0){addCapture({...startInfo,url:URL.createObjectURL(blob),blob});notify(startInfo.name+' · видео в памяти макета');}
        else notify('Видео не удалось сформировать','error');
        state.recording=false;state.busy=false;recorder=null;refresh();
      };
      localRecorder.start(250);
      recorder=localRecorder;
      state.recording=true;state.recordStart=Date.now();
      updateTimer();recorderTick=setInterval(updateTimer,250);
      log('Запись видео началась (максимум '+durationLabel(state.settings.maxVideoSec)+')');
    } catch(err) {
      clearInterval(demoTick);demoTick=null;
      stopMic();
      if(recordStream){recordStream.getTracks().filter(t=>t!==stream?.getVideoTracks()[0]).forEach(t=>t.stop());recordStream=null;}
      notify('Запись недоступна: '+(err?.message||'ошибка'),'error');
    }finally{state.busy=false;refresh();}
  }
  async function startAudio() {
    if(state.busy || state.recording)return;
    if(!window.MediaRecorder || !navigator.mediaDevices?.getUserMedia || !window.isSecureContext){notify('Для записи аудио нужен совместимый браузер и HTTPS/localhost','error');return;}
    state.busy=true;refresh();
    try {
      // Audio-only mode does not request or keep a camera stream.
      stopStream();state.mode='demo';
      micStream=await navigator.mediaDevices.getUserMedia({audio:true,video:false});
      state.micGranted=true;
      recordStream=micStream;
      const type=audioType();
      const options={...(type?{mimeType:type}:{}),audioBitsPerSecond:audioBitrate()};
      const localRecorder=new MediaRecorder(recordStream,options),chunks=[];
      const startInfo={kind:'audio',name:'AUDIO'+String(state.captures.length+1).padStart(4,'0'),assignment:assignment().name,preset:currentPreset().name,category:state.category,shot:state.shot,description:state.description,gps:canTrack()&&state.gps?{...state.gps}:null};
      localRecorder.ondataavailable=ev=>{if(ev.data?.size)chunks.push(ev.data);};
      localRecorder.onerror=()=>notify('Ошибка записи аудио','error');
      localRecorder.onstop=()=>{
        stopMic();recordStream=null;
        const blob=new Blob(chunks,{type:localRecorder.mimeType||type||'audio/webm'});
        if(blob.size){addCapture({...startInfo,blob,url:URL.createObjectURL(blob)});notify(startInfo.name+' · аудио в памяти макета');}
        else notify('Аудиозапись не сформирована','error');
        state.recording=false;state.busy=false;recorder=null;refresh();
      };
      localRecorder.start(250);
      recorder=localRecorder;state.recording=true;state.recordStart=Date.now();
      updateTimer();recorderTick=setInterval(updateTimer,250);
      log('Запись аудио началась (максимум '+durationLabel(state.settings.maxAudioSec)+')');
    } catch(err) {
      stopMic();recordStream=null;
      notify(err?.name==='NotAllowedError'?'Микрофон не разрешён':'Запись аудио недоступна: '+(err?.message||'ошибка'),'error');
    } finally {state.busy=false;refresh();}
  }
  function stopRecording() {
    if(!state.recording || !recorder || state.busy)return;
    clearInterval(recorderTick);recorderTick=null;
    state.busy=true;refresh();
    try{ if(recorder.state!=='inactive')recorder.stop(); }
    catch(err){state.busy=false;state.recording=false;refresh();notify('Не удалось завершить запись','error');}
  }
  async function shutter() {if(assignment().categoryRequired && !state.category){notify('По правилам задания выберите категорию','warning');if(!state.hidden)openSheet('assignment');return;}if(state.media==='photo'){await takePhoto();return;} if(isRecording()){stopRecording();return;} if(state.media==='audio')await startAudio();else await startVideo();}
  function setAssignment(id) {
    const a=assignments.find(x=>x.id===id);
    if(!a)return;
    state.assignment=id;
    state.category=a.categories[0]||'';state.shot='';state.description='';
    if(a.gpsRequired)state.settings.gpsTrack=true;
    syncGps();refresh();
  }
  function selectPreset(id) {
    const p=presets.find(x=>x.id===id);
    if(!p)return;
    state.preset=id;
    state.settings={...baseSettings(),...p,gpsTrack:assignment().gpsRequired||p.gpsTrack};
    if(state.mode==='live'){applyHardwareZoom(state.settings.zoom);void applyHardwareTorch(state.settings.torch);}
    syncGps();refresh();renderSheet();
  }
  function settingsFromControls() {
    return {...state.settings,ratio:$('#setting-ratio').value,resolution:$('#setting-resolution').value,videoQuality:$('#setting-video-quality').value,audioQuality:$('#setting-audio-quality').value,maxVideoSec:Number($('#setting-max-video').value),maxAudioSec:Number($('#setting-max-audio').value),zoom:Number($('#setting-zoom').value),grid:$('#setting-grid').checked,torch:$('#setting-torch').checked,gpsTrack:assignment().gpsRequired||$('#setting-gps-track').checked,gpsShow:$('#setting-gps-show').checked,mic:$('#setting-mic').checked};
  }
  function savePreset() {
    const value=$('#setting-name')?.value.trim();
    if(!value){const input=$('#setting-name');input?.focus();notify('Введите название пресета','error');return;}
    if(presets.some(p=>p.id!==state.preset && p.name.toLowerCase()===value.toLowerCase())){notify('Пресет с таким именем уже существует','warning');return;}
    state.settings=settingsFromControls();
    Object.assign(currentPreset(),{name:value,...state.settings});
    renderSheet();refresh();
    const note=$('#preset-notice');if(note)note.textContent='Пресет «'+value+'» сохранён в памяти макета.';
    log('Пресет «'+value+'» сохранён в памяти макета');
  }
  function addPreset() {
    state.settings=settingsFromControls();
    let n=presets.length+1;
    while(presets.some(p=>p.name==='Новый пресет '+n))n++;
    const id='custom-'+Date.now()+'-'+n;
    presets.push({id,name:'Новый пресет '+n,...state.settings});
    state.preset=id;
    renderSheet();refresh();
    const input=$('#setting-name');input?.focus();input?.select();
    const note=$('#preset-notice');if(note)note.textContent='Пресет добавлен. Переименуйте и нажмите «Сохранить пресет».';
    log('Добавлен новый пресет '+n);
  }
  async function applySetting(el) {
    const id=el.id;
    if(!id.startsWith('setting-')||id==='setting-name')return;
    if(id==='setting-ratio')state.settings.ratio=el.value;
    if(id==='setting-resolution')state.settings.resolution=el.value;
    if(id==='setting-video-quality')state.settings.videoQuality=el.value;
    if(id==='setting-audio-quality')state.settings.audioQuality=el.value;
    if(id==='setting-max-video'){state.settings.maxVideoSec=Number(el.value);$('#video-duration-value').textContent=durationLabel(state.settings.maxVideoSec);}
    if(id==='setting-max-audio'){state.settings.maxAudioSec=Number(el.value);$('#audio-duration-value').textContent=durationLabel(state.settings.maxAudioSec);}
    if(id==='setting-grid')state.settings.grid=el.checked;
    if(id==='setting-mic')state.settings.mic=el.checked;
    if(id==='setting-gps-show')state.settings.gpsShow=el.checked;
    if(id==='setting-zoom'){state.settings.zoom=Number(el.value);$('#zoom-value').textContent=state.settings.zoom.toFixed(1)+'×';applyHardwareZoom(state.settings.zoom);}
    if(id==='setting-torch') { await applyHardwareTorch(el.checked);el.checked=state.settings.torch; }
    if(id==='setting-gps-track'){
      state.settings.gpsTrack=assignment().gpsRequired||el.checked;
      syncGps();
    }
    refresh();
  }
  async function allowMic(){
    if(!window.isSecureContext || !navigator.mediaDevices?.getUserMedia){notify('Для микрофона нужен HTTPS или localhost','error');return;}
    try{const probe=await navigator.mediaDevices.getUserMedia({audio:true,video:false});state.micGranted=true;probe.getTracks().forEach(t=>t.stop());
      const note=$('#permission-note');if(note)note.textContent='Микрофон разрешён. Аудиозапись доступна (при поддержке браузера).';log('Доступ к микрофону разрешён');
    }catch(e){notify(e?.name==='NotAllowedError'?'Браузер отклонил доступ к микрофону':'Микрофон недоступен','error');}
  }
  function startBlind() {
    closeSheet();state.hidden=true;
    $('#capture-feedback').hidden=true;
    refresh();
    log('Слепой режим: предпросмотр скрыт, поток камеры остаётся активным');
    // Do not call stopStream(), pause(), or video.pause() here.
  }
  function resumeBlind() {state.hidden=false;refresh();}
  function handleVolume(e) {
    if(!state.hidden || e.repeat || state.busy)return;
    const keys=['AudioVolumeUp','AudioVolumeDown','VolumeUp','VolumeDown'];
    if(keys.includes(e.key) || keys.includes(e.code) || e.key===' ' || e.code==='Space'){
      e.preventDefault();void shutter();
    }
  }
  root.addEventListener('click',async event=>{
    const b=event.target.closest('button');if(!b||!root.contains(b))return;
    if(b.dataset.media){
      if(state.recording)return;
      const next=b.dataset.media;
      if(next==='audio'&&state.media!=='audio'){state.resumeVideoAfterAudio=state.mode==='live';stopStream();state.mode='demo';}
      else if(state.media==='audio'&&next!=='audio'&&state.resumeVideoAfterAudio){state.resumeVideoAfterAudio=false;state.media=next;refresh();void startLive();return;}
      state.media=next;refresh();return;
    }
    if(b.dataset.open){
      if(b.dataset.open==='location')openSheet('settings',true);else openSheet(b.dataset.open);
      return;
    }
    if(b.dataset.nav){if(b.dataset.nav!=='Камера')openSheet('status');return;}
    const a=b.dataset.action||'';
    if(a.startsWith('preset:')){selectPreset(a.substring(7));return;}
    if(a==='close-sheet'){closeSheet();return;}
    if(a==='capture'){await shutter();return;}
    if(a==='torch'){await applyHardwareTorch(!state.settings.torch);return;}
    if(a==='flip'){
      if(state.recording)return;
      state.facing=state.facing==='environment'?'user':'environment';
      if(state.mode==='live')await startLive();else refresh();return;
    }
    if(a==='privacy'){startBlind();return;}
    if(a==='resume'){resumeBlind();return;}
    if(a==='live'||a==='allow-camera'){if(state.media==='audio'){notify('Перейдите в режим Фото или Видео для включения камеры','warning');return;}closeSheet();await startLive();return;}
    if(a==='allow-mic'){await allowMic();return;}
    if(a==='demo'){closeSheet();switchDemo();return;}
    if(a==='save-assignment'){
      if(assignment().categoryRequired && !$('#category-select').value){notify('По правилам задания выберите категорию','warning');$('#category-select').focus();return;}
      state.description=$('#description').value.trim();
      state.category=$('#category-select').value;
      state.shot=$('#shot-select')?.value||'';
      closeSheet();refresh();notify('Задание и данные съёмки обновлены');return;
    }
    if(a==='save-preset'){savePreset();return;}
    if(a==='add-preset'){addPreset();return;}
    if(a==='delete-last'){
      if(state.captures[0])URL.revokeObjectURL(state.captures.shift().url);
      closeSheet();notify('Последний материал удалён из памяти макета');return;
    }
    if(a==='locate'){
      if(!canTrack()){notify('GPS выключен в настройках','warning');return;}
      stopGeo();startGeo();
      notify('Запрос геопозиции отправлен браузеру');
      return;
    }
  });
  root.addEventListener('input',event=>{const el=event.target;
    if(el.id==='task-select'){
      state.description=$('#description')?.value||'';
      setAssignment(el.value);renderSheet();return;
    }
    if(el.id.startsWith('setting-'))void applySetting(el);
  });
  els.layer.addEventListener('click',e=>{if(e.target===els.layer)closeSheet();});
  document.addEventListener('keydown',e=>{
    if(e.key==='Escape'){
      if(state.hidden){resumeBlind();e.preventDefault();return;}
      if(!els.layer.hidden){closeSheet();e.preventDefault();return;}
    }
    handleVolume(e);
  });
  document.querySelectorAll('[data-device]').forEach(b=>b.addEventListener('click',()=>{
    els.device.classList.toggle('desktop',b.dataset.device==='desktop');
    els.device.classList.toggle('phone',b.dataset.device==='phone');
    document.querySelectorAll('[data-device]').forEach(x=>x.classList.toggle('active',x===b));
  }));
  window.addEventListener('pagehide',()=>{
    if(recorder?.state==='recording')recorder.stop();
    clearInterval(recorderTick);clearInterval(demoTick);stopMic();stopStream();stopGeo();
    state.captures.forEach(c=>URL.revokeObjectURL(c.url));
  });
  refresh();
})();
