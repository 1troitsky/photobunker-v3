
(() => {
  'use strict';
  const app = document.getElementById('app');
  if (!app || app.dataset.ready) return;
  app.dataset.ready = '1';
  const $ = s => app.querySelector(s);
  const $$ = s => [...app.querySelectorAll(s)];
  const field = name => $(`[name="${name}"]`);
  const overlay = $('#dialog-overlay');
  const content = $('#dialog-content');
  const scroll = $('#editor-content');
  const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const labels = {photo:'Фото',video:'Видео',audio:'Аудио'};
  const allows = {photo:'allowPhoto',video:'allowVideo',audio:'allowAudio'};
  const counts = {photo:'photoCount',video:'videoCount',audio:'audioCount'};
  const instructions = {photo:'photoShots',video:'videoShots',audio:'audioShots'};
  const roleNames = {curator:'Куратор',contributor:'Исполнитель',viewer:'Наблюдатель'};
  const scopes = {default:'По правилам задания',none:'Нет доступа',thumbnails:'Только предпросмотр',all:'Полный доступ'};
  const teams = {
    'Site A Crew':[{id:1,name:'Анна',slug:'@anna',userId:'U1001',role:'curator',scope:'all'},{id:2,name:'Марк',slug:'@mark',userId:'U1002',role:'contributor',scope:'default'}],
    'Репортаж':[{id:3,name:'Ольга',slug:'@olga',userId:'U1003',role:'curator',scope:'default'},{id:4,name:'Давид',slug:'',userId:'U1004',role:'contributor',scope:'thumbnails'}],
    '':[]
  };
  const directory = [
    {key:'anna',name:'Анна',slug:'@anna',id:'U1001'},
    {key:'mark',name:'Марк',slug:'@mark',id:'U1002'},
    {key:'olga',name:'Ольга',slug:'@olga',id:'U1003'},
    {key:'david',name:'Давид',slug:'',id:'U1004'},
    {key:'nikita',name:'Никита',slug:'',id:'U1005'},
    {key:'irina',name:'Ирина',slug:'@irina',id:'U1006'}
  ];
  let people = teams['Site A Crew'].map(p => ({...p}));
  let team = 'Site A Crew', nextId=10, activePerson=null, openedTab='basics', addTab='contacts';
  let statusLog = [{kind:'success',title:'В работе',message:'Настройки открыты'}];
  const asLocal = d => new Date(d.getTime() - d.getTimezoneOffset()*60000).toISOString().slice(0,16);
  const daysAfter = (d,days=1) => new Date(d.getTime()+days*86400000);
  const tomorrowMin = asLocal(daysAfter(new Date()));
  const start = field('startsAt');
  const initialNow = asLocal(new Date());
  start.min=initialNow;
  start.value=initialNow;
  field('finishesAt').value=tomorrowMin;
  field('finishesAt').min=tomorrowMin;
  field('removeFilesAt').value=tomorrowMin;
  field('removeAssignmentAt').value=tomorrowMin;
  const initial = {};
  for(const f of $$('input[name],select[name],textarea[name]')) initial[f.name] = f.type==='checkbox'?f.checked:f.value;
  const plural = (n,one,few,many) => {
    const v=Math.abs(n)%100;
    return v>=11 && v<=14?many:Math.abs(n)%10===1?one:[2,3,4].includes(Math.abs(n)%10)?few:many;
  };
  function status(kind,title,message){
    statusLog.unshift({kind,title,message}); statusLog=statusLog.slice(0,15);
    $('#status-label').textContent=kind==='error'?'Ошибка':'В работе';
    $('.state-led').classList.toggle('error',kind==='error');
  }
  function showSheet(title,body){
    $('#dialog-title').textContent=title;
    content.innerHTML=body;
    overlay.hidden=false;
    overlay.querySelector('.dialog-sheet').focus();
  }
  function closeSheet(){ overlay.hidden=true;activePerson=null; }
  function note(title,body){ showSheet(title,`<div class="dialog-note">${body}</div><button class="submit" data-sheet="close">Готово</button>`); }
  function setTab(name){
    if(!['basics','camera','participants','rules'].includes(name)) return;
    openedTab=name;
    $$('[data-pane]').forEach(x=>{x.hidden=x.dataset.pane!==name});
    $$('[data-tab]').forEach(x=>{
      const on=x.dataset.tab===name;
      x.classList.toggle('selected',on);
      x.setAttribute('aria-selected',String(on));
    });
    scroll.scrollTop=0;
    $('#form-error').hidden=true;
  }
  function dirty(){
    $('#draft-state').textContent='Изменён';
    $('#draft-caption').textContent='Несохранённые изменения';
  }
  function getEffectiveFinish(){
    if(field('hasFinish').checked) return {date:field('finishesAt').value, reason:'Установленная дата окончания'};
    const options=[];
    if(field('autoFiles').checked && field('removeFilesAt').value)
      options.push({date:field('removeFilesAt').value,reason:'Дата удаления файлов'});
    if(field('autoAssignment').checked && field('removeAssignmentAt').value)
      options.push({date:field('removeAssignmentAt').value,reason:'Дата удаления задания'});
    options.sort((a,b)=>a.date.localeCompare(b.date));
    return options[0] || null;
  }
  function refreshDates(){
    const startValue=field('startsAt').value || initialNow;
    const finishMin=[tomorrowMin,asLocal(new Date(new Date(startValue).getTime()+60000))].sort().at(-1);
    const finish=field('finishesAt');
    finish.min=finishMin;
    if(!finish.value||finish.value<finishMin)finish.value=finishMin;
    const removeMin=field('hasFinish').checked?finish.value:finishMin;
    for(const name of ['removeFilesAt','removeAssignmentAt']){
      const el=field(name);el.min=removeMin;
      if(!el.value||el.value<removeMin)el.value=removeMin;
    }
    const computed=getEffectiveFinish();
    $('#effective-finish').textContent=computed
      ? 'Задание завершится: '+computed.date.replace('T',' ')+' · '+computed.reason
      : 'Без срока окончания';
  }
  function refreshDeps(){
    for(const control of $$('[data-toggle]')){
      $$(`[data-dep="${control.dataset.toggle}"]`).forEach(node=>{node.hidden=!control.checked});
    }
  }
  function refreshMedia(){
    let active=0,hasTarget=false;
    const items=[];
    for(const type of ['photo','video','audio']){
      const enabled=field(allows[type]).checked;
      const card=$(`[data-type="${type}"]`);
      card.classList.toggle('off',!enabled);
      if(enabled){
        active++;
        const target=field(counts[type]).value.trim();
        if(target)hasTarget=true;
        items.push(`<span>${labels[type]}: ${target?esc(target):'без цели'}</span>`);
      }
      const value=field(instructions[type]).value.trim();
      $(`[data-shots="${type}"]`).textContent=value?'Инструкции указаны':'Без дополнительных инструкций';
    }
    $('#media-summary').innerHTML=items.join('');
    $('#total-count').textContent=active+' '+plural(active,'тип','типа','типов')+(hasTarget?' · цели для прогресса':' · без количественных целей');
  }
  const displayId=p=>p.slug || '#'+(p.userId || p.id);
  const avatarText=p=>p.name?.slice(0,1).toUpperCase() || (p.slug?.replace('@','').slice(0,1).toUpperCase()) || '#';
  function renderPeople(){
    const all=[{id:'owner',name:'Вы',slug:'@you',userId:'U1000',role:'Владелец',scope:'Полный доступ'},...people];
    $('#people-count').textContent=all.length+' '+plural(all.length,'человек','человека','человек');
    $('#team-name').textContent=team || 'Без команды';
    $('#people-list').innerHTML=all.map(p=>`<div class="person-row ${p.id==='owner'?'owner':''}">
      <div class="person-avatar" aria-hidden="true">${esc(avatarText(p))}</div>
      <div class="person-data"><strong>${esc(displayId(p))}</strong></div>
      ${p.id==='owner'?'<span style="color:var(--green)" title="Владелец">✓</span>':`<button type="button" data-action="person" data-person="${p.id}" aria-label="Настроить участника ${esc(displayId(p))}">•••</button>`}
    </div>`).join('');
  }
  function reset(){
    for(const f of $$('input[name],select[name],textarea[name]')){
      if(f.type==='checkbox') f.checked=initial[f.name];
      else f.value=initial[f.name];
    }
    team='Site A Crew'; people=teams[team].map(p=>({...p}));
    refreshDates();refreshDeps();refreshMedia();renderPeople();setTab('basics');
    $('#draft-state').textContent='Черновик';$('#draft-caption').textContent='Черновик';
    status('success','В работе','Настройки сброшены');
  }
  function validate(){
    if(!field('name').value.trim()) return ['Введите название задания','basics','name'];
    if(!start.value||start.value<start.min) return ['Дата начала не может быть раньше текущего времени','basics','startsAt'];
    const hasFinish=field('hasFinish').checked;
    if(hasFinish && (!field('finishesAt').value||field('finishesAt').value<field('finishesAt').min))
      return ['Проверьте дату окончания','basics','finishesAt'];
    for(const [toggle,name,label] of [['autoFiles','removeFilesAt','удаления файлов'],['autoAssignment','removeAssignmentAt','удаления задания']]){
      if(field(toggle).checked && (!field(name).value||field(name).value<field(name).min))
        return [`Проверьте дату ${label}`,'basics',name];
    }
    const effective=getEffectiveFinish();
    if(effective && effective.date < asLocal(new Date(new Date(start.value).getTime()+60000)))
      return ['Задание не может завершиться до начала','basics',field('hasFinish').checked?'finishesAt':field('autoFiles').checked?'removeFilesAt':'removeAssignmentAt'];
    const enabled=['photo','video','audio'].filter(t=>field(allows[t]).checked);
    if(enabled.length===0)return ['Разрешите хотя бы один тип файла','camera','allowPhoto'];
    for(const type of enabled){
      const el=field(counts[type]);
      const raw=el.value.trim();
      const limit=type==='photo'?9999:999;
      if(raw && (!/^\d+$/.test(raw)||+raw<1||+raw>limit))
        return [`Количество ${labels[type].toLowerCase()} должно быть от 1 до ${limit}`,'camera',counts[type]];
    }
    if(field('particularCategory').checked && !field('categories').value.trim())
      return ['Укажите разрешённые категории','rules','categories'];
    if(field('particularTags').checked && !field('allowedTags').value.trim())
      return ['Укажите разрешённые теги','rules','allowedTags'];
    if(field('descriptionRequired').checked && (+field('minLength').value<1||+field('minLength').value>2000))
      return ['Минимальная длина описания — от 1 до 2000','rules','minLength'];
    return null;
  }
  function showValidationFailure(failure){
    setTab(failure[1]);
    $('#form-error').hidden=false;
    $('#form-error').textContent=failure[0];
    field(failure[2])?.focus();
    status('error','Проверка',failure[0]);
  }
  function save(){
    const failure=validate();
    if(failure) return showValidationFailure(failure);
    const media=['photo','video','audio'].filter(t=>field(allows[t]).checked)
      .map(t=>`<div style="padding:6px 0;border-bottom:1px solid #4b4b4b">${labels[t]} · ${field(counts[t]).value.trim()||'без цели'}</div>`).join('');
    const autoFiles=field('autoFiles').checked ? esc(field('removeFilesAt').value.replace('T',' ')):'Никогда';
    const autoTask=field('autoAssignment').checked ? esc(field('removeAssignmentAt').value.replace('T',' ')):'Никогда';
    showSheet('Параметры задания',`<div class="dialog-note"><strong>${esc(field('name').value.trim())}</strong>
      <p>Разрешённые форматы:</p>${media}<p>Удаление файлов: ${autoFiles}<br>Удаление задания: ${autoTask}</p>
      <p>Загрузка из внешних источников: ${field('allowExternalUpload').checked?'разрешена':'запрещена'}</p></div>
      <button class="submit" data-sheet="close">Закрыть</button>`);
    $('#draft-state').textContent='Проверено';
    $('#draft-caption').textContent='Настройки проверены';
    status('success','Проверка','Параметры прошли проверку формы');
  }
  function presetSheet(){
    showSheet('Настройки камеры',`<div class="dialog-note">Параметры выбранного пресета</div>
    <label>Название пресета<input id="preset-name" value="${esc(field('presetId').selectedOptions[0].textContent)}" maxlength="60"></label>
    <label>Качество фото<select id="preset-photo"><option>Максимальное</option><option selected>Высокое</option><option>Среднее</option></select></label>
    <label>Качество видео<select id="preset-video"><option>480p</option><option>720p</option><option selected>1080p</option></select></label>
    <label>Качество аудио<select id="preset-audio"><option>64 кбит/с</option><option selected>128 кбит/с</option><option>256 кбит/с</option></select></label>
    <button class="submit" data-sheet="save-preset">Сохранить пресет</button>
    <button data-sheet="add-preset">Добавить пресет</button>`);
  }
  function teamSheet(){
    showSheet('Выбрать команду',Object.keys(teams).map(name=>`<button data-sheet="choose-team" data-team="${esc(name)}">${esc(name||'Без команды')}</button>`).join('')+
    '');
  }
  function teamSettings(){
    showSheet('Настройки команды',`<div class="dialog-note"><strong>${esc(team||'Без команды')}</strong><p>Настройки команды доступны отдельно от задания.</p></div>
    <button data-sheet="choose-team">Без команды</button><button class="submit" data-sheet="close">Готово</button>`);
  }
  function personSheet(id){
    const p=people.find(x=>x.id===id);if(!p)return;
    activePerson=id;
    showSheet(displayId(p),`<label>Роль<select id="person-role">${Object.entries(roleNames).map(([v,t])=>`<option value="${v}" ${p.role===v?'selected':''}>${t}</option>`).join('')}</select></label>
    <label>Доступ к файлам<select id="person-scope">${Object.entries(scopes).map(([v,t])=>`<option value="${v}" ${p.scope===v?'selected':''}>${t}</option>`).join('')}</select></label>
    <button class="submit" data-sheet="save-person">Сохранить</button><button class="danger" data-sheet="remove-person">Удалить участника</button>`);
  }
  function addPersonSheet(tab='contacts'){
    addTab=tab;
    showSheet('Добавить участника',`<div class="sheet-tabs"><button data-sheet="contacts-tab" class="${tab==='contacts'?'selected':''}">Контакты</button>
      <button data-sheet="search-tab" class="${tab==='search'?'selected':''}">Поиск</button></div>
      <label>${tab==='contacts'?'Контакты':'UserID или @UserSlug'}<input id="people-query" placeholder="${tab==='contacts'?'Имя контакта':'@username или U1003'}" autocomplete="off"></label>
      <div class="search-results" id="people-results"></div>`);
    renderMatches('');
  }
  function renderMatches(query){
    const place=content.querySelector('#people-results');if(!place)return;
    const q=query.toLocaleLowerCase().trim();
    let items=directory.filter(p=>!people.some(x=>x.name===p.name));
    if(addTab==='contacts') items=items.filter(p=>['Ольга','Давид','Никита'].includes(p.name));
    if(q) items=items.filter(p=>[p.name,p.slug,p.id].some(x=>x.toLocaleLowerCase().includes(q)));
    place.innerHTML=items.length?items.map(p=>`<button class="person-choice" data-sheet="pick-person" data-person-key="${p.key}"><span class="person-avatar" aria-hidden="true">${esc(avatarText(p))}</span><span class="person-data"><strong>${esc(displayId({slug:p.slug,userId:p.id}))}</strong></span></button>`).join('')
      : '<div class="dialog-note">Ничего не найдено</div>';
  }
  app.addEventListener('click',event=>{
    const btn=event.target.closest('button');if(!btn)return;
    if(btn.dataset.tab){setTab(btn.dataset.tab);return;}
    const action=btn.dataset.action;
    if(action==='status'){showSheet('Состояние',statusLog.map(x=>`<div class="dialog-note"><strong>${esc(x.title)}</strong><p>${esc(x.message)}</p></div>`).join(''));return;}
    if(action==='info'){note('Редактор задания','Настройте сроки, разрешённые типы файлов, участников и правила.');return;}
    if(action==='back'){note('Возврат к заданиям','Вернуться к списку заданий?');return;}
    if(action==='save'){save();return;}
    if(action==='reset'){reset();return;}
    if(action==='preset'){presetSheet();return;}
    if(action==='team'){teamSheet();return;}
    if(action==='team-settings'){teamSettings();return;}
    if(action==='person'){personSheet(+btn.dataset.person);return;}
    if(action==='add-person'){addPersonSheet();return;}
    if(action==='close'){closeSheet();return;}
  });
  app.addEventListener('change',event=>{
    const el=event.target;
    if(el.matches('.media-enable')&&!['photo','video','audio'].some(t=>field(allows[t]).checked)){
      el.checked=true;
      note('Типы файлов','Нужно разрешить хотя бы один тип файлов.');
      return;
    }
    if(el.matches('input,textarea,select')){
      if(['startsAt','finishesAt','hasFinish','autoFiles','autoAssignment'].includes(el.name))refreshDates();
      refreshDeps();refreshMedia();dirty();
    }
  });
  app.addEventListener('input',event=>{
    if(event.target.matches('input,textarea,select')){
      if(['startsAt','finishesAt','removeFilesAt','removeAssignmentAt'].includes(event.target.name)) refreshDates();
      refreshMedia();dirty();
    }
  });
  content.addEventListener('input',event=>{
    if(event.target.id==='people-query')renderMatches(event.target.value);
  });
  content.addEventListener('click',event=>{
    const btn=event.target.closest('button[data-sheet]');if(!btn)return;
    const a=btn.dataset.sheet;
    if(a==='close'){closeSheet();return;}
    if(a==='contacts-tab'){addPersonSheet('contacts');return;}
    if(a==='search-tab'){addPersonSheet('search');return;}
    if(a==='add-preset'||a==='save-preset'){
      const name=content.querySelector('#preset-name')?.value.trim();if(!name)return;
      const select=field('presetId');
      if(a==='add-preset'){
        const opt=document.createElement('option');opt.value='custom-'+Date.now();opt.textContent=name;select.append(opt);select.value=opt.value;
      }else select.selectedOptions[0].textContent=name;
      closeSheet();dirty();return;
    }
    if(a==='team-settings'){teamSettings();return;}
    if(a==='choose-team'){
      team=btn.dataset.team||'';
      people=(teams[team]||[]).map(p=>({...p}));
      renderPeople();closeSheet();dirty();return;
    }
    if(a==='pick-person'){
      const person=directory.find(p=>p.key===btn.dataset.personKey);
      if(person&&!people.some(x=>x.name===person.name)){
        people.push({id:nextId++,name:person.name,slug:person.slug,userId:person.id,role:'contributor',scope:'default'});
        renderPeople();dirty();
      }
      closeSheet();return;
    }
    if(a==='save-person'){
      const p=people.find(x=>x.id===activePerson);
      if(p){p.role=content.querySelector('#person-role').value;p.scope=content.querySelector('#person-scope').value;}
      renderPeople();closeSheet();dirty();return;
    }
    if(a==='remove-person'){
      people=people.filter(x=>x.id!==activePerson);
      renderPeople();closeSheet();dirty();return;
    }
  });
  overlay.addEventListener('click',e=>{if(e.target===overlay)closeSheet();});
  document.addEventListener('keydown',e=>{if(e.key==='Escape'&&!overlay.hidden)closeSheet();});
  document.querySelectorAll('[data-device]').forEach(btn=>btn.addEventListener('click',()=>{
    document.getElementById('device').className='device '+btn.dataset.device;
    document.querySelectorAll('[data-device]').forEach(x=>{
      x.classList.toggle('selected',x===btn);
      x.setAttribute('aria-pressed',String(x===btn));
    });
  }));
  refreshDates();refreshDeps();refreshMedia();renderPeople();setTab('basics');
})();

