
(()=>{'use strict';
const $=(s,root=document)=>root.querySelector(s);
const esc=s=>String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const paths={
search:'<circle cx="11" cy="11" r="7"/><path d="m20 20-4-4"/>',close:'<path d="M18 6 6 18M6 6l12 12"/>',chevron:'<path d="m9 18 6-6-6-6"/>',back:'<path d="m15 18-6-6 6-6"/>',
lock:'<rect x="5" y="11" width="14" height="10" rx="2"/><path d="M8 11V7a4 4 0 0 1 8 0v4"/>',shield:'<path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10Z"/><path d="m9 12 2 2 4-4"/>',
alert:'<path d="m10.3 3.9-8.5 14.7A2 2 0 0 0 3.5 21h17a2 2 0 0 0 1.7-2.4L13.7 3.9a2 2 0 0 0-3.4 0Z"/><path d="M12 9v4m0 4h.01"/>',
devices:'<rect x="2" y="3" width="15" height="12" rx="2"/><path d="M7 19h10M12 15v4"/><rect x="17" y="8" width="5" height="11" rx="1"/>',
key:'<circle cx="8" cy="15" r="4"/><path d="m11 12 9-9 2 2-2 2 2 2-3 3-2-2-4 4"/>',
clock:'<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',trash:'<path d="M3 6h18M8 6V4h8v2M6 6l1 15h10l1-15M10 10v7m4-7v7"/>',
notifications:'<path d="M18 8a6 6 0 0 0-12 0c0 7-3 8-3 9h18c0-1-3-2-3-9"/><path d="M10 21h4"/>',
user:'<circle cx="12" cy="8" r="4"/><path d="M4 21v-2a8 8 0 0 1 16 0v2"/>',
users:'<circle cx="9" cy="8" r="3"/><path d="M3 20v-2a6 6 0 0 1 12 0v2M17 6a3 3 0 0 1 0 6M18 14a5 5 0 0 1 3 5"/>',
folder:'<path d="M3 6h7l2 3h9v11H3z"/>',camera:'<path d="M3 8h4l2-3h6l2 3h4v12H3z"/><circle cx="12" cy="14" r="3"/>',tasks:'<rect x="4" y="3" width="16" height="18" rx="2"/><path d="M8 8h8M8 12h8M8 16h5"/>',
copy:'<rect x="8" y="8" width="13" height="13" rx="2"/><path d="M16 8V5a2 2 0 0 0-2-2H5a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h3"/>',savefile:'<path d="M12 3v12m-4-4 4 4 4-4"/><path d="M4 17v4h16v-4"/>',info:'<circle cx="12" cy="12" r="9"/><path d="M12 11v6M12 7h.01"/>',check:'<path d="m20 6-11 11-5-5"/>'};
const icon=k=>`<svg viewBox="0 0 24 24" aria-hidden="true">${paths[k]||paths.info}</svg>`;
const store={ normalPin:null,emergencyPin:null, devices:[{id:'current',title:'Это устройство',subtitle:'Текущая сессия',current:true},{id:'other',title:'Другое устройство',subtitle:'Доверенное устройство',current:false}], saved:{relock:'immediately',inactivity:'off'},draft:{relock:'immediately',inactivity:'off'},route:'security',searchOpen:false,query:'',sheet:null,highlight:null };
let timer;
const initialRecoveryKey='PB2-8KF2-M7Q9-V4R6-T3PJ-H8DN-W5YA-2ZXC';
store.recoveryKey=initialRecoveryKey;
const pinLen=()=>store.normalPin?.length||0;
const dirty=()=>JSON.stringify(store.saved)!==JSON.stringify(store.draft);
function toast(s){const box=$('#toast');box.textContent=s;box.hidden=false;clearTimeout(timer);timer=setTimeout(()=>box.hidden=true,2300)}
function rowIcon(k){return `<span class="security-item-icon">${icon(k)}</span>`}
const relockMinutes = value => value==='immediately'?0:Math.min(5,Math.max(0,Number.parseInt(value,10)||0));
const relockLabel = value => {const n=relockMinutes(value);return n===0?'Сразу':`${n} мин`};
function displayPin(){
 const active=!!store.normalPin;
 const minutes=relockMinutes(store.draft.relock);
 return `<section class="security-section" id="section-pin" tabindex="-1"><h2>PIN входа</h2>
 <div class="security-panel"><div class="security-item" id="setting-pin">${rowIcon('lock')}<div class="security-copy"><strong>PIN входа</strong><small>Код из 4–8 цифр для разблокировки приложения.</small><span class="status ${active?'active':''}">${active?'Включён · '+pinLen()+' '+(pinLen()===4?'цифры':'цифр'):'Не установлен'}</span>${active?'<div class="row-actions"><button class="small-button" data-action="normal-change" type="button">Изменить</button><button class="small-button" data-action="normal-remove" type="button">Отключить</button></div>':''}</div>${active?'':`<button type="button" class="small-button emphasis" data-action="normal-create">Создать</button>`}</div>
 <div class="pin-relock" id="setting-relock"><div class="pin-relock-top"><strong>Через какое время запрашивать PIN</strong><output id="relock-output" for="relock-slider">${relockLabel(store.draft.relock)}</output></div>${!active?'<p class="pin-relock-note">Настройка станет доступна после создания PIN входа.</p>':''}
 <input id="relock-slider" class="pin-slider" type="range" min="0" max="5" step="1" value="${minutes}" ${active?'':'disabled'} aria-label="Через какое время запрашивать PIN" aria-valuetext="${relockLabel(store.draft.relock)}">
 <div class="pin-slider-labels"><span>Сразу</span><span>5 мин</span></div></div></div></section>`;
}
function displayEmergency(){
 const active=!!store.normalPin;
 return `<section class="security-section" id="section-emergency" tabindex="-1"><h2>PIN экстренного удаления данных</h2><div class="security-panel"><div class="security-item" id="setting-emergency">${rowIcon('alert')}<div class="security-copy"><strong>PIN экстренного удаления данных</strong><span class="status ${store.emergencyPin?'active':''}">${store.emergencyPin?'Включён · '+pinLen()+' '+(pinLen()===4?'цифры':'цифр'):active?'Не установлен':'Сначала создайте PIN входа'}</span>${store.emergencyPin?'<div class="row-actions"><button type="button" data-action="emergency-change" class="small-button">Изменить</button><button type="button" data-action="emergency-remove" class="small-button">Отключить</button></div>':''}</div>${!store.emergencyPin?`<button type="button" class="small-button ${active?'emphasis':''}" data-action="emergency-create" ${active?'':'disabled'}>Создать</button>`:''}</div>
 <div class="emergency-detail"><p class="emergency-alert">При вводе данного PIN кода, вместо обычного, доступ немедленно блокируется, данные устройства удаляются, включая всех данных из облака (при наличии связи).</p>
 <p class="emergency-note">Оба PIN должны иметь одинаковую длину. Если вы измените длину обычного PIN, вам придётся создать PIN экстренного удаления данных заново.</p></div></div></section>`;
}
function displayDevices(){return `<section class="security-section" id="section-devices" tabindex="-1"><h2>Устройства и ключ</h2><div class="security-panel security-devices" id="setting-devices">${store.devices.map(d=>`<div class="security-item" data-device-id="${esc(d.id)}">${rowIcon('devices')}<div class="security-copy"><strong>${esc(d.title)}</strong><div class="device-meta">${esc(d.subtitle)}</div></div>${d.current?'<span class="mini-state good"><span class="dot"></span>Сейчас</span>':`<button type="button" data-action="device-revoke" data-id="${esc(d.id)}" class="small-button">Отключить</button>`}</div>`).join('')}</div><p class="privacy-footer">Отключение устройства закрывает его будущие сеансы. Устройство без сети нельзя принудительно очистить мгновенно.</p><div class="security-panel" style="margin-top:13px" id="setting-key"><div class="security-item">${rowIcon('key')}<div class="security-copy"><strong>Recovery Key</strong><small>Ключ входа в аккаунт и восстановления доступа.</small><div class="row-actions"><button type="button" data-action="key-check" class="small-button">Показать / Скачать ключ</button><button type="button" data-action="key-reset" class="small-button">Сменить ключ</button></div></div></div></div><p class="privacy-footer">Восстановление данных и управление резервной копией находится в разделе <a href="#storage" data-action="navigate-storage" class="security-inline-link">«Данные и хранилище»</a>.</p></section>`}
function displayDeletion(){
 const options=[['off','Выключено'],['4','Через 4 месяца'],['6','Через 6 месяцев'],['12','Через 12 месяцев'],['24','Через 24 месяца']];
 return `<section class="security-section" id="section-inactivity" tabindex="-1"><div class="security-panel inactivity-card" id="setting-inactivity"><div class="inactivity-card-heading"><h2>Dead Man’s Switch</h2><p>Автоматическое удаление аккаунта при длительной неактивности.</p></div><div class="inactivity-select-wrap"><label for="inactivity-select">Срок неактивности</label><select id="inactivity-select" aria-label="Срок неактивности">${options.map(([v,label])=>`<option value="${v}" ${store.draft.inactivity===v?'selected':''}>${label}</option>`).join('')}</select></div><p class="inactivity-card-footer">Удаление аккаунта необратимо. Эта настройка не продлевает сроки хранения файлов.</p></div></section>`;
}
function renderStorage(){return `<div class="security-page"><div class="security-heading"><h1>Данные и хранилище</h1><p>Хранение файлов и восстановление данных.</p></div><section class="security-section"><div class="security-panel"><div class="security-item">${rowIcon('folder')}<div class="security-copy"><strong>Резервные копии</strong><small>Создание, проверка и восстановление резервных копий.</small></div></div><div class="security-item">${rowIcon('key')}<div class="security-copy"><strong>Recovery Vault</strong><small>Управление восстановлением данных.</small></div></div></div></section></div>`}
function renderSecurity(){return `<div class="security-page"><div class="security-heading"><h1>Безопасность и конфиденциальность</h1><p>Доступ к приложению, устройства, ключи и жизненный цикл аккаунта.</p></div><div class="security-tiles">${displayPin()}${displayEmergency()}${displayDevices()}${displayDeletion()}</div></div>`}
function renderSettings(){const items=[['user','Профиль и люди','Настройки профиля, контакты и команды','profile'],['shield','Безопасность и конфиденциальность','PIN, устройства, ключи и удаление аккаунта','security'],['notifications','Уведомления','Внутренние события и системные push','notifications'],['info','Оформление','Тема, цвет, размер текста, язык','appearance'],['key','Платежи и тарифы','Текущий план, продление, история','payments']];return `<div class="page-wrap security-menu"><h1>Настройки</h1><div class="menu-group"><div class="menu-title">Разделы</div>${items.map(([i,title,sub,route])=>`<button type="button" data-action="navigate" data-route="${route}" class="menu-row">${icon(i)}<span class="copy"><strong>${title}</strong><small>${sub}</small></span>${icon('chevron')}</button>`).join('')}</div></div>`}
const searchItems=[
 {id:'pin',title:'PIN входа',sub:'Безопасность',terms:'pin app lock unlock код разблокировка пароль пин входа'},
 {id:'emergency',title:'PIN экстренного удаления данных',sub:'Безопасность',terms:'panic emergency экстренное удаление аварийный пин данные'},
 {id:'relock',title:'Время повторного запроса PIN',sub:'Безопасность',terms:'relock lock timeout повторная блокировка через сколько мин ползунок после выхода время'},
 {id:'devices',title:'Устройства',sub:'Безопасность',terms:'devices trust device отключить устройство доверенные девайсы'},
 {id:'key',title:'Recovery Key',sub:'Безопасность',terms:'recovery key reset backup восстановление ключ сменить'},
 {id:'inactivity',title:'Dead Man’s Switch / Автоудаление аккаунта',sub:'Безопасность',terms:'auto delete inactivity inactive account dead man switch удаление бездействие неактивность'},
 {id:'appearance',title:'Язык',sub:'Оформление',terms:'language язык локализация русский english'},
 {id:'notifications',title:'Уведомления',sub:'Уведомления',terms:'notification push уведомления'}
];
function renderSearchPage(){const q=store.query.trim().toLowerCase();const results=q?searchItems.filter(x=>(x.title+' '+x.sub+' '+x.terms).toLowerCase().includes(q)):searchItems.slice(0,6);return `<div class="page-wrap"><div class="section-heading"><div><h1>Поиск настроек</h1><p>${q?'Найдено: '+results.length:'Найдите нужную настройку по названию'}</p></div></div><div class="security-panel">${results.length?results.map(x=>`<button type="button" class="search-row" data-action="search-result" data-target="${esc(x.id)}">${icon('search')}<span class="copy"><strong>${esc(x.title)}</strong><small>${esc(x.sub)}</small></span>${icon('chevron')}</button>`).join(''):'<div class="search-empty">Ничего не найдено</div>'}</div></div>`}
function renderDock(){const items=[['tasks','Задания'],['folder','Browser'],['camera','Камера'],['users','Контакты'],['user','Настройки']];$('#dock').innerHTML=items.map(([k,label],i)=>`<button type="button" data-action="dock" data-item="${k}" class="${i===4?'active':''}">${icon(k)}<small>${label}</small></button>`).join('')}
function render(preserveScroll=true){const m=$('#main');const y=m.scrollTop;$('#content').innerHTML=store.searchOpen?renderSearchPage():store.route==='security'?renderSecurity():store.route==='storage'?renderStorage():renderSettings();m.scrollTop=preserveScroll?y:0;$('#appearance-actions').classList.toggle('visible',store.route==='security'&&!store.searchOpen);$('#save-settings').disabled=!dirty();$('#header-search').innerHTML=icon('search');$('#header-bell').innerHTML=icon('notifications');$('#search-icon').innerHTML=icon('search');$('#clear-search').innerHTML=icon('close');$('#clear-search').hidden=!store.query;renderDock();if(store.highlight){const field=store.highlight;store.highlight=null;requestAnimationFrame(()=>focusSetting(field));}}
function focusSetting(field){const el=$('#setting-'+field)||$('#section-'+field);if(!el)return;const scroller=$('#main');const top=el.getBoundingClientRect().top-scroller.getBoundingClientRect().top+scroller.scrollTop-14;scroller.scrollTop=Math.max(0,top);el.classList.add('sec-focus');el.setAttribute('tabindex','-1');el.focus({preventScroll:true});setTimeout(()=>el.classList.remove('sec-focus'),1700)}
function changeRoute(next){if(next!=='security'&&next!=='settings'&&next!=='storage'){openInfo('В другом разделе','Этот экран уже согласован отдельно. Здесь проверяем настройки безопасности.');return}store.route=next;store.searchOpen=false;$('#search-tray').hidden=true;history.pushState({route:next},'',`#${next}`);render(false)}
function searchShow(on){store.searchOpen=on;store.query='';$('#search-tray').hidden=!on;$('#settings-query').value='';$('#header-search').setAttribute('aria-expanded',String(on));render();if(on)$('#settings-query').focus()}
function selectSearch(field){if(['appearance','notifications'].includes(field)){openInfo('Раздел настроек','Для этого пункта уже есть отдельная интерактивная страница.');return}searchShow(false);store.route='security';store.highlight=field;history.pushState({route:'security'},'','#security');render()}
function sheet(title,body,handlers={}){store.sheet={handlers};$('#sheet-title').textContent=title;$('#sheet-content').innerHTML=body;$('#sheet-close').innerHTML=icon('close');$('#overlay').hidden=false;document.body.classList.add('dialog-open')}
function closeSheet(){store.sheet=null;$('#overlay').hidden=true;$('#sheet-content').innerHTML='';document.body.classList.remove('dialog-open')}
function openInfo(title,message){sheet(title,`<div class="sheet-body"><p>${esc(message)}</p><div class="pin-buttons"><button class="action-button save" data-action="close-sheet" type="button">Закрыть</button></div></div>`)}
function pinInput(label,placeholder='4–8 цифр',length=8){return `<div class="pin-fields"><label for="pin-entry">${esc(label)}</label><input id="pin-entry" aria-label="${esc(label)}" type="password" inputmode="numeric" autocomplete="off" pattern="[0-9]*" maxlength="${length}" placeholder="${esc(placeholder)}"><div class="pin-error" id="pin-error" role="alert"></div></div>`}
function pinActions(nextLabel='Продолжить',danger=false){return `<div class="pin-buttons"><button type="button" data-action="close-sheet" class="action-button">Отмена</button><button type="button" data-action="pin-next" class="action-button ${danger?'negative':'save'}">${nextLabel}</button></div>`}
function showPinStage(){const w=store.sheet?.wizard;if(!w)return;const isEmergency=w.kind==='emergency';const pinLength=w.kind==='normal'?'4–8':String(pinLen());let title='',text='',input='',button='Продолжить',showEntry=true;
if(w.stage==='auth'){title='Подтверждение PIN входа';text='Введите действующий PIN входа для изменения настроек безопасности.';input=pinInput('PIN входа',`${pinLen()} цифр`,pinLen());}
if(w.stage==='new'){title=isEmergency?'Новый экстренный PIN':'Новый PIN входа';text=isEmergency?`Введите ${pinLen()} цифр. Экстренный PIN не должен совпадать с PIN входа.`:`Создайте код длиной 4–8 цифр.`;input=pinInput('Новый PIN',`${pinLength} цифр`,isEmergency?pinLen():8);}
if(w.stage==='confirm'){title='Подтверждение PIN';text=(w.kind==='normal'&&store.emergencyPin&&w.pending.length!==store.emergencyPin.length)?'Повторите новый PIN. Из-за изменения длины действующий экстренный PIN будет отключён; его необходимо создать заново.':'Повторите новый PIN, чтобы исключить ошибку.';input=pinInput('Повторите PIN',`${isEmergency?pinLen():'4–8'} цифр`,isEmergency?pinLen():8);button='Сохранить PIN';}
if(w.stage==='remove'){title=isEmergency?'Отключить экстренный PIN?':'Отключить PIN входа?';text=isEmergency?'Экстренное удаление по PIN станет недоступно.':'Вместе с PIN входа будет отключён экстренный PIN. Действие потребует подтверждения.';input=`<label class="sheet-confirm"><input id="pin-ack" type="checkbox"> <span>Подтверждаю изменение настроек доступа.</span></label>`;button='Отключить';showEntry=false;}
$('#sheet-title').textContent=title;$('#sheet-close').innerHTML=icon('close');$('#sheet-content').innerHTML=`<div class="sheet-body"><p>${text}</p>${input}${pinActions(button,w.stage==='remove')}</div>`;if(showEntry)$('#pin-entry')?.focus()}
function startPin(kind,mode){if(kind==='emergency'&&!store.normalPin)return;const wizard={kind,mode,stage:mode==='create'?(kind==='emergency'?'auth':'new'):'auth',pending:''};store.sheet={wizard};$('#overlay').hidden=false;document.body.classList.add('dialog-open');showPinStage()}
function setPinError(message){const p=$('#pin-error');if(p)p.textContent=message;else toast(message)}
function pinNext(){const w=store.sheet?.wizard;if(!w)return;
if(w.stage==='remove'){if(!$('#pin-ack')?.checked){toast('Подтвердите действие');return}if(w.kind==='normal'){store.normalPin=null;store.emergencyPin=null}else store.emergencyPin=null;closeSheet();render();toast('Настройки PIN изменены');return}
const field=$('#pin-entry');const val=field?.value||'';if(!/^\d{4,8}$/.test(val)){setPinError('Введите только цифры: от 4 до 8.');return}
if(w.stage==='auth'){if(val!==store.normalPin){setPinError('Неверный PIN входа.');return}w.stage=w.mode==='remove'?'remove':'new';showPinStage();return}
if(w.kind==='emergency'&&val.length!==pinLen()){setPinError(`Экстренный PIN должен содержать ровно ${pinLen()} цифр.`);return}
if(w.stage==='new'){
 if(w.kind==='emergency'&&val===store.normalPin){setPinError('Экстренный PIN не должен совпадать с PIN входа.');return}
 if(w.kind==='normal'&&store.emergencyPin){
   if(val.length===store.emergencyPin.length&&val===store.emergencyPin){setPinError('Новый PIN входа не должен совпадать с экстренным.');return}
 }
 w.pending=val;w.stage='confirm';showPinStage();return;
}
if(w.stage==='confirm'){
 if(val!==w.pending){setPinError('PIN не совпадают. Повторите ввод.');return}
 const emergencyReset=w.kind==='normal'&&!!store.emergencyPin&&w.pending.length!==store.emergencyPin.length;
 if(w.kind==='normal'){store.normalPin=w.pending;if(emergencyReset)store.emergencyPin=null;}else store.emergencyPin=w.pending;
 w.pending='';closeSheet();render();toast(emergencyReset?'PIN входа изменён. Создайте экстренный PIN заново.':w.kind==='normal'?'PIN входа установлен':'Экстренный PIN установлен');return;
}}
function showRecoveryKey(newlyCreated=false){
 sheet(newlyCreated?'Новый Recovery Key':'Recovery Key',`<div class="sheet-body"><textarea id="recovery-key-value" class="recovery-key-display" aria-label="Recovery Key" rows="4" readonly spellcheck="false" autocapitalize="off" autocomplete="off">${esc(store.recoveryKey)}</textarea><p class="recovery-key-warning">Храните его отдельно от устройства и не передавайте третьим лицам!</p><div class="recovery-key-actions"><button type="button" class="action-button" data-action="key-download">${icon('savefile')}<span>Сохранить на устройство</span></button><button type="button" class="action-button save" data-action="key-copy">${icon('copy')}<span>Скопировать</span></button></div></div>`)
}
async function copyRecoveryKey(){
 const value=store.recoveryKey;
 let copied=false;
 if(navigator.clipboard&&window.isSecureContext){try{await navigator.clipboard.writeText(value);copied=true}catch{}}
 if(!copied){
   const text=$('#recovery-key-value');
   try{
     if(text){text.focus({preventScroll:true});text.select();text.setSelectionRange(0,text.value.length)}
     copied=!!document.execCommand('copy');
   }catch{}
 }
 if(!copied){
   const text=$('#recovery-key-value');
   if(text){text.focus({preventScroll:true});text.select();}
   toast('Не удалось скопировать автоматически. Выделите и скопируйте ключ.');
 }else toast('Ключ скопирован');
}
async function downloadRecoveryKey(){
 const filename='PhotoBunker-Recovery-Key.txt';
 const content=`PhotoBunker Recovery Key\n\n${store.recoveryKey}\n\nХраните его отдельно от устройства и не передавайте третьим лицам!\n`;
 const blob=new Blob([content],{type:'text/plain;charset=utf-8'});
 try{
   // На мобильных устройствах системная панель «Поделиться» позволяет выбрать «Сохранить в Файлы».
   if(/Android|iPhone|iPad|iPod/i.test(navigator.userAgent)&&navigator.share){
     const f=new File([blob],filename,{type:blob.type});
     if(!navigator.canShare||navigator.canShare({files:[f]})){
       await navigator.share({files:[f],title:'Recovery Key'});
       return;
     }
   }
   // На десктопе открываем штатное окно выбора места и имени файла.
   if(typeof window.showSaveFilePicker==='function'){
     const handle=await window.showSaveFilePicker({suggestedName:filename,types:[{description:'Текстовый файл',accept:{'text/plain':['.txt']}}]});
     const writable=await handle.createWritable();
     try{await writable.write(blob);await writable.close()}catch(e){try{await writable.abort()}catch{}throw e}
     toast('Ключ сохранён');
     return;
   }
   // Fallback: Web Share для браузеров без File System Access API.
   if(navigator.share){
     const f=new File([blob],filename,{type:blob.type});
     if(!navigator.canShare||navigator.canShare({files:[f]})){
       await navigator.share({files:[f],title:'Recovery Key'});
       return;
     }
   }
   toast('Выбор места недоступен в этом браузере. Скопируйте ключ вручную.');
 }catch(error){
   if(error?.name==='AbortError')return;
   toast('Не удалось открыть сохранение. Попробуйте «Скопировать».');
 }
}
function showRecoveryReset(){
 const pinRequired=!!store.normalPin;
 sheet('Сменить Recovery Key',`<div class="sheet-body"><p class="recovery-reset-warning">Все сессии на других устройствах будут закрыты, а данные по возможности удалены. ${pinRequired?'Для смены ключа необходимо ввести PIN входа.':''}</p>${pinRequired?`<div class="pin-fields"><label for="key-pin-entry">PIN входа</label><input id="key-pin-entry" aria-label="PIN входа для смены Recovery Key" type="password" inputmode="numeric" autocomplete="off" maxlength="${pinLen()}" placeholder="${pinLen()} цифр"></div>`:''}<label class="sheet-confirm recovery-ack"><input id="key-reset-ack" type="checkbox"><span>Да, я прочитал и хочу поменять ключ</span></label><div id="key-reset-error" class="pin-error" role="alert"></div><div class="pin-buttons"><button type="button" data-action="close-sheet" class="action-button">Отмена</button><button type="button" data-action="key-confirm-reset" class="action-button negative">Сменить Recovery Key</button></div></div>`);
 $('#key-pin-entry')?.focus();
}
function generateRecoveryKey(){
 const alphabet='ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
 const bytes=new Uint8Array(32);
 if(window.crypto?.getRandomValues){window.crypto.getRandomValues(bytes)}else{for(let i=0;i<bytes.length;i++)bytes[i]=Math.floor(Math.random()*256)}
 const groups=[];for(let i=0;i<8;i++){let part='';for(let j=0;j<4;j++)part+=alphabet[bytes[i*4+j]%alphabet.length];groups.push(part)}
 return 'PB2-'+groups.join('-');
}
function rotateRecoveryKey(){
 const alert=$('#key-reset-error');if(!$('#key-reset-ack')?.checked){if(alert)alert.textContent='Подтвердите смену ключа.';return}
 if(store.normalPin && ($('#key-pin-entry')?.value||'')!==store.normalPin){if(alert)alert.textContent='Неверный PIN входа.';return}
 store.recoveryKey=generateRecoveryKey();store.devices=store.devices.filter(x=>x.current);render();showRecoveryKey(true);
}

function revokeDevice(id){const d=store.devices.find(x=>x.id===id);if(!d||d.current)return;sheet('Отключить устройство',`<div class="sheet-body"><p>Вы уверены что хотите отключить данное устройство? Все данные с того устройства будут удалены при первом входе в приложение и наличия сети.</p><div class="pin-buttons"><button type="button" data-action="close-sheet" class="action-button">Отмена</button><button type="button" data-action="confirm-revoke" data-id="${esc(id)}" class="action-button negative">Отключить</button></div></div>`)}
function handle(action,el){switch(action){
case 'status':openInfo('Состояние','Статус синхронизации и безопасности отображается общим контроллером PhotoBunker.');break;
case 'tariff':openInfo('Тариф','Unlimited (267 дней)');break;
case 'bell':openInfo('Уведомления','Перейдите в раздел «Уведомления» для просмотра событий.');break;
case 'search':searchShow(!store.searchOpen);break;
case 'close-search':searchShow(false);break;
case 'clear-search':store.query='';$('#settings-query').value='';render();break;
case 'navigate':changeRoute(el.dataset.route);break;
case 'back':changeRoute('settings');break;
case 'search-result':selectSearch(el.dataset.target);break;
case 'normal-create':startPin('normal','create');break;
case 'normal-change':startPin('normal','change');break;
case 'normal-remove':startPin('normal','remove');break;
case 'emergency-create':startPin('emergency','create');break;
case 'emergency-change':startPin('emergency','change');break;
case 'emergency-remove':startPin('emergency','remove');break;
case 'pin-next':pinNext();break;
case 'close-sheet':closeSheet();break;
case 'navigate-storage':changeRoute('storage');break;
case 'cancel':store.draft={...store.saved};render();toast('Изменения отменены');break;
case 'save':if(!dirty())break;store.saved={...store.draft};render();toast('Настройки сохранены');break;
case 'device-revoke':revokeDevice(el.dataset.id);break;
case 'confirm-revoke':store.devices=store.devices.filter(x=>x.id!==el.dataset.id);closeSheet();render();toast('Устройство отключено');break;
case 'key-check':showRecoveryKey();break;
case 'key-reset':showRecoveryReset();break;
case 'key-copy':copyRecoveryKey();break;
case 'key-download':downloadRecoveryKey();break;
case 'key-confirm-reset':rotateRecoveryKey();break;
case 'dock':if(el.dataset.item==='user'){changeRoute('settings')}else{openInfo('Раздел PhotoBunker','Этот раздел находится в главном меню PhotoBunker.')}break;
}}
$('#app').addEventListener('click',e=>{const el=e.target.closest('[data-action]');if(!el)return;if(el.tagName==='A')e.preventDefault();handle(el.dataset.action,el)});
$('#app').addEventListener('change',e=>{if(e.target.id==='inactivity-select'){store.draft.inactivity=e.target.value;$('#save-settings').disabled=!dirty();}});
$('#app').addEventListener('input',e=>{if(e.target.id!=='relock-slider')return;const v=Number(e.target.value);if(!Number.isFinite(v))return;store.draft.relock=v===0?'immediately':`${v}m`;const output=$('#relock-output');if(output)output.textContent=relockLabel(store.draft.relock);e.target.setAttribute('aria-valuetext',relockLabel(store.draft.relock));$('#save-settings').disabled=!dirty();});
$('#settings-query').addEventListener('input',e=>{store.query=e.target.value;render()});
$('#settings-query').addEventListener('keydown',e=>{if(e.key==='Enter'){const q=store.query.toLowerCase();const f=searchItems.find(x=>(x.title+' '+x.sub+' '+x.terms).toLowerCase().includes(q));if(f)selectSearch(f.id)}});
$('#overlay').addEventListener('click',e=>{if(e.target.id==='overlay')closeSheet()});
document.addEventListener('keydown',e=>{if(e.key==='Escape'){if(!$('#overlay').hidden)closeSheet();else if(store.searchOpen)searchShow(false)}if(e.key==='Enter'&&$('#pin-entry')===document.activeElement&&store.sheet?.wizard)pinNext()});
window.addEventListener('popstate',e=>{store.route=['settings','security','storage'].includes(e.state?.route)?e.state.route:'security';store.searchOpen=false;$('#search-tray').hidden=true;render(false)});
document.querySelectorAll('[data-device]').forEach(btn=>btn.addEventListener('click',()=>{document.querySelectorAll('[data-device]').forEach(b=>{b.classList.toggle('selected',b===btn);b.setAttribute('aria-pressed',String(b===btn))});$('#device').className='device '+btn.dataset.device}));
const fragment=decodeURIComponent(location.hash.slice(1));store.route=['settings','security','storage'].includes(fragment)?fragment:'security';history.replaceState({route:store.route},'',`#${store.route}`);render();
})();
