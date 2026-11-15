<script setup lang="ts">
import { computed, nextTick, onMounted, onUnmounted, ref, watch } from 'vue'
import { onBeforeRouteLeave, useRoute, useRouter } from 'vue-router'
import {
  defaultDock, dockChoices, dockDefinitions,
  previewDock, restoreDock, savedDock, validateDock,
} from '../ui/fieldwork/dock-preferences'
import type { DockId } from '../ui/fieldwork/dock-preferences'
import {
  launchChoices, savedLaunch,
} from '../ui/fieldwork/appearance-preferences'
import type { LaunchPage } from '../ui/fieldwork/appearance-preferences'
import {
  accentColors, previewVisual, restoreVisual, savedVisual, saveCompleteAppearance,
} from '../ui/fieldwork/visual-preferences'
import type { Theme, Accent, TextSize, Language, VisualPreferences } from '../ui/fieldwork/visual-preferences'

const router = useRouter()
const route = useRoute()
const dockSection = ref<HTMLElement | null>(null)
const launchSection = ref<HTMLElement | null>(null)
const themeSection = ref<HTMLElement | null>(null)
const accentSection = ref<HTMLElement | null>(null)
const sizeSection = ref<HTMLElement | null>(null)
const languageSection = ref<HTMLElement | null>(null)
type VisualDraft = {-readonly [K in keyof VisualPreferences]:VisualPreferences[K]}
const draftVisual = ref<VisualDraft>({...savedVisual.value})
const themeChoices: readonly {value:Theme;label:string}[] = [
 {value:'dark',label:'Тёмная'}, {value:'light',label:'Светлая'}, {value:'system',label:'Системная'},
]
const accentChoices: readonly {value:Accent;label:string}[] = [
 {value:'green',label:'Зелёный'}, {value:'gray',label:'Серый'},
 {value:'amber',label:'Янтарный'}, {value:'coral',label:'Коралловый'},
]
const sizeChoices: readonly {value:TextSize;label:string}[] = [
 {value:'small',label:'Мелкий'}, {value:'normal',label:'Обычный'}, {value:'large',label:'Крупный'},
]
const languageChoices: readonly {value:Language;label:string}[] = [
 {value:'ru',label:'Русский'}, {value:'en',label:'English'},
]
function changeVisual():void{
  notice.value='';error.value=''
  previewVisual(draftVisual.value)
}
async function focusRequestedField(): Promise<void> {
  const target = route.query.field === 'dock' ? dockSection
    : route.query.field === 'launch' ? launchSection
    : route.query.field === 'theme' ? themeSection
    : route.query.field === 'accent' ? accentSection
    : route.query.field === 'size' ? sizeSection
    : route.query.field === 'language' ? languageSection : null
  if (!target) return
  await nextTick()
  target.value?.scrollIntoView({block:'start'})
  target.value?.focus({preventScroll:true})
}
watch(() => route.query.field, () => { void focusRequestedField() })
const draft = ref<DockId[]>([...savedDock.value])
const draftLaunch = ref<LaunchPage>(savedLaunch.value)
const notice = ref('')
const error = ref('')
const dragging = ref<DockId | null>(null)
const dirty = computed(() =>
  JSON.stringify(draft.value) !== JSON.stringify(savedDock.value)
  || draftLaunch.value !== savedLaunch.value
  || JSON.stringify(draftVisual.value)!==JSON.stringify(savedVisual.value),
)
const otherChoices = computed(() => dockChoices.filter(item => !draft.value.includes(item.id)))
const chosen = computed(() => draft.value.map(id => dockDefinitions[id]))

function update(next: DockId[]): void {
  if (!validateDock(next)) return
  draft.value = next
  notice.value = ''
  error.value = ''
  previewDock(next) // Live preview is the actual shared app Dock, not a fake widget.
}

function move(id: DockId, direction: -1 | 1): void {
  const index = draft.value.indexOf(id), nextIndex = index + direction
  if (index < 0 || nextIndex < 0 || nextIndex >= draft.value.length) return
  const next = [...draft.value]
  ;[next[index],next[nextIndex]] = [next[nextIndex]!,next[index]!]
  update(next)
}

function remove(id: DockId): void {
  if (id === 'settings' || draft.value.length <= 3) return
  update(draft.value.filter(item => item !== id))
}
function add(id: DockId): void {
  if (dockDefinitions[id].to === null
    || draft.value.includes(id) || draft.value.length >= 6) return
  update([...draft.value,id])
}
function resetToDefault(): void { update([...defaultDock]) }

function onDragStart(event: DragEvent, id: DockId): void {
  dragging.value=id
  if (event.dataTransfer) {
    event.dataTransfer.effectAllowed='move'
    event.dataTransfer.setData('text/plain',id)
  }
}
function onDrop(event: DragEvent, target: DockId): void {
  event.preventDefault()
  const origin=dragging.value
  dragging.value=null
  if (!origin || origin===target) return
  const from=draft.value.indexOf(origin), to=draft.value.indexOf(target)
  if (from < 0 || to < 0) return
  const next=[...draft.value]
  next.splice(from,1)
  next.splice(to,0,origin)
  update(next)
}
function cancel(): void {
  draft.value=[...savedDock.value]
  draftLaunch.value=savedLaunch.value
  draftVisual.value={...savedVisual.value}
  restoreDock()
  restoreVisual()
  void router.push('/settings')
}
function save(): void {
  if (!dirty.value) return
  if (!saveCompleteAppearance(draft.value,draftLaunch.value,draftVisual.value)) {
    error.value='Не удалось сохранить оформление на этом устройстве. Настройки не изменены.'
    return
  }
  notice.value='Сохранено на этом устройстве.'
  error.value=''
}
function updateLaunch(): void {
  notice.value=''
  error.value=''
}
onMounted(() => { previewDock(draft.value); previewVisual(draftVisual.value); void focusRequestedField() })
onUnmounted(() => { restoreDock(); restoreVisual() })
onBeforeRouteLeave(() => {
  if (!dirty.value) return true
  return window.confirm('Изменения оформления не сохранены. Выйти без сохранения?')
})
</script>

<template>
  <section class="appearance-page" data-testid="appearance-page">
    <header class="appearance-heading">
      <h1>Оформление</h1>
      <p>Внешний вид и поведение интерфейса</p>
    </header>

    <div class="appearance-body">
      <section id="setting-field-theme" ref="themeSection" tabindex="-1"
        class="appearance-section" aria-labelledby="theme-title" data-testid="appearance-theme-field">
        <h2 id="theme-title">Тема</h2>
        <div class="option-panel">
          <div class="theme-grid" role="group" aria-label="Тема">
            <button v-for="option in themeChoices" :key="option.value" type="button"
              class="theme-card" :aria-pressed="draftVisual.theme===option.value"
              :data-testid="'appearance-theme-'+option.value"
              @click="draftVisual.theme=option.value;changeVisual()">
              <span class="theme-mini" :class="option.value" aria-hidden="true">
                <span class="mini-bar"></span><span class="mini-line"></span>
                <span class="mini-line short"></span><span class="mini-hl"></span>
              </span>
              <span class="theme-label"><span>{{ option.label }}</span>
                <span v-if="draftVisual.theme===option.value" class="picked" aria-hidden="true">✓</span>
              </span>
            </button>
          </div>
          <p class="option-help">Системная тема следует настройкам устройства.</p>
        </div>
      </section>
      <section id="setting-field-accent" ref="accentSection" tabindex="-1"
        class="appearance-section" aria-labelledby="accent-title" data-testid="appearance-accent-field">
        <h2 id="accent-title">Основной цвет</h2>
        <div class="option-panel">
          <div class="color-grid" role="group" aria-label="Основной цвет">
            <button v-for="option in accentChoices" :key="option.value" type="button"
              class="color-button" :aria-pressed="draftVisual.accent===option.value"
              :data-testid="'appearance-accent-'+option.value"
              @click="draftVisual.accent=option.value;changeVisual()">
              <span class="color-swatch" :style="{background:accentColors[option.value]}" aria-hidden="true">
                <svg v-if="draftVisual.accent===option.value" viewBox="0 0 24 24"
                  fill="none" stroke="currentColor" stroke-width="2.5">
                  <path d="m4 12 5 5L20 6"/>
                </svg>
              </span>
              <span>{{option.label}}</span>
            </button>
          </div>
          <p class="option-help">Меняется только цветовой акцент интерфейса.</p>
        </div>
      </section>
      <section id="setting-field-size" ref="sizeSection" tabindex="-1"
        class="appearance-section" aria-labelledby="size-title" data-testid="appearance-size-field">
        <h2 id="size-title">Размер текста</h2>
        <div class="option-panel">
          <div class="segment" role="group" aria-label="Размер текста">
            <button v-for="option in sizeChoices" :key="option.value" type="button"
              class="seg-button" :aria-pressed="draftVisual.size===option.value"
              :data-testid="'appearance-size-'+option.value"
              @click="draftVisual.size=option.value;changeVisual()">{{option.label}}</button>
          </div>
          <div class="example-text">Это пример текста в выбранном размере.</div>
        </div>
      </section>
      <section id="setting-field-language" ref="languageSection" tabindex="-1"
        class="appearance-section" aria-labelledby="language-title" data-testid="appearance-language-field">
        <h2 id="language-title">Язык</h2>
        <div class="option-list" role="group" aria-label="Язык">
          <button v-for="option in languageChoices" :key="option.value" type="button"
            class="option-row" :aria-pressed="draftVisual.language===option.value"
            :data-testid="'appearance-language-'+option.value"
            @click="draftVisual.language=option.value;changeVisual()">
            <span class="option-icon" aria-hidden="true">◎</span>
            <span class="option-copy"><strong>{{option.label}}</strong>
              <small>{{option.value==='ru'?'RU':'EN'}}</small>
            </span>
            <span v-if="draftVisual.language===option.value" class="option-mark" aria-hidden="true">✓</span>
          </button>
        </div>
        <p class="option-help">Настройка языка интерфейса на устройстве. Полный перевод всех экранов ещё не завершён.</p>
      </section>
      <section id="setting-field-launch" ref="launchSection" tabindex="-1"
        class="appearance-section" aria-labelledby="launch-title" data-testid="appearance-launch-field">
        <h2 id="launch-title">Стартовая страница</h2>
        <div class="appearance-panel">
          <p class="launch-hint">Какой раздел открывать при запуске PhotoBunker. Прямые ссылки на файлы и задания сохраняются.</p>
          <div class="launch-options" role="radiogroup" aria-label="Стартовая страница">
            <label v-for="option in launchChoices" :key="option.id" class="launch-option"
              :class="{chosen:draftLaunch===option.id}">
              <input v-model="draftLaunch" type="radio" name="launch-page"
                :value="option.id" :data-testid="'launch-page-'+option.id"
                @change="updateLaunch">
              <span class="launch-option-content">
                <strong>{{ option.label }}</strong>
                <small>{{ option.description }}</small>
              </span>
            </label>
          </div>
        </div>
      </section>

      <section id="setting-field-dock" ref="dockSection" tabindex="-1"
        class="appearance-section" aria-labelledby="dock-title" data-testid="appearance-dock-field">
        <div class="dock-heading">
          <div>
            <h2 id="dock-title">Настройка нижней панели</h2>
            <p>Выбери разделы и их порядок. Профиль и настройки всегда остаются в панели.</p>
          </div>
          <span class="dock-count" data-testid="dock-count">{{ draft.length }} / 6</span>
        </div>

        <div class="appearance-panel">
          <h3>В панели</h3>
          <div class="dock-list">
            <div v-for="(entry,index) in chosen" :key="entry.id"
              class="dock-line" :data-testid="'dock-row-'+entry.id"
              draggable="true" @dragstart="onDragStart($event,entry.id)"
              @dragover.prevent @drop="onDrop($event,entry.id)"
              @dragend="dragging=null">
              <span class="dock-grip" title="Переместить строку" aria-hidden="true">⋮⋮</span>
              <span class="dock-label">{{ entry.name }}</span>
              <span v-if="entry.id==='settings'" class="required-label">Обязательно</span>
              <div class="dock-actions">
                <button type="button" :disabled="index===0"
                  :data-testid="'dock-up-'+entry.id"
                  :aria-label="'Поднять: '+entry.name"
                  @click="move(entry.id,-1)">↑</button>
                <button type="button" :disabled="index===draft.length-1"
                  :data-testid="'dock-down-'+entry.id"
                  :aria-label="'Опустить: '+entry.name"
                  @click="move(entry.id,1)">↓</button>
                <button v-if="entry.id!=='settings'" type="button"
                  :disabled="draft.length<=3"
                  :data-testid="'dock-remove-'+entry.id"
                  :aria-label="'Убрать: '+entry.name"
                  @click="remove(entry.id)">×</button>
              </div>
            </div>
          </div>

          <h3 class="available-heading">Добавить раздел</h3>
          <div class="available-list">
            <button v-for="entry in otherChoices" :key="entry.id" type="button"
              class="dock-add" :disabled="entry.to===null||draft.length>=6"
              :data-testid="'dock-add-'+entry.id"
              @click="add(entry.id)">
              <span>{{ entry.name }}<small v-if="entry.to===null">Ещё не подключено</small></span>
              <span class="dock-plus" aria-hidden="true">{{ entry.to===null ? '—' : '+' }}</span>
            </button>
            <p v-if="otherChoices.length===0" class="empty-state">Все доступные разделы добавлены.</p>
          </div>

          <div class="appearance-meta">
            <button type="button" class="reset-action" @click="resetToDefault">
              Вернуть стандартный порядок
            </button>
            <span>От 3 до 6 разделов</span>
          </div>
        </div>
      </section>

    </div>

    <div class="appearance-actions">
      <button type="button" class="cancel" @click="cancel">Отмена</button>
      <button type="button" class="save" :disabled="!dirty" @click="save">Сохранить</button>
    </div>
    <p v-if="notice" role="status" class="save-notice">{{ notice }}</p>
    <p v-if="error" role="alert" class="save-error">{{ error }}</p>
    <p class="storage-notice">Dock, стартовая страница и оформление сохраняются одним действием на этом устройстве. Перенос между устройствами пока не подключён.</p>
  </section>
</template>

<style scoped>
.appearance-page{max-width:780px;margin:0 auto;padding:26px 16px 46px;min-height:100%;display:flex;flex-direction:column;gap:0}
.appearance-heading h1{font-size:28px;font-weight:800;letter-spacing:-.045em;margin:0}
.appearance-heading p{color:#a4ada6;font-size:12px;margin:6px 0 0}
.appearance-body{margin-top:34px;display:grid;gap:22px}
.appearance-section h2{font-size:15px;font-weight:720;margin:0 0 8px}
#setting-field-dock,#setting-field-launch,#setting-field-theme,#setting-field-accent,#setting-field-size,#setting-field-language{scroll-margin-top:16px}
#setting-field-dock:focus,#setting-field-launch:focus,#setting-field-theme:focus,#setting-field-accent:focus,#setting-field-size:focus,#setting-field-language:focus{outline:none}
#setting-field-dock:focus-visible,#setting-field-launch:focus-visible,#setting-field-theme:focus-visible,#setting-field-accent:focus-visible,#setting-field-size:focus-visible,#setting-field-language:focus-visible{outline:2px solid var(--accent);outline-offset:3px}
.visual-options{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:9px}
.visual-options.accents{grid-template-columns:repeat(4,minmax(0,1fr))}
.visual-choice{display:flex;justify-content:center;align-items:center;gap:8px;padding:12px 9px;border:1px solid #494e49;border-radius:8px;background:#2a2a2a;color:#e9e9e9;font-size:12px;cursor:pointer;min-height:46px}
.visual-choice[aria-pressed="true"]{border-color:var(--accent);background:#273b2e}
.visual-choice:focus-visible{outline:2px solid var(--accent)}
.visual-hint{font-size:11px;color:#adb5ae;margin:11px 0 0}
.color-mark{display:block;width:18px;height:18px;flex:none;border:1px solid #ffffff54;border-radius:50%}
@media(max-width:560px){.visual-options.accents{grid-template-columns:repeat(2,minmax(0,1fr))}}
.launch-hint{font-size:12px;line-height:1.55;color:#aeb5ae;margin:0 0 12px}
.launch-options{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:8px}
.launch-option{display:flex;align-items:center;gap:9px;padding:13px 11px;
  border:1px solid #404940;border-radius:8px;cursor:pointer;background:#282b28;min-height:72px}
.launch-option.chosen{border-color:#1ed760;background:#293a2d}
.launch-option input{width:17px;height:17px;flex:0 0 17px;accent-color:#1ed760}
.launch-option-content{display:flex;flex:1;flex-direction:column;gap:3px;min-width:0}
.launch-option-content strong{font-size:13px}
.launch-option-content small{font-size:11px;color:#aab4ab;line-height:1.4}
@media(max-width:600px){.launch-options{grid-template-columns:1fr}}
.dock-heading{display:flex;justify-content:space-between;align-items:center;gap:12px;margin-bottom:11px}
.dock-heading h2{margin:0 0 4px}.dock-heading p{font-size:12px;color:#9da9a0;margin:0;max-width:520px}
.dock-count{flex-shrink:0;font-size:12px;padding:7px 10px;color:#e9f5ec;background:#304036;border-radius:8px;font-weight:730}
.appearance-panel{background:#202020;border:1px solid #303030;padding:15px;border-radius:10px}
.appearance-panel h3{font-size:12px;color:#afb8b0;margin:0 0 9px;font-weight:650}
.dock-list{display:grid;gap:7px}
.dock-line{display:flex;align-items:center;gap:8px;min-height:49px;padding:6px 9px;background:#292c29;border:1px solid #3c443e;border-radius:8px}
.dock-line:focus-within{border-color:#67ae77}
.dock-grip{font-size:20px;letter-spacing:-3px;color:#849188;user-select:none;cursor:grab;padding:0 8px 0 1px}
.dock-label{font-size:13px;font-weight:650;flex:1;min-width:0}
.required-label{font-size:10px;color:#acc9b3}
.dock-actions{display:flex;gap:3px;flex-shrink:0}
.dock-actions button{width:30px;height:31px;background:transparent;border:0;border-radius:5px;color:#c6d1c9;font-size:16px;cursor:pointer}
.dock-actions button:hover:not(:disabled){background:#3b443d}
.dock-actions button:disabled{opacity:.28;cursor:not-allowed}
.available-heading{margin-top:20px!important}
.available-list{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:7px}
.dock-add{display:flex;gap:12px;align-items:center;justify-content:space-between;text-align:left;padding:9px 11px;min-height:43px;border:1px solid #444b46;border-radius:8px;background:#292c29;color:#eee;font:inherit;font-weight:600;font-size:12px;cursor:pointer}
.dock-add:hover:not(:disabled){background:#34463a}
.dock-add:disabled{opacity:.58;cursor:not-allowed}
.dock-add span:first-child{min-width:0;overflow-wrap:anywhere}
.dock-add small{display:block;font-weight:400;font-size:10px;color:#a6b0a9;margin-top:2px}
.dock-plus{margin-left:auto;flex-shrink:0;font-size:18px;color:#b2cfb8}
.empty-state{color:#aeb8b1;font-size:12px}
.appearance-meta{display:flex;gap:10px;flex-wrap:wrap;align-items:center;justify-content:space-between;margin-top:14px;color:#9da9a0;font-size:11px}
.reset-action{background:transparent;border:1px solid #505850;padding:7px 10px;border-radius:7px;color:#c7d1c9;cursor:pointer;font-size:11px}
.pending-appearance{color:#aab4ac;font-size:12px;line-height:1.7}
.pending-appearance p{margin:0}
.appearance-actions{position:sticky;bottom:0;z-index:4;display:flex;gap:9px;padding:12px 0;margin-top:22px;background:linear-gradient(180deg,transparent,#121212 24%)}
.appearance-actions button{flex:1;padding:12px 15px;border-radius:9px;border:1px solid #555;min-height:44px;background:#303030;color:#fff;cursor:pointer;font-size:13px;font-weight:700}
.appearance-actions button.save{background:#1ed760;color:#111d14;border-color:#1ed760}
.appearance-actions button:disabled{opacity:.42;cursor:not-allowed}
.save-notice{font-size:12px;color:#91edac;margin:8px 0}
.save-error{font-size:12px;color:#ff9e9e;margin:8px 0}
.storage-notice{font-size:11px;color:#a1aba3;line-height:1.5;margin:10px 0 0}
.appearance-page button:focus-visible{outline:2px solid #a6f3b9;outline-offset:2px}
@media(max-width:470px){.appearance-page{padding:20px 12px 38px}.available-list{grid-template-columns:1fr}.dock-line{gap:5px}.required-label{font-size:9px}.dock-actions button{width:27px}.appearance-panel{padding:11px}.dock-grip{padding-right:3px}}
@media(prefers-reduced-motion:reduce){.appearance-page *{scroll-behavior:auto!important}}

/* Identical option geometry and selection classes from owner-accepted docs/ux/app-appearance/style.css. */
.option-help{font-size:.84em;color:var(--muted);line-height:1.45;margin:10px 2px 0}
.theme-grid{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:8px}
.theme-card{display:block;text-align:left;min-width:0;padding:8px;background:var(--soft-bg);border:1px solid transparent;border-radius:8px;color:var(--text);transition:background .13s,border-color .13s}
.theme-card[aria-pressed="true"],.color-button[aria-pressed="true"],.seg-button[aria-pressed="true"]{border-color:var(--ui-accent);background:color-mix(in srgb,var(--ui-accent) 11%,var(--soft-bg))}
.theme-card:hover,.color-button:hover,.seg-button:hover{border-color:var(--muted)}
.theme-mini{position:relative;display:block;height:53px;border-radius:5px;overflow:hidden;border:1px solid #5b5b5b;margin-bottom:8px}
.theme-mini .mini-bar{height:12px;background:#292929;border-bottom:1px solid #555}
.theme-mini .mini-line{height:5px;margin:6px 7px 0;width:57%;background:#737373;border-radius:2px}
.theme-mini .mini-line.short{width:33%;margin-top:5px}
.theme-mini .mini-hl{position:absolute;bottom:6px;right:7px;width:24px;height:7px;background:#1ed760;border-radius:2px}
.theme-mini.dark{background:#171717;border-color:#525252}
.theme-mini.light{background:#f5f5f5;border-color:#bdbdbd}
.theme-mini.light .mini-bar{background:#e5e5e5;border-bottom-color:#cecece}
.theme-mini.light .mini-line{background:#a4a4a4}
.theme-mini.system{background:linear-gradient(90deg,#171717 0 50%,#f5f5f5 50% 100%);border-color:#777}
.theme-mini.system .mini-bar{background:linear-gradient(90deg,#292929 0 50%,#e5e5e5 50% 100%)}
.theme-label{display:flex;gap:4px;align-items:center;justify-content:space-between;font-size:.88em;font-weight:650;min-width:0}
.theme-label span:first-child{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.picked{color:var(--ui-accent);display:inline-flex;align-items:center}
.picked svg{width:14px;height:14px}
.color-grid{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:8px}
.color-button{display:flex;flex-direction:column;align-items:center;gap:8px;min-height:68px;padding:8px 4px 7px;border:1px solid transparent;border-radius:8px;background:var(--soft-bg);font-size:.8em;color:var(--text);white-space:nowrap}
.color-swatch{display:flex;align-items:center;justify-content:center;width:29px;height:29px;border-radius:6px;border:1px solid #ffffff27}
.color-swatch svg{width:15px;height:15px;color:#101010;stroke-width:2.8}
.segment{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:7px}
.seg-button{border:1px solid transparent;border-radius:7px;min-height:39px;padding:7px 4px;background:var(--soft-bg);font-size:.88em;font-weight:630;color:var(--text)}
.example-text{margin:13px 0 0;padding:10px 11px;border:1px solid var(--line);border-radius:7px;line-height:1.5;font-size:calc(.95em * var(--text-scale));color:var(--text)}
.option-list{background:var(--surface);border-radius:9px;overflow:hidden}
.option-row{display:flex;align-items:center;width:100%;text-align:left;gap:11px;min-height:56px;padding:9px 13px;background:none;border:0;border-bottom:1px solid var(--line);color:var(--text)}
.option-row:last-child{border:0}.option-row:hover{background:var(--soft-bg)}
.option-icon{width:29px;height:29px;display:grid;place-items:center;flex:none;color:var(--muted)}
.option-icon svg{width:19px;height:19px}
.option-copy{min-width:0;flex:1;display:flex;flex-direction:column;gap:1px}
.option-copy strong{font-size:.97em;font-weight:650;line-height:1.25}
.option-copy small{font-size:.81em;color:var(--muted);line-height:1.35}
.option-mark{width:20px;height:20px;flex:none;display:grid;place-items:center;color:var(--ui-accent)}
.option-mark svg{width:19px;height:19px}
.appearance-page{--ui-accent:var(--accent);--text-scale:var(--ui-text-scale);--line:#373737;--soft-bg:#292929;--text:#f3f3f3;--muted:#aaa;--raised:#333;--ui-accent-ink:#102719}
.appearance-page .theme-card,.appearance-page .color-button,.appearance-page .seg-button,.appearance-page .option-row{cursor:pointer}
.appearance-page .theme-card:focus-visible,.appearance-page .color-button:focus-visible,.appearance-page .seg-button:focus-visible,.appearance-page .option-row:focus-visible{outline:2px solid var(--accent);outline-offset:2px}
:global(:root[data-ui-scheme="light"]) .appearance-page{--soft-bg:#ededed;--text:#262d27;--muted:#68746a;--line:#cbd4cc}
:global(:root[data-ui-scheme="light"]) .appearance-page .option-panel,:global(:root[data-ui-scheme="light"]) .appearance-page .option-list{background:#fff}
</style>
