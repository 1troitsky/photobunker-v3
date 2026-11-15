<script setup lang="ts">
import { ref, watch } from 'vue'
import { RouterLink } from 'vue-router'
import { activeSession } from '../features/identity/application/session'
import { blankProfile, readLocalProfile, type Profile } from '../features/profile/application/local-profile'
import { listLocalTeams, type TeamView } from '../features/people/application/team-book'

const profile=ref<Profile>(blankProfile())
const teams=ref<TeamView[]>([])
const busy=ref(false)
const error=ref('')
let seq=0
async function refresh():Promise<void>{
  const id=++seq, session=activeSession.value
  profile.value=blankProfile()
  teams.value=[]
  error.value=''
  if(!session)return
  busy.value=true
  try{
    const [value,owned]=await Promise.all([readLocalProfile(),listLocalTeams()])
    if(id===seq&&activeSession.value?.accountId===session.accountId
      &&activeSession.value?.deviceId===session.deviceId){profile.value=value;teams.value=owned}
  }catch(e){if(id===seq)error.value=e instanceof Error?e.message:'Ошибка чтения профиля'}
  finally{if(id===seq)busy.value=false}
}
watch(activeSession,()=>{void refresh()},{immediate:true})
async function copy(value:string):Promise<void>{try{await navigator.clipboard.writeText(value)}catch{error.value='Буфер обмена недоступен'}}
</script>
<template>
  <section class="profile-page" data-testid="profile-page">
    <RouterLink class="profile-back" to="/settings">‹ Настройки</RouterLink>
    <h1>Мой профиль</h1>
    <p v-if="!activeSession" class="profile-note">Для просмотра профиля требуется открыть аккаунт. <RouterLink to="/settings">Доступ</RouterLink></p>
    <p v-else-if="busy" role="status">Загрузка зашифрованного профиля…</p>
    <p v-if="error" role="alert">{{ error }}</p>
    <template v-if="activeSession&&!busy">
      <div class="profile-avatar" aria-hidden="true">{{ (profile.name||profile.username||'P').slice(0,1).toUpperCase() }}</div>
      <h2>{{ profile.name||'Имя не указано' }}</h2>
      <div class="profile-identifier">
        <strong>{{ profile.username?'@'+profile.username:'@username не задан' }}</strong>
        <button v-if="profile.username" type="button" @click="copy('@'+profile.username)">Копировать</button>
      </div>
      <div class="profile-identifier">
        <small>Технический ID аккаунта: {{ activeSession.accountId }}</small>
        <button type="button" @click="copy(activeSession.accountId)">Копировать</button>
      </div>
      <p class="profile-note">{{ activeSession.online?'Сессия подтверждена':'Локальный режим' }}</p>
      <div class="profile-buttons">
        <RouterLink to="/settings/profile/edit">Редактировать профиль</RouterLink>
        <RouterLink to="/messages">Сообщения</RouterLink>
      </div>
      <h3>О себе</h3>
      <p>{{ profile.about||'Пока ничего не указано.' }}</p>
      <h3>Приватность</h3>
      <p>Карточка: {{ profile.cardVisibility }} · Команды: {{ profile.teamsVisibility }} · Статус: {{ profile.presenceVisibility }}</p>
      <h3>Мои команды</h3>
      <ul v-if="teams.length" class="profile-teams"><li v-for="team in teams" :key="team.teamId"><strong>{{ team.name }}</strong><small>{{ team.memberCount }} участников · {{ team.delivery==='synced'?'Синхронизирована':'Локальная очередь' }}</small></li></ul>
      <p v-else>У вас пока нет команд. <RouterLink to="/contacts">Контакты и команды</RouterLink></p>
      <p class="profile-note">Поля хранятся зашифрованно на этом устройстве. Публичная карточка, глобальный @username, восьмизначный #UserID и серверная видимость ещё не подключены. Эти настройки не опубликованы.</p>
    </template>
  </section>
</template>
<style scoped>
.profile-page{width:100%;max-width:740px;margin:0 auto;padding:24px 16px 100px;text-align:center;color:#f4f4f4}
.profile-back{display:block;text-align:left;color:#b7d8c0;font-size:13px;text-decoration:none;margin-bottom:20px}
.profile-page h1{font-size:24px;text-align:left;margin-bottom:30px}
.profile-avatar{width:112px;height:112px;margin:0 auto 18px;display:grid;place-items:center;border-radius:50%;background:#354d3d;color:#d5ffdf;font-size:42px}
.profile-page h2{font-size:25px;margin:0 0 12px}.profile-identifier{display:flex;align-items:center;justify-content:center;gap:10px;flex-wrap:wrap;margin:7px 0}
.profile-identifier small{max-width:100%;overflow-wrap:anywhere;font-size:11px;color:#a8b5ab}
.profile-identifier button{border:0;background:none;color:#a8e9ba;font-size:11px;cursor:pointer}
.profile-note{font-size:12px;color:#aebcb0;line-height:1.7}
.profile-buttons{display:flex;gap:12px;justify-content:center;margin:28px 0}
.profile-buttons a{color:#e4f5e8;text-decoration:none;background:#293b2d;border:1px solid #526d58;border-radius:9px;padding:11px 15px;font-size:13px}
.profile-page h3{font-size:16px;text-align:left;margin:26px 0 10px}
.profile-page h3+p{text-align:left;font-size:13px;line-height:1.7}
.profile-teams{list-style:none;padding:0;text-align:left}.profile-teams li{display:flex;flex-direction:column;gap:5px;border-bottom:1px solid #3b443d;padding:12px 4px}.profile-teams small{color:#acb8ae;font-size:11px}.profile-page a{color:#a8deb6}
</style>
