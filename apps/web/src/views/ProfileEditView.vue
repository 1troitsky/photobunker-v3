<script setup lang="ts">
import { ref, watch } from 'vue'
import { RouterLink, useRouter } from 'vue-router'
import { activeSession } from '../features/identity/application/session'
import { blankProfile, readLocalProfile, saveLocalProfile, type Profile, type Visibility } from '../features/profile/application/local-profile'
const router=useRouter()
const draft=ref<Profile>(blankProfile())
const loading=ref(false)
const saving=ref(false)
const error=ref('')
const visibility:{value:Visibility;label:string}[]=[
  {value:'everyone',label:'Всем'},{value:'contacts',label:'Контактам'},
  {value:'team',label:'Контактам и участникам команд'},{value:'nobody',label:'Никому'},
]
let seq=0
watch(activeSession,async s=>{
  const id=++seq
  draft.value=blankProfile();error.value=''
  if(!s)return
  loading.value=true
  try{const current=await readLocalProfile();if(id===seq)draft.value=current}
  catch(e){if(id===seq)error.value=e instanceof Error?e.message:'Ошибка чтения'}
  finally{if(id===seq)loading.value=false}
},{immediate:true})
async function save():Promise<void>{
  if(!activeSession.value||saving.value)return
  saving.value=true;error.value=''
  try{
    await saveLocalProfile({
      ...draft.value,name:draft.value.name.trim(),about:draft.value.about.trim(),
    })
    await router.push('/settings/profile')
  }catch(e){error.value=e instanceof Error?e.message:'Ошибка сохранения'}
  finally{saving.value=false}
}
</script>
<template>
<section class="profile-edit" data-testid="profile-edit">
  <RouterLink to="/settings/profile">‹ Профиль</RouterLink>
  <h1>Настройки профиля</h1>
  <p v-if="!activeSession" role="status">Аккаунт закрыт. <RouterLink to="/settings">Открыть</RouterLink></p>
  <p v-else-if="loading" role="status">Расшифровка данных…</p>
  <form v-else @submit.prevent="save">
    <label>Имя <input v-model="draft.name" maxlength="64" autocomplete="off" placeholder="Имя" data-testid="profile-name"/></label>
    <label>@username <input v-model="draft.username" maxlength="15" autocomplete="off" pattern="[a-z0-9]([a-z0-9.-]{1,13}[a-z0-9])" placeholder="3–15 символов" data-testid="profile-username"/></label>
    <p class="hint">Псевдоним пока действует только локально. Глобальная регистрация имени недоступна.</p>
    <label>О себе <textarea v-model="draft.about" maxlength="600" rows="5" placeholder="Описание" data-testid="profile-about"></textarea></label>
    <label>Кому видна карточка<select v-model="draft.cardVisibility" data-testid="profile-card-visibility"><option v-for="v in visibility" :key="v.value" :value="v.value">{{ v.label }}</option></select></label>
    <label>Кому видны команды<select v-model="draft.teamsVisibility"><option v-for="v in visibility" :key="v.value" :value="v.value">{{ v.label }}</option></select></label>
    <label>Кому виден статус<select v-model="draft.presenceVisibility"><option v-for="v in visibility" :key="v.value" :value="v.value">{{ v.label }}</option></select></label>
    <p class="hint">Видимость сохранится как зашифрованное локальное предпочтение; серверные правила публичного профиля не изменяются.</p>
    <p v-if="error" role="alert" class="error">{{ error }}</p>
    <div class="actions"><RouterLink to="/settings/profile">Отмена</RouterLink><button type="submit" :disabled="saving||loading" data-testid="profile-save">Сохранить</button></div>
  </form>
</section>
</template>
<style scoped>
.profile-edit{width:100%;max-width:680px;margin:0 auto;padding:24px 16px 110px;color:#f4f4f4}
.profile-edit>a,.actions a{color:#b8e9c6;text-decoration:none;font-size:13px}.profile-edit h1{font-size:25px;margin:26px 0}
.profile-edit form{display:grid;gap:18px}.profile-edit label{display:grid;gap:8px;font-size:13px}
.profile-edit input,.profile-edit textarea,.profile-edit select{width:100%;min-height:44px;padding:11px;border:1px solid #505a51;background:#222722;color:#fff;border-radius:8px;font:inherit}
.profile-edit textarea{resize:vertical}.hint{color:#abb8ad;font-size:11px;line-height:1.6;margin:0}
.actions{display:flex;gap:14px;justify-content:flex-end;align-items:center;margin-top:20px}
.actions button{background:#367647;color:white;border:0;border-radius:8px;padding:12px 24px;cursor:pointer}
.actions button:disabled{opacity:.5}.error{color:#ffaaaa;font-size:12px}
</style>
