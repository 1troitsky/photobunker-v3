<script setup lang="ts">
import { ref, watch } from 'vue'
import { RouterLink } from 'vue-router'
import { activeSession } from '../features/identity/application/session'
import { blankProfile, readLocalProfile, type Profile } from '../features/profile/application/local-profile'
import { listLocalTeams, type TeamView } from '../features/people/application/team-book'

const profile=ref<Profile>(blankProfile()),teams=ref<TeamView[]>([])
const busy=ref(false),error=ref(''),notice=ref('')
let generation=0
async function refresh():Promise<void>{
  const id=++generation,session=activeSession.value
  profile.value=blankProfile();teams.value=[];error.value='';notice.value=''
  if(!session)return
  busy.value=true
  try{
    const [value,ownerTeams]=await Promise.all([readLocalProfile(),listLocalTeams()])
    if(id===generation&&activeSession.value?.accountId===session.accountId
      &&activeSession.value?.deviceId===session.deviceId){
      profile.value=value;teams.value=ownerTeams
    }
  }catch(e){if(id===generation)error.value=e instanceof Error?e.message:'Ошибка расшифровки профиля'}
  finally{if(id===generation)busy.value=false}
}
watch(activeSession,()=>{void refresh()},{immediate:true})
async function copy(value:string):Promise<void>{
  try{await navigator.clipboard.writeText(value);notice.value='Скопировано'}
  catch{error.value='Буфер обмена недоступен'}
}
</script>
<template>
<section class="profile-page" data-testid="profile-page">
  <div class="profile-page-heading">
    <RouterLink class="profile-back" to="/settings">‹ Настройки</RouterLink>
    <h1>Профиль</h1>
    <RouterLink v-if="activeSession" class="profile-edit-link" to="/settings/profile/edit">Редактировать</RouterLink>
  </div>
  <p v-if="!activeSession" class="profile-footnote">Откройте аккаунт для просмотра своего профиля. <RouterLink to="/settings">Доступ</RouterLink></p>
  <p v-else-if="busy" role="status" class="profile-footnote">Расшифровка профиля…</p>
  <p v-if="error" role="alert" class="profile-error">{{error}}</p>
  <p v-if="notice" role="status" class="profile-notice">{{notice}}</p>

  <template v-if="activeSession&&!busy">
    <div class="profile-top-clean">
      <span class="person-avatar large" aria-hidden="true">{{(profile.name||profile.username||'P').slice(0,1).toUpperCase()}}</span>
      <div class="profile-center-username">
        <strong>{{profile.username?'@'+profile.username:'@username не задан'}}</strong>
        <button v-if="profile.username" class="identity-copy" type="button"
          aria-label="Копировать username" @click="copy('@'+profile.username)">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" aria-hidden="true">
            <rect x="8" y="8" width="12" height="13" rx="2"/><path d="M16 8V5a2 2 0 0 0-2-2H5a2 2 0 0 0-2 2v10a2 2 0 0 0 2 2h3"/>
          </svg>
        </button>
      </div>
      <p v-if="profile.name" class="profile-display-name">{{profile.name}}</p>
      <div class="profile-center-id">
        <span>Технический ID: {{activeSession.accountId}}</span>
        <button class="identity-copy" type="button" aria-label="Копировать ID"
          @click="copy(activeSession.accountId)">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" aria-hidden="true">
            <rect x="8" y="8" width="12" height="13" rx="2"/><path d="M16 8V5a2 2 0 0 0-2-2H5a2 2 0 0 0-2 2v10a2 2 0 0 0 2 2h3"/>
          </svg>
        </button>
      </div>
      <div class="profile-center-presence" role="status">
        <span class="presence-dot" :class="{'is-hidden':!activeSession.online}"></span>
        <span>{{activeSession.online?'Сессия подтверждена':'Локальный режим'}}</span>
      </div>
      <div class="profile-main-actions">
        <button class="primary-action" type="button" disabled title="Нельзя отправить сообщение самому себе">Написать</button>
        <button class="secondary-action" type="button" disabled title="Голосовые вызовы ещё не подключены">Позвонить</button>
      </div>
    </div>

    <section class="profile-content-block about-block">
      <h2>О себе</h2>
      <p :class="{'profile-empty':!profile.about}">{{profile.about||'Пока ничего не указано.'}}</p>
    </section>

    <section class="profile-content-block link-block" aria-label="Действия с профилем">
      <button type="button" class="profile-link" disabled title="Публичная ссылка на профиль ещё не подключена">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" aria-hidden="true">
          <circle cx="18" cy="5" r="2"/><circle cx="6" cy="12" r="2"/><circle cx="18" cy="19" r="2"/><path d="m8 11 8-5M8 13l8 5"/>
        </svg>
        <span>Поделиться профилем</span>
      </button>
      <button type="button" class="profile-link" disabled title="Нельзя добавить свой аккаунт в контакты">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" aria-hidden="true">
          <path d="M12 5v14M5 12h14"/>
        </svg><span>Добавить в контакты</span>
      </button>
      <button type="button" class="profile-link danger" disabled title="Нельзя заблокировать собственный аккаунт">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" aria-hidden="true">
          <circle cx="12" cy="12" r="9"/><path d="m6 6 12 12"/>
        </svg><span>Заблокировать контакт</span>
      </button>
    </section>

    <section class="profile-content-block teams-block">
      <div class="block-heading"><h2>Мои команды</h2><span>{{teams.length}}</span></div>
      <div v-if="teams.length" class="profile-team-list">
        <div v-for="team in teams" :key="team.teamId" class="profile-team-item">
          <span class="team-icon" aria-hidden="true">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7"><circle cx="9" cy="7" r="3"/><path d="M3 20v-2a6 6 0 0 1 12 0v2M18 8a3 3 0 0 1 0 6M21 20v-2a5 5 0 0 0-4-4"/></svg>
          </span><span>{{team.name}}</span><small>{{team.memberCount}} участников</small>
        </div>
      </div>
      <p v-else class="profile-empty">Пока не создано ни одной команды.
        <RouterLink to="/contacts">Контакты и команды</RouterLink>
      </p>
    </section>
    <p class="profile-footnote">Поля профиля хранятся зашифрованно на этом устройстве. Глобальный @username, публичная карточка, восьмизначный #UserID и серверные правила приватности пока не подключены.</p>
  </template>
</section>
</template>
<style scoped>
/* Owner-approved Settings & Profile 1.6 layout borrowed from docs/ux/settings-profile/style.css.
   No fake global public identity or fabricated eight-digit ID. */
.person-avatar{width:38px;height:38px;border-radius:50%;display:grid;place-items:center;flex:none;background:#3f5146;color:#d9f2df;font-weight:760;overflow:hidden}.person-avatar img{height:100%;width:100%;object-fit:cover}.person-avatar.large{width:81px;height:81px;font-size:27px}.person-avatar.medium{width:62px;height:62px;font-size:22px}.profile-card{border-radius:10px;background:var(--surface);padding:25px 19px 18px}.profile-top{display:flex;align-items:center;gap:15px}.profile-name{font-size:21px;font-weight:800;line-height:1.15;letter-spacing:-.04em;overflow-wrap:anywhere}.profile-handle{font-size:12px;color:#c1c1c1;margin-top:6px}.profile-id{font-size:11px;color:#929292;margin-top:4px}.profile-bio{font-size:12px;line-height:1.65;color:#d1d1d1;white-space:pre-wrap;overflow-wrap:anywhere;margin:20px 0 0;border-top:1px solid #393939;padding-top:15px}.profile-empty{color:#858585}.profile-meta{display:flex;gap:8px;align-items:center;flex-wrap:wrap;margin-top:18px}.meta-pill{color:#b8b8b8;background:#2e2e2e;border-radius:5px;padding:5px 7px;font-size:10px}.meta-pill.private{color:#c1d5c6;background:#2e4035}.meta-pill svg{width:12px;height:12px;vertical-align:-2px}.section-title{font-size:13px;margin:22px 0 10px;font-weight:740}.stack{display:grid;gap:9px}.muted{color:#aaa;font-size:11px;line-height:1.58}.action-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:8px;margin-top:16px}.action-button{background:#333;border:0;border-radius:7px;display:flex;align-items:center;justify-content:center;gap:8px;min-height:43px;font-size:12px;font-weight:690;padding:9px}.action-button svg{height:17px;width:17px}.action-button:hover{background:#424242}.action-button.primary{color:#132516;background:var(--green)}.action-button.primary:hover{background:#32e271}.action-button.full{width:100%;margin-top:13px}.detail-strip{display:flex;align-items:center;gap:12px;min-height:52px;padding:13px 0;border-bottom:1px solid #333}.detail-strip:last-child{border-bottom:0}.detail-strip .grow{min-width:0;flex:1}.detail-strip strong{display:block;font-size:12px;font-weight:680}.detail-strip small{color:#999;display:block;margin-top:4px;font-size:11px}.detail-strip svg{width:17px;height:17px;color:#999}
.profile-identity-header{display:flex;flex-direction:column;align-items:center;gap:11px;padding:0 0 16px;text-align:center}
.profile-identity-header .person-avatar.large{width:91px;height:91px;font-size:29px;border:3px solid #304437}
.profile-identity-header .profile-name{font-size:19px;line-height:1.2}
.identity-lines{border-top:1px solid #373737}
.identity-line{display:flex;align-items:center;gap:12px;border-bottom:1px solid #373737;padding:12px 0}
.identity-text{flex:1;min-width:0;display:flex;flex-direction:column;gap:3px}
.identity-text small{font-size:10px;color:#a0a0a0}
.identity-text strong{font-size:14px;letter-spacing:.015em;overflow-wrap:anywhere;font-weight:750}
.copy-icon-button{background:#333;border:0;border-radius:7px;width:39px;height:38px;display:grid;place-items:center;flex:none}
.copy-icon-button svg{width:17px;height:17px}
.copy-icon-button:hover{background:#434343}
.profile-unnamed{color:#9c9c9c;font-size:11px}
.presence-line{display:flex;align-items:center;gap:8px;margin-top:13px;color:#c9c9c9;font-size:11.5px}
.presence-dot{width:8px;height:8px;background:var(--green);border-radius:50%;flex:none}
.presence-dot.is-hidden{background:#777}
.presence-extra{color:#da9999}
.profile-main-actions{display:grid;grid-template-columns:1fr 1fr;gap:9px;margin:20px 0 17px}
.profile-main-actions button{display:flex;align-items:center;justify-content:center;gap:7px;min-height:43px;border-radius:7px;font-size:12px;font-weight:690;border:0;padding:10px 8px;white-space:nowrap}
.profile-main-actions button svg{width:17px;height:17px}
.profile-main-actions .primary-action{color:#142217;background:var(--green)}
.profile-main-actions .secondary-action{background:#373737}
.profile-main-actions button:disabled{opacity:.43;cursor:not-allowed}
.about-section{border-top:1px solid #373737;padding:17px 0 18px}
.about-section h2{font-size:13px;margin:0 0 8px;font-weight:750}
.about-section p{font-size:12px;color:#c9c9c9;line-height:1.65;margin:0;white-space:pre-wrap;overflow-wrap:anywhere}
.about-section .profile-empty{color:#939393}
.profile-links{border-top:1px solid #373737;display:grid}
.profile-link{display:flex;gap:14px;align-items:center;text-align:left;min-height:58px;padding:12px 4px;border:0;border-bottom:1px solid #343844;background:none;font-size:13px;font-weight:500;color:#f0f1f4;letter-spacing:-.01em}
.profile-link:last-child{border-bottom:0}
.profile-link>svg{width:21px;height:21px;color:#bfc5d1;flex:none}
.profile-link span{flex:1}
.profile-link>svg:last-child{width:16px;height:16px;color:#8d95a5}
.profile-link:hover{color:#fff}.profile-link:hover>svg:last-child{color:#c6cedb}.profile-link:hover>svg:first-child{color:#d5dbe6}
.profile-link.danger{color:#f0b9b3}
.profile-link.danger>svg:first-child{color:#f0b9b3}
.profile-top-clean{display:flex;flex-direction:column;align-items:center;text-align:center;padding:11px 0 17px;background:transparent}
.profile-top-clean .person-avatar.large{width:102px;height:102px;min-width:102px;font-size:36px;border:0;background:#33483c;box-shadow:0 0 0 1px #3f5847}
.profile-center-username{display:flex;align-items:center;justify-content:center;gap:5px;max-width:100%;margin-top:16px;color:#f5f5f5}
.profile-center-username strong{font-size:26px;line-height:1.2;letter-spacing:-.055em;font-weight:800;overflow-wrap:anywhere;min-width:0}
.profile-center-id{display:flex;align-items:center;justify-content:center;gap:3px;margin-top:2px;color:#9e9e9e;font-size:12px;letter-spacing:.025em}
.identity-copy{display:inline-grid;place-items:center;flex:none;background:transparent;border:0;color:#a2a2a2;border-radius:5px;padding:3px;width:25px;height:25px}
.identity-copy svg{width:15px;height:15px}
.profile-center-id .identity-copy{width:22px;height:22px;padding:4px;color:#8c8c8c}
.profile-center-id .identity-copy svg{width:13px;height:13px}
.identity-copy:hover{color:#fff;background:#303030}
.profile-center-presence{display:flex;align-items:center;justify-content:center;gap:7px;color:#b8b8b8;font-size:11.5px;margin-top:7px}
.profile-center-presence .presence-dot{width:7px;height:7px}
.profile-top-clean .profile-main-actions{width:100%;max-width:520px;margin:22px 0 0;gap:9px}
.profile-top-clean .profile-main-actions button{min-height:43px}
.profile-top-clean .profile-main-actions button:disabled{opacity:1;background:#292929;color:#777;border:1px solid #343434}
.profile-content-block{background:#202020;border:0;border-radius:10px;margin-bottom:12px;padding:15px 18px}
.profile-content-block h2{font-size:13px;line-height:1.3;font-weight:750;margin:0 0 9px}
.profile-content-block p{color:#c3c3c3;font-size:12px;line-height:1.65;margin:0;white-space:pre-wrap;overflow-wrap:anywhere}
.profile-content-block p.profile-empty{color:#989898}
.profile-content-block.link-block{padding:0 14px}
.profile-content-block .profile-link{padding:12px 1px;min-height:51px}
.profile-content-block .profile-link:disabled{color:#7e7e7e;opacity:.44}
.profile-content-block .profile-link:disabled svg{color:#777}
.block-heading{display:flex;align-items:center;justify-content:space-between;gap:8px}
.block-heading h2{margin-bottom:9px}
.block-heading span{font-size:11px;color:#9d9d9d}
.profile-team-list{display:grid}
.profile-team-item{display:flex;align-items:center;gap:10px;min-height:44px;border-top:1px solid #333;font-weight:640;font-size:12px}
.profile-team-item .team-icon{display:grid;place-items:center;width:27px;height:27px;background:#303c33;color:#b7d7c1;border-radius:6px;flex:none}
.profile-team-item .team-icon svg{width:16px;height:16px}
.profile-content-block.link-block{
  background:#202020;border:0;border-radius:10px;
  padding:13px 17px;display:grid;gap:2px;
}
.profile-content-block.link-block .profile-link{
  display:flex;align-items:center;gap:15px;width:100%;min-height:56px;
  padding:12px 5px;margin:0;border:0;border-radius:8px;
  background:transparent;color:#eeeeee;font-size:13px;
  font-weight:500;line-height:1.4;text-align:left;letter-spacing:0;
}
.profile-content-block.link-block .profile-link:not(:last-child){border:0}
.profile-content-block.link-block .profile-link>svg{
  width:22px;height:22px;flex:0 0 22px;color:#aeb0b4;
}
.profile-content-block.link-block .profile-link span{flex:1}
.profile-content-block.link-block .profile-link.danger{color:#efb1a8}
.profile-content-block.link-block .profile-link.danger>svg{color:#aeb0b4}
.profile-content-block.link-block .profile-link:hover{background:#2b2b2b}
.profile-content-block.link-block .profile-link:focus-visible{outline:2px solid #95d8a7;outline-offset:-2px}
.profile-page{--green:#1ed760;max-width:660px;width:100%;padding:24px 15px 100px;margin:0 auto;color:#f1f1f1}
.profile-page-heading{display:flex;align-items:center;gap:12px;flex-wrap:wrap;margin:0 0 21px}
.profile-page-heading h1{font-size:26px;margin:0;font-weight:800;flex:1}
.profile-back,.profile-edit-link{font-size:12px;text-decoration:none;color:#b6e5c1}
.profile-edit-link{border:1px solid #536356;border-radius:8px;padding:9px 12px}
.profile-display-name{font-size:13px;color:#c5d1c7;margin:8px 0 1px}
.profile-center-id{overflow-wrap:anywhere;max-width:100%;font-size:11px}
.profile-content-block h2{margin:0 0 10px}
.profile-content-block.link-block .profile-link:disabled{opacity:.7;color:#b9b9b9;cursor:not-allowed}
.profile-content-block.link-block .profile-link.danger:disabled{color:#b99e9b}
.profile-team-item{gap:10px}
.profile-team-item>span:nth-child(2){flex:1}
.profile-team-item small{color:#9fada1}
.profile-footnote{font-size:11px;color:#a5b1a7;line-height:1.65;margin:16px 2px}
.profile-footnote a,.profile-page a{color:#b6e8c4}
.profile-notice{color:#b5f1c1;font-size:12px}.profile-error{color:#f2aaa6;font-size:12px}
.profile-page button:focus-visible{outline:2px solid #9fe8b2}
</style>