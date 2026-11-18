<script setup lang="ts">
import {ref,watch} from 'vue'
import {RouterLink,useRouter,onBeforeRouteLeave} from 'vue-router'
import {activeSession} from '../features/identity/application/session'
import {queueAssignmentCreation} from '../features/assignments/application/assignment-outbox'
const router=useRouter()
const tab=ref<'main'|'files'>('main')
const title=ref(''),instructions=ref(''),photoInstructions=ref(''),goal=ref('')
const video=ref(false),audio=ref(false),videoGoal=ref(''),audioGoal=ref('')
const videoInstructions=ref(''),audioInstructions=ref('')
const busy=ref(false),error=ref(''),saved=ref(false)
watch(()=>activeSession.value?.accountId,()=>{
  title.value='';instructions.value='';photoInstructions.value='';goal.value=''
  video.value=false;audio.value=false;videoGoal.value='';audioGoal.value=''
  videoInstructions.value='';audioInstructions.value='';error.value='';saved.value=false
})
onBeforeRouteLeave(()=>saved.value||(!title.value&&!instructions.value&&!photoInstructions.value&&!goal.value&&!video.value&&!audio.value&&!videoInstructions.value&&!audioInstructions.value)
  ||window.confirm('Отменить несохранённое задание?'))
async function create():Promise<void>{
  if(busy.value)return
  error.value=''
  if(!title.value.trim()){tab.value='main';error.value='Введите название задания';return}
  const photoGoal=goal.value===''?null:Number(goal.value)
  if(photoGoal!==null&&(!Number.isInteger(photoGoal)||photoGoal<1||photoGoal>9999)){
    tab.value='files';error.value='Цель для фото — от 1 до 9999';return
  }
  for(const [enabled,value] of [[video.value,videoGoal.value],[audio.value,audioGoal.value]] as const){
    if(enabled&&value!==''&&(!Number.isInteger(Number(value))||Number(value)<1||Number(value)>999)){
      tab.value='files';error.value='Цель для видео и аудио — от 1 до 999';return
    }
  }
  busy.value=true
  try{
    const id=await queueAssignmentCreation({title:title.value,instructions:instructions.value,
      photoInstructions:photoInstructions.value,videoInstructions:videoInstructions.value,
      audioInstructions:audioInstructions.value,photoGoal,
      ...(video.value||audio.value?{mixedCreation:{
        allowedMedia:['photo',...(video.value?['video' as const]:[]),...(audio.value?['audio' as const]:[])],
        videoGoal:video.value&&videoGoal.value!==''?Number(videoGoal.value):null,
        audioGoal:audio.value&&audioGoal.value!==''?Number(audioGoal.value):null,
      }}:{})})
    saved.value=true
    await router.push({path:'/assignments',query:{created:id}})
  }catch(e){error.value=e instanceof Error?e.message:'Не удалось сохранить задание. Повторите попытку.'}
  finally{busy.value=false}
}
</script>

<!-- Markup copied from docs/ux/assignments/editor/index.html, Media 2.2.
     Photo MVP uses its General Data and photo controls; no demo data/actions. -->
<template>
<section class="assignment-create content-inner" data-testid="assignment-create">
  <RouterLink to="/assignments" class="text-link">‹ Назад к заданиям</RouterLink>
  <div class="editor-heading"><h1>Новое задание</h1><span id="draft-state">Черновик</span></div>
  <p v-if="!activeSession" role="status">Для создания задания <RouterLink to="/welcome">войдите в аккаунт</RouterLink>.</p>
  <form v-else novalidate @submit.prevent="create">
    <nav class="editor-tabs" aria-label="Разделы нового задания">
      <button type="button" :class="{selected:tab==='main'}" :aria-pressed="tab==='main'" @click="tab='main'">Основное</button>
      <button type="button" :class="{selected:tab==='files'}" :aria-pressed="tab==='files'" @click="tab='files'">Файлы</button>
    </nav>
    <fieldset :disabled="busy">
      <section v-show="tab==='main'" class="tab-pane">
<div class="form-section"><h2>Общие данные</h2>
<label class="field">Название задания<input id="assignment-title" name="name" v-model="title" maxlength="80" required></label>
<label class="field">Описание и инструкции<textarea id="assignment-instructions" name="instructions" v-model="instructions" maxlength="4000" rows="4"></textarea></label>
</div>

      </section>
      <section v-show="tab==='files'" class="tab-pane"><div class="form-section"><h2>Разрешённые типы файлов</h2>
<div class="media-type" data-type="photo"><label class="rule-row"><span class="type-heading"><span class="type-icon"><svg viewBox="0 0 24 24"><path d="M3 7h4l2-3h6l2 3h4v13H3z"/><circle cx="12" cy="13" r="3.2"/></svg></span><span><strong>Фото</strong><small>Фотографии и изображения</small></span></span><input class="switch media-enable" type="checkbox" name="allowPhoto" aria-label="Разрешить фото" checked disabled></label><div class="media-config"><div class="target-line"><div><strong style="font-size:12px">Нужно фотографий</strong><p class="hint">Только для прогресса</p></div><label class="field"><span class="visually-hidden" style="position:absolute;clip-path:inset(50%);width:1px;height:1px;overflow:hidden">Количество фото</span><input type="number" id="assignment-goal" name="photoCount" v-model="goal" min="1" max="9999" placeholder="Без цели"></label></div><label class="field">Инструкции для фото <span class="optional">(необязательно)</span><textarea name="photoShots" v-model="photoInstructions" maxlength="2000" rows="4"></textarea></label></div></div>

<div class="media-type" data-type="video" :class="{off:!video}"><label class="rule-row"><span class="type-heading"><span class="type-icon"><svg viewBox="0 0 24 24"><rect x="3" y="5" width="14" height="14" rx="2"/><path d="m17 10 4-3v10l-4-3"/></svg></span><span><strong>Видео</strong><small>Видеозаписи объекта</small></span></span><input class="switch media-enable" type="checkbox" id="assignment-create-video" name="allowVideo" v-model="video" aria-label="Разрешить видео"></label><div class="media-config"><div class="target-line"><div><strong style="font-size:12px">Нужно видео</strong><p class="hint">Только для прогресса</p></div><label class="field"><span class="visually-hidden" style="position:absolute;clip-path:inset(50%);width:1px;height:1px;overflow:hidden">Количество видео</span><input type="number" id="assignment-create-video-goal" name="videoCount" v-model="videoGoal" min="1" max="999" placeholder="Без цели"></label></div><label class="field">Инструкции для видео <span class="optional">(необязательно)</span><textarea name="videoShots" v-model="videoInstructions" maxlength="2000" rows="3"></textarea></label></div></div>
<div class="media-type" data-type="audio" :class="{off:!audio}"><label class="rule-row"><span class="type-heading"><span class="type-icon"><svg viewBox="0 0 24 24"><path d="M9 18V5l11-2v12M9 9l11-2"/><circle cx="6" cy="18" r="3"/><circle cx="17" cy="15" r="3"/></svg></span><span><strong>Аудио</strong><small>Голос и звуковые записи</small></span></span><input class="switch media-enable" type="checkbox" id="assignment-create-audio" name="allowAudio" v-model="audio" aria-label="Разрешить аудио"></label><div class="media-config"><div class="target-line"><div><strong style="font-size:12px">Нужно аудио</strong><p class="hint">Только для прогресса</p></div><label class="field"><span class="visually-hidden" style="position:absolute;clip-path:inset(50%);width:1px;height:1px;overflow:hidden">Количество аудио</span><input type="number" id="assignment-create-audio-goal" name="audioCount" v-model="audioGoal" min="1" max="999" placeholder="Без цели"></label></div><label class="field">Инструкции для аудио <span class="optional">(необязательно)</span><textarea name="audioShots" v-model="audioInstructions" maxlength="2000" rows="3"></textarea></label></div></div></div>
      </section>
    </fieldset>
    <p class="hint">После сохранения откройте редактор задания для настройки участников, сроков и правил.</p>
    <p v-if="error" role="alert">{{error}}</p>
    <div class="editor-footer"><RouterLink to="/assignments" class="secondary">Отмена</RouterLink><button class="primary-save" type="submit" :disabled="busy">{{busy?'Сохранение…':'Создать зашифрованное задание'}}</button></div>
  </form>
</section>
</template>
<style scoped src="../features/assignments/ui/AssignmentCreateFieldwork.css"></style>
