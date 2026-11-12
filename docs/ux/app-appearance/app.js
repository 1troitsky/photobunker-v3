
(()=>{'use strict';
const $=q=>document.querySelector(q);
const icons={back:'<path d="m15 18-6-6 6-6"/>',search:'<circle cx="11" cy="11" r="7"/><path d="m20 20-4-4"/>',close:'<path d="M18 6 6 18M6 6l12 12"/>',chevron:'<path d="m9 18 6-6-6-6"/>',check:'<path d="m20 6-11 11-5-5"/>',tasks:'<rect x="4" y="3" width="16" height="18" rx="2"/><path d="M8 8h8M8 12h8M8 16h5"/>',globe:'<circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3c-4 4-4 14 0 18M12 3c4 4 4 14 0 18"/>',folder:'<path d="M3 6h7l2 3h9v11H3z"/>',camera:'<path d="M3 8h4l2-3h6l2 3h4v12H3z"/><circle cx="12" cy="14" r="3"/>',users:'<circle cx="9" cy="8" r="3"/><path d="M3 20v-2a6 6 0 0 1 12 0v2M18 8a3 3 0 0 1 0 6M21 20v-2a5 5 0 0 0-4-4"/>',user:'<circle cx="12" cy="7" r="4"/><path d="M4 21v-2a8 8 0 0 1 16 0v2"/>',palette:'<circle cx="12" cy="12" r="9"/><circle cx="7" cy="11" r=".7"/><circle cx="11" cy="7" r=".7"/><circle cx="16" cy="8" r=".7"/><path d="M14 18a2.5 2.5 0 0 1 2-4h2"/>',bell:'<path d="M18 8a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9M10 21h4"/>',shield:'<path d="M12 2 20 6v6c0 5-3.5 8-8 10-4.5-2-8-5-8-10V6z"/>',database:'<ellipse cx="12" cy="5" rx="8" ry="3"/><path d="M4 5v14c0 4 16 4 16 0V5M4 12c0 4 16 4 16 0"/>',credit:'<rect x="2" y="5" width="20" height="14" rx="2"/><path d="M2 10h20"/>',message:'<path d="M21 11.5a8.5 8.5 0 0 1-8.5 8.5H4l1.4-4.1A8.5 8.5 0 1 1 21 11.5Z"/>',up:'<path d="m6 14 6-6 6 6"/>',down:'<path d="m6 10 6 6 6-6"/>',plus:'<path d="M12 5v14M5 12h14"/>',minus:'<path d="M5 12h14"/>',grip:'<circle cx="9" cy="5" r=".7"/><circle cx="15" cy="5" r=".7"/><circle cx="9" cy="12" r=".7"/><circle cx="15" cy="12" r=".7"/><circle cx="9" cy="19" r=".7"/><circle cx="15" cy="19" r=".7"/>',help:'<circle cx="12" cy="12" r="9"/><path d="M9.5 9a2.6 2.6 0 1 1 4 2l-1.5 1.5V14M12 17h.01"/>'};
const icon=k=>`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" aria-hidden="true">${icons[k]||icons.help}</svg>`;
const COPY={ru:{back:'Назад',heading:'Оформление',subtitle:'Внешний вид и поведение интерфейса',theme:'Тема',themeDark:'Тёмная',themeLight:'Светлая',themeSystem:'Системная',themeHelp:'Системная тема следует настройкам устройства.',accent:'Основной цвет',accentHelp:'Меняется только цвет акцентов, а не фон приложения.',green:'Зелёный',graphite:'Серый',amber:'Янтарный',coral:'Коралловый',size:'Размер текста',small:'Мелкий',normal:'Обычный',large:'Крупный',example:'Съёмка, задания и файлы всегда под контролем.',launch:'Стартовая страница',launchHelp:'Откроется после запуска приложения.',camera:'Камера',cameraSub:'Сразу начать съёмку',tasks:'Задания',tasksSub:'Список моих заданий',browser:'Browser',browserSub:'Мои файлы и папки',language:'Язык',russian:'Русский',english:'English',languageHelp:'Выбор языка не изменяет язык содержимого заданий.',preview:'Предпросмотр',previewSub:'Пример карточки задания с выбранным оформлением.',demoTasks:'Мои задания',active:'Активно',demoTask:'Городская съёмка',demoTaskSub:'12 из 30 файлов',open:'Открыть',cancel:'Отмена',save:'Сохранить',saved:'Настройки сохранены (демо)',unsaved:'Есть несохранённые изменения',allSaved:'Все изменения сохранены',settings:'Настройки',profile:'Профиль и люди',profileSettings:'Настройки профиля',contacts:'Контакты и Команды',application:'Приложение',appearance:'Оформление',notifications:'Уведомления',security:'Защита и приватность',storage:'Данные и хранилище',billing:'Платежи и тарифы',help:'Помощь и информация',search:'Поиск по настройкам',noSearch:'Ничего не найдено',status:'В работе',tariff:'Тариф: Unlimited (267 дней)',unavailable:'Этот раздел разработаем отдельным этапом.',close:'Закрыть',leaveTitle:'Несохранённые изменения',leaveText:'Изменения оформления не сохранены. Выйти без сохранения?',leave:'Не сохранять',stay:'Продолжить',demo:'Это демонстрационная кнопка. Реальный текущий тариф будет подключён позднее.',reset:'Вернуть значения по умолчанию',deviceInfo:'Профиль · настройки',done:'Сохранено',dockHeading:'Нижняя панель · Dock',dockDesc:'Выберите разделы и настройте их порядок.',dockSelected:'В панели',dockAvailable:'Добавить раздел',dockMinMax:'От 3 до 6 пунктов, рекомендуем 4–5.',dockReorder:'Тяните за точки или используйте стрелки. Нижняя панель обновляется сразу.',dockReset:'Восстановить Dock',dockMin:'Минимум 3 раздела',dockMax:'Максимум 6 разделов',dockEmpty:'Все доступные разделы уже добавлены.',dockMoveUp:'Выше',dockMoveDown:'Ниже',dockRemove:'Убрать из Dock',dockAdd:'Добавить в Dock',dockDemoOpen:'Открыть вложенный экран',dockDemoSub:'Демонстрация поведения: нажмите активную кнопку Dock повторно, чтобы вернуться.',dockDemoRoot:'Вы на главной странице этого раздела.',dockDefaults:'Стандартная панель восстановлена',messages:'Сообщения',dockSettings:'Настройка Dock'},en:{back:'Back',heading:'Appearance',subtitle:'Look and behavior of the interface',theme:'Theme',themeDark:'Dark',themeLight:'Light',themeSystem:'System',themeHelp:'System theme follows your device setting.',accent:'Accent color',accentHelp:'Only accent colors change, not the app background.',green:'Green',graphite:'Gray',amber:'Amber',coral:'Coral',size:'Text size',small:'Small',normal:'Normal',large:'Large',example:'Your captures, assignments and files stay organized.',launch:'Launch page',launchHelp:'Opens when the app starts.',camera:'Camera',cameraSub:'Start capturing right away',tasks:'Assignments',tasksSub:'Your assignment list',browser:'Browser',browserSub:'Your files and folders',language:'Language',russian:'Русский',english:'English',languageHelp:'This does not translate your assignments’ content.',preview:'Preview',previewSub:'Sample assignment with your selected appearance.',demoTasks:'My assignments',active:'Active',demoTask:'City photo shoot',demoTaskSub:'12 of 30 files',open:'Open',cancel:'Cancel',save:'Save',saved:'Settings saved (demo)',unsaved:'Unsaved changes',allSaved:'All changes saved',settings:'Settings',profile:'Profile & people',profileSettings:'Profile settings',contacts:'Contacts & Teams',application:'Application',appearance:'Appearance',notifications:'Notifications',security:'Security & privacy',storage:'Data & storage',billing:'Payments & plans',help:'Help & information',search:'Search settings',noSearch:'No results found',status:'Working',tariff:'Plan: Unlimited (267 days)',unavailable:'This section is planned for another stage.',close:'Close',leaveTitle:'Unsaved changes',leaveText:'Discard changes to appearance?',leave:'Discard',stay:'Keep editing',demo:'Demo plan button. Real subscription status will be connected later.',reset:'Reset to defaults',deviceInfo:'Profile · settings',done:'Saved',dockHeading:'Bottom bar · Dock',dockDesc:'Choose shortcuts and arrange their order.',dockSelected:'In the Dock',dockAvailable:'Add section',dockMinMax:'3 to 6 items, 4–5 recommended.',dockReorder:'Drag using the grip or use the arrows. The bottom bar updates immediately.',dockReset:'Restore default Dock',dockMin:'At least 3 sections',dockMax:'At most 6 sections',dockEmpty:'All sections are already included.',dockMoveUp:'Move up',dockMoveDown:'Move down',dockRemove:'Remove from Dock',dockAdd:'Add to Dock',dockDemoOpen:'Open a nested screen',dockDemoSub:'Try tapping the active Dock item again to return to the parent screen.',dockDemoRoot:'You are at the root of this section.',dockDefaults:'Default Dock restored',messages:'Messages',dockSettings:'Dock settings'}};
const t=k=>COPY[state.draft.language][k]||k;
const acc={green:'#1ed760',graphite:'#a6a6a6',amber:'#e7b34f',coral:'#ff8676'};
const defaultDock=['tasks','browser','camera','contacts','profile'];
const defaults={theme:'dark',accent:'green',size:'normal',launch:'tasks',language:'ru',dock:[...defaultDock]};
const clonePrefs=obj=>({...obj,dock:[...obj.dock]});
const DOCK_ITEMS=[['tasks','tasks',{ru:'Задания',en:'Assignments'}],['browser','folder',{ru:'Browser',en:'Browser'}],['camera','camera',{ru:'Камера',en:'Camera'}],['notifications','bell',{ru:'Уведомления',en:'Notifications'}],['profile','user',{ru:'Профиль',en:'Profile'}],['contacts','users',{ru:'Контакты',en:'Contacts'}],['messages','message',{ru:'Сообщения',en:'Messages'}]];
const dockInfo=id=>DOCK_ITEMS.find(v=>v[0]===id);
const dockLabel=id=>dockInfo(id)?.[2][state.draft.language]||id;
const state={route:'appearance',saved:clonePrefs(defaults),draft:clonePrefs(defaults),searchOpen:false,query:'',searchTarget:null,sheet:null,pendingBack:false,activeDock:'profile',dockDepth:0};
const scale={small:.91,normal:1,large:1.14};
let toastTimer;
function dirty(){return Object.keys(defaults).some(k=>Array.isArray(defaults[k])?JSON.stringify(state.saved[k])!==JSON.stringify(state.draft[k]):state.saved[k]!==state.draft[k])}
function effectiveScheme(){return state.draft.theme==='system'?(window.matchMedia&&matchMedia('(prefers-color-scheme: light)').matches?'light':'dark'):state.draft.theme}
function applyTheme(){const app=$('#app');const scheme=effectiveScheme();app.dataset.scheme=scheme;let a=acc[state.draft.accent];app.style.setProperty('--ui-accent',a);app.style.setProperty('--ui-accent-ink','#151a13');app.style.setProperty('--text-scale',String(scale[state.draft.size]));app.style.setProperty('--green',a);document.documentElement.style.setProperty('--accent',a);$('#status-label').textContent=t('status');$('.plan-pill').textContent=t('tariff');$('#settings-query').placeholder=t('search');$('#settings-query').setAttribute('aria-label',t('search'));$('#header-search').setAttribute('aria-label',t('search'));$('.close-search').textContent=t('cancel');renderDock()}
function toast(s){const x=$('#toast');x.textContent=s;x.hidden=false;clearTimeout(toastTimer);toastTimer=setTimeout(()=>{x.hidden=true},1900)}
function picked(active){return active?`<span class="picked">${icon('check')}</span>`:''}
function optRow(key,value,title,desc,ico){let yes=state.draft[key]===value;return `<button type="button" class="option-row" data-action="choose" data-key="${key}" data-value="${value}" aria-pressed="${yes}"><span class="option-icon">${icon(ico)}</span><span class="option-copy"><strong>${title}</strong><small>${desc}</small></span><span class="option-mark">${yes?icon('check'):''}</span></button>`}
function themeCard(key,title){const active=state.draft.theme===key;return `<button type="button" class="theme-card" data-action="choose" data-key="theme" data-value="${key}" aria-pressed="${active}"><span class="theme-mini ${key}"><span class="mini-bar"></span><span class="mini-line"></span><span class="mini-line short"></span><span class="mini-hl"></span></span><span class="theme-label"><span>${title}</span>${picked(active)}</span></button>`}

function renderDockSettings(){
 const chosen=state.draft.dock;
 const available=DOCK_ITEMS.filter(([id])=>!chosen.includes(id));
 const selectedRows=chosen.map((id,i)=>{
  const info=dockInfo(id);return `<div class="dock-sort-row" data-dock-row="${id}"><button type="button" class="dock-grip" data-dock-drag="${id}" aria-label="${t('dockReorder')}" title="${t('dockReorder')}">${icon('grip')}</button><span class="dock-item-icon">${icon(info[1])}</span><span class="dock-item-label">${dockLabel(id)}</span><div class="dock-row-actions"><button type="button" data-action="dock-move" data-id="${id}" data-dir="-1" aria-label="${t('dockMoveUp')}: ${dockLabel(id)}" title="${t('dockMoveUp')}" ${i===0?'disabled':''}>${icon('up')}</button><button type="button" data-action="dock-move" data-id="${id}" data-dir="1" aria-label="${t('dockMoveDown')}: ${dockLabel(id)}" title="${t('dockMoveDown')}" ${i===chosen.length-1?'disabled':''}>${icon('down')}</button>${id==='profile'?'<span class="dock-action-placeholder" aria-hidden="true"></span>':`<button type="button" class="remove" data-action="dock-remove" data-id="${id}" aria-label="${t('dockRemove')}: ${dockLabel(id)}" title="${t('dockRemove')}" ${chosen.length<=3?'disabled':''}>${icon('close')}</button>`}</div></div>`;
 }).join('');
 const addButtons=available.map(([id,ico])=>`<button type="button" class="dock-add-button" data-action="dock-add" data-id="${id}" ${chosen.length>=6?'disabled':''} aria-label="${t('dockAdd')}: ${dockLabel(id)}">${icon(ico)}<span>${dockLabel(id)}</span><span class="dock-plus">${icon('plus')}</span></button>`).join('');
 return `<section class="dock-config appearance-section ${state.searchTarget==='dock'?'is-search-target':''}" id="setting-field-dock" tabindex="-1"><div class="dock-config-top"><div><h2>${t('dockHeading')}</h2><p>${t('dockDesc')}</p></div><span class="dock-count">${chosen.length} / 6</span></div><div class="option-panel"><p class="dock-subheading">${t('dockSelected')}</p><div class="dock-sort-list">${selectedRows}</div><div class="dock-add-panel"><p class="dock-subheading">${t('dockAvailable')}</p>${available.length?`<div class="dock-available">${addButtons}</div>`:`<p class="dock-help">${t('dockEmpty')}</p>`}</div><p class="dock-help">${t('dockMinMax')} ${t('dockReorder')}</p><div class="dock-manage-footer"><small>${state.draft.language==='ru'?'Изменения видны в Dock ниже':'Changes preview below'}</small><button type="button" class="tiny-action" data-action="dock-reset">${t('dockReset')}</button></div></div></section>`;
}
function changeDock(id,action,dir=0){
 const a=state.draft.dock;
 if(!dockInfo(id))return;
 if(action==='add'){
  if(a.includes(id)||a.length>=6){if(a.length>=6)toast(t('dockMax'));return;}
  a.push(id);
 }else if(action==='remove'){
  if(id==='profile')return; // Mandatory Profile / Settings entry remains in the Dock.
  if(!a.includes(id)||a.length<=3){if(a.length<=3)toast(t('dockMin'));return;}
  a.splice(a.indexOf(id),1);
 }else if(action==='move'){
  const i=a.indexOf(id),j=i+dir;if(i<0||j<0||j>=a.length)return;
  [a[i],a[j]]=[a[j],a[i]];
 }else return;
 renderMain(true);
}
function moveDockTo(id,before){
 const a=state.draft.dock;
 if(id===before||!a.includes(id)||!a.includes(before))return;
 const old=a.indexOf(id);a.splice(old,1);a.splice(a.indexOf(before),0,id);
 renderMain(true);
}
function renderDockDemo(){const id=state.activeDock;return `<div class="appearance-body"><div class="appearance-title"><button class="back-link" type="button" data-action="dock-demo-back" aria-label="${t('back')}">${icon('back')}</button><div><h1>${dockLabel(id)}</h1><p>${state.dockDepth?t('dockDemoSub'):t('dockDemoRoot')}</p></div></div><div class="dock-demo-card"><h2>${state.dockDepth?`${dockLabel(id)} · 2`:`${dockLabel(id)} · 1`}</h2><p>${t('dockDemoSub')}</p>${state.dockDepth===0?`<button type="button" data-action="dock-demo-deep">${t('dockDemoOpen')}</button>`:`<button type="button" data-action="dock-demo-back">${t('back')}</button>`}</div></div>`}
function tapDock(id){
 if(!state.draft.dock.includes(id))return;
 state.searchOpen=false;$('#search-tray').hidden=true;
 if(id==='profile'){
  if(state.route==='appearance'){back();return;}
  if(state.route==='dock-demo'){
   state.activeDock='profile';state.route='settings';state.dockDepth=0;history.pushState({route:'settings'},'','#settings');renderMain();return;
  }
  state.activeDock='profile';if(state.route==='settings')toast(t('dockDemoRoot'));else{state.route='settings';renderMain()};return;
 }
 if(state.route==='dock-demo'&&state.activeDock===id){
  if(state.dockDepth>0){state.dockDepth--;renderMain();}else toast(t('dockDemoRoot'));
  return;
 }
 state.route='dock-demo';state.activeDock=id;state.dockDepth=0;
 history.pushState({route:'dock-demo',activeDock:id,dockDepth:0},'',`#dock-${id}`);
 renderMain();
}
let draggingDock=null;
function removeDropTarget(){document.querySelectorAll('.dock-drag-over,.dock-is-dragging').forEach(el=>el.classList.remove('dock-drag-over','dock-is-dragging'));}
$('#app').addEventListener('pointerdown',e=>{
 const h=e.target.closest('[data-dock-drag]');if(!h||state.route!=='appearance')return;
 const row=h.closest('[data-dock-row]');if(!row)return;
 e.preventDefault();draggingDock={id:row.dataset.dockRow,pointerId:e.pointerId,over:null};
 row.classList.add('dock-is-dragging');try{h.setPointerCapture(e.pointerId)}catch{}
});
$('#app').addEventListener('pointermove',e=>{
 if(!draggingDock||draggingDock.pointerId!==e.pointerId)return;
 const row=document.elementFromPoint(e.clientX,e.clientY)?.closest('[data-dock-row]');
 removeDropTarget();document.querySelector(`[data-dock-row="${draggingDock.id}"]`)?.classList.add('dock-is-dragging');
 draggingDock.over=row?.dataset.dockRow||null;
 if(draggingDock.over&&draggingDock.over!==draggingDock.id)row.classList.add('dock-drag-over');
});
function finishDockDrag(e,commit){if(!draggingDock||draggingDock.pointerId!==e.pointerId)return;const {id,over}=draggingDock;draggingDock=null;removeDropTarget();if(commit&&over)moveDockTo(id,over);}
$('#app').addEventListener('pointerup',e=>finishDockDrag(e,true));
$('#app').addEventListener('pointercancel',e=>finishDockDrag(e,false));

function renderAppearance(){return `<div class="appearance-body"><div class="appearance-title"><button type="button" class="back-link" data-action="back" aria-label="${t('back')}">${icon('back')}</button><div><h1>${t('heading')}</h1><p>${t('subtitle')}</p></div></div><div class="appearance-layout"><div class="appearance-column"><section id="setting-field-theme" class="appearance-section ${state.searchTarget==='theme'?'is-search-target':''}" tabindex="-1"><h2>${t('theme')}</h2><div class="option-panel"><div class="theme-grid">${themeCard('dark',t('themeDark'))}${themeCard('light',t('themeLight'))}${themeCard('system',t('themeSystem'))}</div><p class="option-help">${t('themeHelp')}</p></div></section><section id="setting-field-accent" class="appearance-section ${state.searchTarget==='accent'?'is-search-target':''}" tabindex="-1"><h2>${t('accent')}</h2><div class="option-panel"><div class="color-grid">${Object.entries(acc).map(([key,color])=>`<button type="button" class="color-button" data-action="choose" data-key="accent" data-value="${key}" aria-label="${t(key)}" aria-pressed="${state.draft.accent===key}"><span class="color-swatch" style="background:${color}">${state.draft.accent===key?icon('check'):''}</span><span>${t(key)}</span></button>`).join('')}</div><p class="option-help">${t('accentHelp')}</p></div></section><section id="setting-field-size" class="appearance-section ${state.searchTarget==='size'?'is-search-target':''}" tabindex="-1"><h2>${t('size')}</h2><div class="option-panel"><div class="segment">${['small','normal','large'].map(key=>`<button type="button" class="seg-button" data-action="choose" data-key="size" data-value="${key}" aria-pressed="${state.draft.size===key}">${t(key)}</button>`).join('')}</div><div class="example-text">${t('example')}</div></div></section></div><div class="appearance-column"><section id="setting-field-launch" class="appearance-section ${state.searchTarget==='launch'?'is-search-target':''}" tabindex="-1"><h2>${t('launch')}</h2><div class="option-list">${optRow('launch','camera',t('camera'),t('cameraSub'),'camera')}${optRow('launch','tasks',t('tasks'),t('tasksSub'),'tasks')}${optRow('launch','browser',t('browser'),t('browserSub'),'folder')}</div><p class="option-help">${t('launchHelp')}</p></section><section id="setting-field-language" class="appearance-section ${state.searchTarget==='language'?'is-search-target':''}" tabindex="-1"><h2>${t('language')}</h2><div class="option-list">${optRow('language','ru',t('russian'),'RU','globe')}${optRow('language','en',t('english'),'EN','globe')}</div><p class="option-help">${t('languageHelp')}</p></section></div></div>${renderDockSettings()}</div>`}
const groupRows=[['profileSettings','profileSettings','user'],['contacts','contacts','users'],['appearance','appearance','palette'],['notifications','notifications','bell'],['security','security','shield'],['storage','storage','database'],['billing','billing','credit'],['help','help','help']];
function renderSettings(){const groups=[[t('profile'),groupRows.slice(0,2)],[t('application'),groupRows.slice(2,4)],[t('security'),groupRows.slice(4,6)],[t('billing'),groupRows.slice(6,7)],[t('help'),groupRows.slice(7,8)]];return `<div class="appearance-body"><div class="settings-head"><h1>${t('settings')}</h1></div><button type="button" class="settings-account" data-action="dummy"><span class="settings-account-avatar">А</span><span><strong>Алекс</strong><small>@frame.84 · #00001284</small></span><span class="row-chevron">${icon('chevron')}</span></button><div class="settings-groups">${groups.map(([heading,rows])=>`<section class="settings-group"><h2>${heading}</h2><div class="option-list">${rows.map(([route,label,ico])=>`<button type="button" class="option-row" data-action="navigate" data-route="${route}"><span class="option-icon">${icon(ico)}</span><span class="option-copy"><strong>${t(label)}</strong></span><span class="option-mark" style="color:var(--muted)">${icon('chevron')}</span></button>`).join('')}</div></section>`).join('')}</div></div>`}
// One bilingual index for the whole Settings hierarchy. Implemented controls have
// direct scroll anchors; future screens are explicitly marked as unavailable.
const searchableSettings=[
 {route:'appearance',field:'theme',key:'theme',icon:'palette',ru:'тема темная светлая системная',en:'theme dark light system appearance'},
 {route:'appearance',field:'accent',key:'accent',icon:'palette',ru:'основной цвет акцент палитра',en:'main color accent colour palette'},
 {route:'appearance',field:'size',key:'size',icon:'palette',ru:'размер текста шрифт масштаб',en:'text size font scaling'},
 {route:'appearance',field:'launch',key:'launch',icon:'camera',ru:'стартовая страница запуск начальный экран камера задания browser',en:'launch page start screen camera assignments browser'},
 {route:'appearance',field:'dock',key:'dockSettings',icon:'users',ru:'док нижняя панель меню навигация порядок пунктов кнопок сообщения',en:'dock bottom bar navigation customize reorder shortcuts messages'},
 {route:'appearance',field:'language',key:'language',icon:'globe',ru:'язык языки русский английский локализация',en:'language languages english russian locale localization'},
 {route:'profileSettings',key:'profileSettings',icon:'user',ru:'настройки профиля имя username онлайн видимость команды',en:'profile settings name online visibility teams username'},
 {route:'contacts',key:'contacts',icon:'users',ru:'контакты и команды blacklist список контактов',en:'contacts teams blacklist blocked'},
 {route:'notifications',key:'notifications',icon:'bell',ru:'уведомления оповещения',en:'notifications alerts'},
 {route:'security',key:'security',icon:'shield',ru:'безопасность приватность app pin emergency pin face id',en:'security privacy app pin emergency pin face id'},
 {route:'storage',key:'storage',icon:'database',ru:'данные хранилище резервная копия кэш',en:'data storage backups cache'},
 {route:'billing',key:'billing',icon:'credit',ru:'платежи тарифы подписка оплата',en:'billing payments tariffs plans subscription'},
 {route:'help',key:'help',icon:'help',ru:'помощь faq о приложении политика',en:'help faq about terms privacy'}
];
function matchSearch(item,q){const hay=[item.ru,item.en,t(item.key)].join(' ').toLocaleLowerCase();return q.split(/\s+/).every(word=>hay.includes(word));}
function renderSearchPage(){
 const q=state.query.trim().toLocaleLowerCase();
 const found=searchableSettings.filter(item=>!q||matchSearch(item,q));
 const options=q?found:found.slice(0,7);
 return `<div class="appearance-body"><div class="settings-head"><h1>${t('search')}</h1></div><div class="search-results">${options.length?options.map(item=>`<button type="button" data-action="search-result" data-route="${item.route}" ${item.field?`data-field="${item.field}"`:''} aria-label="${t(item.key)} — ${item.field?t('appearance'):t('settings')}">${icon(item.icon)}<span class="result-copy"><strong>${t(item.key)}</strong><small>${item.field?`${t('appearance')} → ${t(item.key)}`:`${t('settings')} → ${t(item.key)}`}${!item.field?` · ${state.draft.language==='ru'?'Раздел будет добавлен позже':'Coming later'}`:''}</small></span>${icon('chevron')}</button>`).join(''):`<p class="page-note">${t('noSearch')}</p>`}</div></div>`;
}
// Land on the actual form group, not at the top of Appearance.
function navigateToSetting(field){
 state.searchTarget=field;
 state.searchOpen=false;state.query='';
 $('#search-tray').hidden=true;
 $('#header-search').setAttribute('aria-expanded','false');
 $('#settings-query').value='';
 if(state.route!=='appearance'){
   history.pushState({route:'appearance'},'','#appearance');
   state.route='appearance';
 }
 renderMain();
 const section=document.getElementById(`setting-field-${field}`);
 if(section){
   const scroller=$('#main');
   const position=section.getBoundingClientRect().top-scroller.getBoundingClientRect().top+scroller.scrollTop-12;
   scroller.scrollTop=Math.max(0,position);
   section.focus({preventScroll:true});
 }
}
function renderMain(keepScroll=false){const main=$('#main');const y=main.scrollTop;$('#content').innerHTML=state.searchOpen?renderSearchPage():state.route==='appearance'?renderAppearance():state.route==='dock-demo'?renderDockDemo():renderSettings();main.scrollTop=keepScroll?y:0;applyTheme();renderAppearanceActions()}
function renderAppearanceActions(){const show=state.route==='appearance'&&!state.searchOpen;$('#appearance-actions').hidden=!show;$('#cancel-appearance').textContent=t('cancel');$('#save-appearance').textContent=t('save');$('#save-appearance').disabled=!dirty()}
function renderDock(){const items=state.draft.dock;const dock=$('#dock');dock.style.setProperty('--dock-items',String(items.length));dock.dataset.count=String(items.length);dock.innerHTML=items.map(id=>{const info=dockInfo(id);const active=id==='profile'?['settings','appearance'].includes(state.route):state.route==='dock-demo'&&state.activeDock===id;return `<button type="button" data-action="dock" data-route="${id}" class="${active?'active':''}" aria-current="${active?'page':'false'}">${icon(info[1])}<small>${dockLabel(id)}</small></button>`}).join('')}
function searchToggle(show){state.searchOpen=show;state.query='';$('#search-tray').hidden=!show;$('#header-search').innerHTML=icon('search');$('#header-search').setAttribute('aria-expanded',String(show));$('#search-icon').innerHTML=icon('search');$('#clear-search').innerHTML=icon('close');$('#clear-search').hidden=true;$('#settings-query').value='';renderMain();if(show)$('#settings-query').focus()}
function navigate(route){state.searchTarget=null;if(route!=='appearance' && route!=='settings'){openSheet(t(route),`<p>${t('unavailable')}</p><div class="sheet-actions"><button type="button" data-action="close-sheet">${t('close')}</button></div>`);return}state.searchOpen=false;$('#search-tray').hidden=true;history.pushState({route},'',`#${route}`);state.route=route;renderMain()}
function openSheet(title,html){state.sheet='general';$('#sheet-title').textContent=title;$('#sheet-close').innerHTML=icon('close');$('#sheet-content').innerHTML=html;$('#overlay').hidden=false;$('#sheet-close').focus()}
function closeSheet(){state.sheet=null;$('#overlay').hidden=true}
function back(){if(state.route==='dock-demo'){if(state.dockDepth>0){state.dockDepth--;renderMain()}else tapDock('profile');return}if(state.searchOpen){searchToggle(false);return}if(state.route==='appearance'&&dirty()){state.sheet='confirm-back';openSheet(t('leaveTitle'),`<p>${t('leaveText')}</p><div class="sheet-actions"><button type="button" data-action="stay">${t('stay')}</button><button type="button" class="primary" data-action="discard">${t('leave')}</button></div>`);state.sheet='confirm-back';return}if(state.route==='appearance'){state.route='settings';history.pushState({route:'settings'},'','#settings');renderMain()}else navigate('appearance')}
function save(){state.saved=clonePrefs(state.draft);renderMain(true);toast(t('saved'))}
function cancel(){state.draft=clonePrefs(state.saved);applyTheme();state.route='settings';history.pushState({route:'settings'},'','#settings');renderMain()}
function onClick(e){const el=e.target.closest('[data-action]');if(!el)return;const a=el.dataset.action;
 switch(a){case 'choose':state.draft[el.dataset.key]=el.dataset.value;renderMain(true);break;
 case 'save':save();break;case 'cancel':cancel();break;case 'back':back();break;
 case 'dock-add':changeDock(el.dataset.id,'add');break;
 case 'dock-remove':changeDock(el.dataset.id,'remove');break;
 case 'dock-move':changeDock(el.dataset.id,'move',Number(el.dataset.dir));break;
 case 'dock-reset':state.draft.dock=[...defaultDock];renderMain(true);toast(t('dockDefaults'));break;
 case 'dock-demo-deep':state.dockDepth++;renderMain();break;
 case 'dock-demo-back':if(state.dockDepth>0){state.dockDepth--;renderMain()}else tapDock('profile');break;
 case 'navigate':navigate(el.dataset.route);break;case 'search-result':if(el.dataset.field)navigateToSetting(el.dataset.field);else navigate(el.dataset.route);break;case 'search':searchToggle(!state.searchOpen);break;
 case 'clear-search':$('#settings-query').value='';state.query='';$('#clear-search').hidden=true;renderMain(true);$('#settings-query').focus();break;
 case 'close-search':searchToggle(false);break;case 'close-sheet':case 'stay':closeSheet();break;
 case 'discard':closeSheet();cancel();break;
 case 'status':openSheet(t('status'),`<p>${t('unavailable')}</p><div class="sheet-actions"><button type="button" data-action="close-sheet">${t('close')}</button></div>`);break;
 case 'tariff':openSheet(t('tariff'),`<p>${t('demo')}</p><div class="sheet-actions"><button type="button" data-action="close-sheet">${t('close')}</button></div>`);break;
 case 'dock':tapDock(el.dataset.route);break;
 case 'dummy':openSheet(t('deviceInfo'),`<p>${t('unavailable')}</p><div class="sheet-actions"><button type="button" data-action="close-sheet">${t('close')}</button></div>`);break;
 }}
$('#app').addEventListener('click',onClick);
$('#overlay').addEventListener('click',e=>{if(e.target.id==='overlay')closeSheet()});
$('#settings-query').addEventListener('input',e=>{state.query=e.target.value;$('#clear-search').hidden=!state.query;renderMain(true)});
document.addEventListener('keydown',e=>{if(e.key==='Escape'){if(state.sheet)closeSheet();else if(state.searchOpen)searchToggle(false);else back()}});
document.querySelectorAll('[data-device]').forEach(b=>b.addEventListener('click',()=>{const d=$('#device');d.className='device '+b.dataset.device;document.querySelectorAll('[data-device]').forEach(x=>{const v=x===b;x.classList.toggle('selected',v);x.setAttribute('aria-pressed',String(v))})}));
window.addEventListener('popstate',e=>{state.route=['settings','dock-demo'].includes(e.state?.route)?e.state.route:'appearance';if(state.route==='dock-demo'){state.activeDock=e.state?.activeDock||'tasks';state.dockDepth=e.state?.dockDepth||0;}if(state.route==='settings'&&dirty())state.draft=clonePrefs(state.saved);state.searchOpen=false;$('#search-tray').hidden=true;renderMain()});
if(window.matchMedia){const m=matchMedia('(prefers-color-scheme: light)');m.addEventListener?.('change',()=>{if(state.draft.theme==='system')applyTheme()})}
const initial=decodeURIComponent(location.hash.slice(1));state.route=initial==='settings'?'settings':'appearance';history.replaceState({route:state.route},'',`#${state.route}`);$('#header-search').innerHTML=icon('search');renderMain();
})();
