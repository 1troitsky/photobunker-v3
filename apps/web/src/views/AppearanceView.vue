<script setup lang="ts">
import {computed,onUnmounted,ref,watch} from 'vue'
import {activeSession} from '../features/identity/application/session'
import {
  DOCK_CATALOG,DEFAULT_DOCK,appliedDock,dockLoadError,
  previewDock,saveDock,validateDock,
} from '../features/appearance/application/dock-preferences'
import type {DockId} from '../features/appearance/application/dock-preferences'

const draft=ref<DockId[]>([...appliedDock.value])
const touched=ref(false)
const busy=ref(false)
const error=ref('')
const status=ref('')
let dragging=-1
const dirty=computed(()=>JSON.stringify(draft.value)!==JSON.stringify(appliedDock.value))
const selectedRows=computed(()=>draft.value.map(id=>DOCK_CATALOG.find(x=>x.id===id)!))
const availableRows=computed(()=>DOCK_CATALOG.filter(x=>!draft.value.includes(x.id)))

watch(appliedDock,items=>{
  // Do not overwrite a user's unsaved order with an asynchronous read.
  if(!touched.value)draft.value=[...items]
})
watch(draft,items=>{previewDock.value=[...items]}, {deep:true,immediate:true})
watch(()=>{const s=activeSession.value
  return s?[s.accountId,s.deviceId,s.pkg.revision,s.pkg.akek].join('|'):''
},()=>{
  touched.value=false
  draft.value=[...DEFAULT_DOCK]
  previewDock.value=null
  error.value='';status.value=''
})
onUnmounted(()=>{previewDock.value=null})

function change(items:DockId[]):void{
  error.value='';status.value=''
  draft.value=validateDock(items)
  touched.value=true
}
function add(id:DockId):void{
  if(draft.value.includes(id)||draft.value.length>=6)return
  const entry=DOCK_CATALOG.find(x=>x.id===id)
  if(!entry?.available)return
  change([...draft.value,id])
}
function remove(id:DockId):void{
  if(id==='settings'||draft.value.length<=3)return
  change(draft.value.filter(x=>x!==id))
}
function move(index:number,direction:-1|1):void{
  const dest=index+direction
  if(dest<0||dest>=draft.value.length)return
  const updated=[...draft.value]
  const [current]=updated.splice(index,1)
  updated.splice(dest,0,current!)
  change(updated)
}
function drop(index:number):void{
  if(dragging<0||dragging===index)return
  const updated=[...draft.value]
  const [current]=updated.splice(dragging,1)
  updated.splice(index,0,current!)
  dragging=-1
  change(updated)
}
function cancel():void{
  touched.value=false
  draft.value=[...appliedDock.value]
  previewDock.value=null
  error.value=''
  status.value='Изменения отменены'
}
function reset():void{
  change([...DEFAULT_DOCK])
}
async function save():Promise<void>{
  if(!activeSession.value||busy.value||!dirty.value)return
  busy.value=true;error.value='';status.value=''
  try{
    await saveDock(draft.value)
    touched.value=false
    previewDock.value=null
    status.value='Настройки Dock зашифрованы и сохранены на этом устройстве'
  }catch(e){
    error.value=e instanceof Error?e.message:'appearance.save_failed'
  }finally{busy.value=false}
}
</script>

<template>
  <section class="appearance-page" data-testid="appearance-page">
    <div class="appearance-content">
      <header class="appearance-heading">
        <RouterLink to="/settings" aria-label="Назад к настройкам">← Настройки</RouterLink>
        <h1>Оформление</h1>
        <p>Внешний вид и поведение интерфейса</p>
      </header>
      <div class="appearance-panel">
        <h2>Панель навигации Dock</h2>
        <p class="appearance-secondary">Выберите 3–6 разделов и их порядок.
          «Настройки» обязательны. Изменения видны в Dock сразу и
          сохраняются только после нажатия «Сохранить».</p>
        <h3>Выбранные разделы ({{ draft.length }}/6)</h3>
        <ol class="appearance-selected" data-testid="dock-selected">
          <li v-for="(item,index) in selectedRows" :key="item.id"
            :data-testid="'dock-selected-'+item.id"
            :draggable="true" @dragstart="dragging=index"
            @dragend="dragging=-1" @dragover.prevent @drop.prevent="drop(index)">
            <span class="appearance-handle" aria-hidden="true">⠿</span>
            <span class="appearance-name">{{ item.label }}</span>
            <span v-if="item.id==='settings'" class="appearance-mandatory">Обязательно</span>
            <div class="appearance-order">
              <button type="button" :disabled="index===0"
                :aria-label="'Переместить '+item.label+' вверх'"
                @click="move(index,-1)">↑</button>
              <button type="button" :disabled="index===draft.length-1"
                :aria-label="'Переместить '+item.label+' вниз'"
                @click="move(index,1)">↓</button>
              <button v-if="item.id!=='settings'" type="button"
                :disabled="draft.length<=3"
                :aria-label="'Убрать '+item.label"
                @click="remove(item.id)">×</button>
            </div>
          </li>
        </ol>
        <h3>Добавить раздел</h3>
        <ul class="appearance-available" data-testid="dock-available">
          <li v-for="item in availableRows" :key="item.id">
            <span>{{ item.label }}
              <small v-if="!item.available">Будет доступно после реализации уведомлений</small>
            </span>
            <button type="button" :disabled="!item.available||draft.length>=6"
              :title="!item.available?'Раздел ещё недоступен'
                :draft.length>=6?'Максимум 6 разделов':'Добавить'"
              :aria-label="'Добавить '+item.label"
              @click="add(item.id)">+</button>
          </li>
        </ul>
        <p v-if="draft.length>=6" class="appearance-secondary" role="status">
          Достигнут предел: 6 разделов. Уберите один пункт, чтобы добавить другой.
        </p>
        <button type="button" class="appearance-reset" @click="reset">
          Сбросить Dock по умолчанию
        </button>
      </div>
      <p class="appearance-secondary">Тема, цвет, размер текста, язык и стартовая
        страница будут подключены отдельными проверенными сценариями P2.</p>
      <p v-if="!activeSession" class="appearance-error" role="alert">
        Для сохранения настроек войдите в аккаунт. До входа доступен только предпросмотр.
      </p>
      <p v-if="dockLoadError" class="appearance-error" role="alert">{{ dockLoadError }}</p>
      <p v-if="error" class="appearance-error" role="alert">{{ error }}</p>
      <p v-if="status" class="appearance-success" role="status">{{ status }}</p>
    </div>
    <footer class="appearance-footer" data-testid="appearance-actions">
      <button type="button" @click="cancel">Отмена</button>
      <button type="button" class="appearance-save"
        :disabled="!activeSession||busy||!dirty" @click="save">
        {{ busy?'Сохранение…':'Сохранить' }}
      </button>
    </footer>
  </section>
</template>
