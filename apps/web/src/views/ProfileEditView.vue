<script setup lang="ts">
import { ref, watch } from 'vue'
import { RouterLink, useRouter, onBeforeRouteLeave } from 'vue-router'
import { activeSession } from '../features/identity/application/session'
import { blankProfile, readLocalProfile, saveLocalProfile, type Profile, type Visibility } from '../features/profile/application/local-profile'

const router=useRouter()
const draft=ref<Profile>(blankProfile()),original=ref<Profile>(blankProfile())
const loading=ref(false),saving=ref(false),error=ref('')
const committed=ref(false)
const visibility:{value:Visibility;label:string;description:string}[]=[
  {value:'everyone',label:'Всем',description:'Все пользователи'},
  {value:'contacts',label:'Только контактам',description:'Мои контакты'},
  {value:'team',label:'Контактам и участникам команд',description:'Контакты и участники команд'},
  {value:'nobody',label:'Никому',description:'Данные скрыты'},
]
let generation=0
watch(activeSession,async session=>{
  const token=++generation;draft.value=blankProfile();original.value=blankProfile();error.value='';committed.value=false
  if(!session)return
  loading.value=true
  try{
    const current=await readLocalProfile()
    if(token===generation&&activeSession.value?.accountId===session.accountId
      &&activeSession.value?.deviceId===session.deviceId){
      draft.value=current;original.value={...current}
    }
  }catch(e){if(token===generation)error.value=e instanceof Error?e.message:'Ошибка чтения'}
  finally{if(token===generation)loading.value=false}
},{immediate:true})
onBeforeRouteLeave(()=>{
  if(!committed.value&&!saving.value
    &&JSON.stringify(draft.value)!==JSON.stringify(original.value)){
    return window.confirm('Изменения профиля не сохранены. Выйти без сохранения?')
  }
  return true
})
async function save():Promise<void>{
  if(!activeSession.value||saving.value||loading.value)return
  saving.value=true;error.value=''
  try{
    const value={...draft.value,name:draft.value.name.trim(),about:draft.value.about.trim()}
    await saveLocalProfile(value)
    original.value=value;committed.value=true
    await router.push('/settings/profile')
  }catch(e){error.value=e instanceof Error?e.message:'Не удалось сохранить профиль'}
  finally{saving.value=false}
}
</script>
<template>
<section class="profile-edit" data-testid="profile-edit">
  <div class="profile-heading"><RouterLink to="/settings/profile">‹ Профиль</RouterLink>
    <div><h1>Настройки профиля</h1><p>Данные и приватность карточки</p></div>
  </div>
  <p v-if="!activeSession" role="status">Аккаунт закрыт. <RouterLink to="/settings">Открыть</RouterLink></p>
  <p v-else-if="loading" role="status">Расшифровка профиля…</p>
  <form v-else id="profile-form" @submit.prevent="save">
    <div class="form-card">
      <div class="profile-avatar-editor">
        <span class="person-avatar medium" aria-hidden="true">{{(draft.name||draft.username||'P').slice(0,1).toUpperCase()}}</span>
        <div class="avatar-actions">
          <strong>Аватар профиля</strong>
          <button type="button" class="text-button" disabled title="Безопасное сохранение аватара пока не реализовано">Изменить фото</button>
        </div>
      </div>
      <label class="field"><span>Имя</span>
        <input v-model="draft.name" maxlength="60" autocomplete="off" placeholder="Как к вам обращаться" data-testid="profile-name">
        <span class="hint">Необязательно.</span>
      </label>
      <label class="field"><span>Username</span>
        <div class="inline-input"><span>@</span>
          <input v-model="draft.username" minlength="3" maxlength="15" pattern="[a-z0-9]([a-z0-9.-]{1,13}[a-z0-9])"
            autocomplete="off" autocapitalize="none" spellcheck="false" placeholder="username"
            data-testid="profile-username">
        </div>
        <span class="hint">3–15 символов: a–z, 0–9, точка или дефис. Начало и конец — буква или цифра.</span>
      </label>
      <label class="field"><span>О себе</span>
        <textarea v-model="draft.about" maxlength="240" rows="4" placeholder="Краткое описание"
          data-testid="profile-about"></textarea>
        <div class="hint split"><span>Необязательно</span><span>{{draft.about.length}}/240</span></div>
      </label>
      <label class="field"><span>Кому видна карточка</span>
        <select v-model="draft.cardVisibility" data-testid="profile-card-visibility">
          <option v-for="v in visibility" :key="v.value" :value="v.value">{{v.description}}</option>
        </select>
        <span class="hint">Сохраняется зашифрованное локальное предпочтение. Правила публичной видимости на сервере не изменяются.</span>
      </label>
    </div>
    <h2 class="section-title">Видимость команд</h2>
    <div class="form-card">
      <label class="field"><span>Кто видит команды, в которых я состою</span>
        <select v-model="draft.teamsVisibility">
          <option v-for="v in visibility" :key="v.value" :value="v.value">{{v.description}}</option>
        </select>
      </label>
    </div>
    <h2 class="section-title">Онлайн-статус</h2>
    <div class="choice-list" role="radiogroup" aria-label="Кто видит, что вы в сети">
      <label v-for="v in visibility" :key="v.value" class="choice-row"
        :class="{selected:draft.presenceVisibility===v.value}">
        <input v-model="draft.presenceVisibility" type="radio" name="online-visibility" :value="v.value">
        <span class="radio-indicator"></span>
        <span class="choice-text"><strong>{{v.label}}</strong><small>{{v.description}}</small></span>
      </label>
    </div>
    <p class="profile-edit-footnote">Реальный публичный статус присутствия пока не передаётся на сервер. Здесь сохраняются только локальные настройки.</p>
    <p v-if="error" role="alert" class="form-error">{{error}}</p>
    <div class="form-footer">
      <RouterLink class="profile-cancel" to="/settings/profile">Отмена</RouterLink>
      <button type="submit" class="save" :disabled="saving||loading" data-testid="profile-save">Сохранить</button>
    </div>
  </form>
</section>
</template>
<style scoped>
/* Transferred owner-approved Fieldwork Settings & Profile 1.6 form primitives. */
.person-avatar{width:38px;height:38px;border-radius:50%;display:grid;place-items:center;flex:none;background:#3f5146;color:#d9f2df;font-weight:760;overflow:hidden}.person-avatar img{height:100%;width:100%;object-fit:cover}.person-avatar.large{width:81px;height:81px;font-size:27px}.person-avatar.medium{width:62px;height:62px;font-size:22px}.profile-card{border-radius:10px;background:var(--surface);padding:25px 19px 18px}.profile-top{display:flex;align-items:center;gap:15px}.profile-name{font-size:21px;font-weight:800;line-height:1.15;letter-spacing:-.04em;overflow-wrap:anywhere}.profile-handle{font-size:12px;color:#c1c1c1;margin-top:6px}.profile-id{font-size:11px;color:#929292;margin-top:4px}.profile-bio{font-size:12px;line-height:1.65;color:#d1d1d1;white-space:pre-wrap;overflow-wrap:anywhere;margin:20px 0 0;border-top:1px solid #393939;padding-top:15px}.profile-empty{color:#858585}.profile-meta{display:flex;gap:8px;align-items:center;flex-wrap:wrap;margin-top:18px}.meta-pill{color:#b8b8b8;background:#2e2e2e;border-radius:5px;padding:5px 7px;font-size:10px}.meta-pill.private{color:#c1d5c6;background:#2e4035}.meta-pill svg{width:12px;height:12px;vertical-align:-2px}.section-title{font-size:13px;margin:22px 0 10px;font-weight:740}.stack{display:grid;gap:9px}.muted{color:#aaa;font-size:11px;line-height:1.58}.action-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:8px;margin-top:16px}.action-button{background:#333;border:0;border-radius:7px;display:flex;align-items:center;justify-content:center;gap:8px;min-height:43px;font-size:12px;font-weight:690;padding:9px}.action-button svg{height:17px;width:17px}.action-button:hover{background:#424242}.action-button.primary{color:#132516;background:var(--green)}.action-button.primary:hover{background:#32e271}.action-button.full{width:100%;margin-top:13px}.detail-strip{display:flex;align-items:center;gap:12px;min-height:52px;padding:13px 0;border-bottom:1px solid #333}.detail-strip:last-child{border-bottom:0}.detail-strip .grow{min-width:0;flex:1}.detail-strip strong{display:block;font-size:12px;font-weight:680}.detail-strip small{color:#999;display:block;margin-top:4px;font-size:11px}.detail-strip svg{width:17px;height:17px;color:#999}
.form-card{background:var(--surface);border-radius:9px;padding:18px 15px}.profile-avatar-editor{display:flex;align-items:center;gap:16px;padding-bottom:16px;border-bottom:1px solid #393939;margin-bottom:16px}.avatar-actions{display:flex;flex-direction:column;align-items:flex-start;gap:9px}.text-button{padding:0;border:0;background:none;color:#b7e5c3;font-weight:680;font-size:12px}.text-button.danger{color:#efa9a9}.field{display:block;margin:0 0 15px}.field:last-child{margin-bottom:0}.field>span{display:block;margin-bottom:7px;font-size:12px;font-weight:680;color:#ddd}.field>input,.field>textarea,.field>select{width:100%;background:#1b1b1b;border:1px solid #454545;color:#eee;border-radius:7px;padding:11px 12px;min-height:44px;font-size:13px;outline:0}.field>input:focus,.field>textarea:focus,.field>select:focus{border-color:#78b58a}.field>textarea{min-height:94px;resize:vertical}.field .hint{font-size:10.5px;color:#969696;margin-top:6px;line-height:1.5}.hint.split{display:flex;justify-content:space-between;gap:8px}.inline-input{position:relative}.inline-input>span{position:absolute;left:13px;top:12px;color:#aaa;font-size:13px}.inline-input input{padding-left:28px;width:100%;background:#1b1b1b;border:1px solid #454545;color:#eee;border-radius:7px;min-height:44px;outline:0}.inline-input input:focus{border-color:#78b58a}.form-error{background:#4a3030;color:#f3c1c1;border-radius:7px;padding:10px;font-size:11px;margin:0 0 12px}.form-footer{margin-top:12px;display:grid;grid-template-columns:1fr 1fr;gap:8px}.form-footer button{min-height:44px;border-radius:7px;border:0;background:#343434;font-weight:700;font-size:12px}.form-footer button.save{background:var(--green);color:#102016}.footnote{font-size:11px;line-height:1.55;color:#929292;margin:15px 1px 0}
.choice-list{display:grid;gap:9px}.choice-row{display:flex;align-items:center;gap:12px;min-height:69px;background:var(--surface);padding:13px 14px;border:1px solid transparent;border-radius:9px;cursor:pointer}.choice-row:hover{background:#292929}.choice-row.selected{background:#213329;border-color:#477556}.choice-row input{position:absolute;opacity:0;width:1px;height:1px}.radio-indicator{width:19px;height:19px;border:2px solid #888;border-radius:50%;flex:none;display:grid;place-items:center}.choice-row.selected .radio-indicator{border-color:var(--green)}.choice-row.selected .radio-indicator:after{content:"";height:9px;width:9px;background:var(--green);border-radius:50%}.choice-text{flex:1}.choice-text strong{display:block;font-size:12px;margin-bottom:3px}.choice-text small{display:block;color:#999;font-size:11px}.toggle-row{display:flex;align-items:center;justify-content:space-between;gap:14px;background:var(--surface);border-radius:9px;padding:14px;margin-top:14px;cursor:pointer}.toggle-row.disabled{opacity:.45;cursor:not-allowed}.toggle-row strong{font-size:12px;display:block}.toggle-row small{font-size:11px;color:#999;margin-top:4px;display:block}.switch-input{appearance:none;width:38px;height:22px;background:#515151;border-radius:100px;flex:none;position:relative;cursor:pointer;margin:0}.switch-input:after{content:"";position:absolute;background:#eee;border-radius:50%;width:16px;height:16px;left:3px;top:3px;transition:transform .15s}.switch-input:checked{background:#247b3e}.switch-input:checked:after{transform:translateX(16px)}.switch-input:disabled{cursor:not-allowed}.status-preview{background:var(--surface);border-radius:9px;padding:14px;display:flex;align-items:center;gap:11px}.status-text{font-size:11px;color:#aaa}.status-led{width:7px;height:7px;background:var(--green);border-radius:50%;display:inline-block;margin-right:5px}.status-led.off{background:#777}.result-count{font-size:11px;color:#999;margin:0 0 12px}.search-result{display:flex;align-items:center;gap:11px;border:0;border-bottom:1px solid #343434;background:var(--surface);padding:13px 12px;min-height:65px;width:100%;text-align:left}.search-result:first-child{border-radius:9px 9px 0 0}.search-result:last-child{border-bottom:0;border-radius:0 0 9px 9px}.search-result:only-child{border-radius:9px}.search-result:hover{background:#292929}.search-result .result-copy{flex:1;min-width:0}.search-result strong{display:block;font-size:12px}.search-result small{display:block;font-size:10.5px;color:#999;margin-top:4px}.search-result svg{color:#888;width:16px}.search-list{overflow:hidden;border-radius:9px}.empty{background:var(--surface);border-radius:9px;padding:28px 15px;text-align:center;color:#aaa;font-size:12px}.empty strong{display:block;color:#ddd;font-size:14px;margin:0 0 4px}.future-page{background:var(--surface);border-radius:9px;padding:17px 15px}.future-page h2{font-size:13px;margin:0 0 5px}.future-page .future-item{padding:11px 1px;border-bottom:1px solid #373737;font-size:12px;color:#ccc}.future-page .future-item:last-child{border-bottom:0}.future-page .eyebrow{display:inline-block;color:#aed2b7;background:#304135;font-size:10px;border-radius:5px;padding:5px 7px;margin-bottom:14px}
.form-card+.section-title{margin-top:24px}
.profile-edit{--green:#1ed760;--surface:#202020;max-width:660px;margin:0 auto;padding:24px 15px 100px;color:#f4f4f4}
.profile-heading{display:flex;gap:13px;align-items:center;margin-bottom:22px}
.profile-heading a{color:#b2e3c2;text-decoration:none;font-size:12px;white-space:nowrap}
.profile-heading h1{font-size:26px;letter-spacing:-.04em;margin:0}
.profile-heading p{font-size:11px;color:#a3a3a3;margin:5px 0 0}
.profile-avatar-editor .person-avatar{width:62px;height:62px;font-size:24px}
.avatar-actions strong{font-size:12px}
.profile-edit .field .hint{display:block;font-weight:400;margin-top:7px}
.profile-edit .field .hint.split{display:flex;justify-content:space-between}
.profile-edit .section-title{font-size:12px;color:#bcbcbc;font-weight:730;margin:24px 3px 10px}
.profile-edit .choice-row{position:relative}
.profile-edit-footnote{color:#9ea9a0;font-size:11px;line-height:1.6}
.profile-edit .form-footer{position:sticky;bottom:0;padding:12px 0;background:linear-gradient(180deg,transparent,#121212 26%);z-index:3}
.profile-edit .form-footer .profile-cancel{display:grid;place-items:center;min-height:44px;border:1px solid #444;border-radius:8px;background:#343434;color:#eaeaea;font-size:12px;font-weight:700;text-decoration:none}
.profile-edit .form-footer button:disabled{opacity:.5;cursor:not-allowed}
.profile-edit .text-button:disabled{opacity:.45;cursor:not-allowed}
.profile-edit .profile-cancel:focus-visible,.profile-edit button:focus-visible{outline:2px solid #a6e6b6;outline-offset:2px}
@media(max-width:420px){.profile-edit{padding:19px 12px 100px}}
</style>