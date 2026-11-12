<script setup lang="ts">
import { computed, ref } from 'vue'
import { brand } from '../../../config/brand'
import { helpEditorial, searchFaq } from '../domain/help-content'
import type { HelpLocale, HelpPage } from '../domain/help-content'
import { prepareSupportDraft, SUPPORT_TOPICS } from '../application/support-draft'

/** Embeddable S21: no Shell, routing, storage, API or global event listeners. */
const props = withDefaults(defineProps<{ locale?: HelpLocale }>(), { locale: 'ru' })
const emit = defineEmits<{ back: [] }>()
const page = ref<HelpPage>('home')
const stack = ref<HelpPage[]>([])
const homeQuery = ref('')
const faqQuery = ref('')
const topic = ref<string>(SUPPORT_TOPICS[0])
const message = ref('')
const prepared = ref('')
const supportError = ref('')
const copied = ref(false)
const editorial = computed(() => helpEditorial[props.locale])
const faqs = computed(() => searchFaq(props.locale, faqQuery.value))
const headings = computed(() => ({
  home: editorial.value.title,
  about: editorial.value.sections[0].title,
  faq: editorial.value.sections[1].title,
  support: editorial.value.sections[2].title,
  terms: editorial.value.sections[3].title,
  privacy: editorial.value.sections[4].title,
}))
const sections = computed(() => editorial.value.sections.filter(s =>
  !homeQuery.value.trim() ||
  `${s.title} ${s.description}`.toLocaleLowerCase(props.locale)
    .includes(homeQuery.value.trim().toLocaleLowerCase(props.locale))))
const homeFaq = computed(() =>
  homeQuery.value.trim() ? searchFaq(props.locale, homeQuery.value) : [])
const groups = computed(() => [...new Set(faqs.value.map(item => item.group))])
const ru = computed(() => props.locale === 'ru')
function navigate(next: HelpPage): void {
  if (next === page.value) return
  stack.value.push(page.value)
  page.value = next
  copied.value = false
  supportError.value = ''
}
function back(): void {
  const previous = stack.value.pop()
  if (previous) page.value = previous
  else emit('back')
}
function showFaqFor(query: string): void {
  faqQuery.value = query
  navigate('faq')
}
function onEscape(): void {
  if (page.value === 'home' && homeQuery.value) homeQuery.value = ''
  else if (page.value === 'faq' && faqQuery.value) faqQuery.value = ''
  else back()
}
function prepare(): void {
  prepared.value = ''
  copied.value = false
  const result = prepareSupportDraft(topic.value, message.value)
  if (result.ok) {
    prepared.value = result.text
    supportError.value = ''
  } else {
    const errors = ru.value
      ? {too_short:'Опиши проблему хотя бы в 15 символах.',too_long:'Максимум 2000 символов.',
        sensitive:'Похоже, в тексте есть секрет. Удали PIN, Recovery Key и любые приватные данные.',
        invalid_topic:'Выбери тему из списка.'}
      : {too_short:'Describe the issue in at least 15 characters.',too_long:'Maximum 2000 characters.',
        sensitive:'Possible secret detected. Remove PINs, Recovery Keys, and private information.',
        invalid_topic:'Choose a topic from the list.'}
    supportError.value = errors[result.reason]
  }
}
async function copyDraft(): Promise<void> {
  if (!prepared.value || !navigator.clipboard?.writeText) {
    supportError.value = ru.value ? 'Копирование недоступно. Выдели текст вручную.' : 'Copy unavailable. Select the text manually.'
    return
  }
  try {
    await navigator.clipboard.writeText(prepared.value)
    copied.value = true
  } catch {
    supportError.value = ru.value ? 'Копирование не удалось. Выдели текст вручную.' : 'Copy failed. Select the text manually.'
  }
}
</script>

<template>
  <section class="help-center" :lang="locale" aria-label="Help and information"
    @keydown.esc.stop.prevent="onEscape">
    <div class="help-heading">
      <button type="button" class="help-back" :aria-label="ru ? 'Назад' : 'Back'" @click="back">
        <span aria-hidden="true">‹</span>
      </button>
      <div>
        <h1>{{ headings[page] }}</h1>
        <p v-if="page === 'home'">{{ brand.name }} · {{ ru ? 'руководство и документы' : 'guide and documents' }}</p>
      </div>
    </div>

    <template v-if="page === 'home'">
      <p class="help-intro">{{ ru ? 'Принципы приложения, ответы и документы — всё в одном месте.' : 'App principles, answers, and documents in one place.' }}</p>
      <label class="help-field" for="help-global-query">{{ ru ? 'Поиск по справке' : 'Search help' }}</label>
      <input id="help-global-query" v-model="homeQuery" class="help-input" type="search"
        :placeholder="ru ? 'Тема или вопрос' : 'Topic or question'" autocomplete="off" />
      <div v-if="sections.length" class="help-group">
        <h2>{{ ru ? 'Разделы' : 'Sections' }}</h2>
        <div class="help-list">
          <button v-for="section in sections" :key="section.id" type="button" class="help-row"
            @click="navigate(section.id)">
            <span><strong>{{ section.title }}</strong><small>{{ section.description }}</small></span>
            <span aria-hidden="true">›</span>
          </button>
        </div>
      </div>
      <div v-if="homeFaq.length" class="help-group">
        <h2>{{ ru ? 'Найденные вопросы' : 'Matching questions' }}</h2>
        <div class="help-list">
          <button v-for="item in homeFaq" :key="item.id" class="help-row" type="button"
            @click="showFaqFor(homeQuery)">
            <strong>{{ item.question }}</strong><span aria-hidden="true">›</span>
          </button>
        </div>
      </div>
      <p v-if="!sections.length && !homeFaq.length" role="status">
        {{ ru ? 'Ничего не найдено.' : 'No results.' }}
      </p>
      <p class="help-muted">{{ ru ? 'Условия и политика пока не утверждены и не являются юридическими документами.' : 'Terms and privacy drafts are not legal documents.' }}</p>
    </template>

    <template v-else-if="page === 'about'">
      <div class="help-hero">
        <h2>{{ ru ? 'Создавайте материалы. Контролируйте доступ.' : 'Create media. Control access.' }}</h2>
        <p>{{ brand.name }} — {{ ru ? 'инструмент заданий и команд, который разрабатывается с приоритетом приватности и Local-First.' : 'an assignment and team workflow designed around privacy and Local-First.' }}</p>
      </div>
      <h2>{{ ru ? 'Принципы' : 'Principles' }}</h2>
      <div class="help-feature-list">
        <article>
          <h3>Zero-Knowledge</h3>
          <p>{{ ru ? 'Цель — шифрование материалов на устройстве до отправки на сервер. Это архитектурный принцип, а не подтверждение независимого аудита.' : 'The goal is client-side encryption before upload. This is an architectural principle, not an independent security certification.' }}</p>
        </article>
        <article>
          <h3>Emergency PIN</h3>
          <p>{{ ru ? 'Экстренное прекращение локального доступа; удалённое удаление требует подтверждения сервера. Dead Man’s Switch — отдельная будущая функция.' : 'Emergency local access shutdown; remote deletion requires a server acknowledgement. Dead Man’s Switch is a separate future capability.' }}</p>
        </article>
        <article>
          <h3>{{ ru ? 'Защита данных и устройство' : 'Device privacy' }}</h3>
          <p>{{ ru ? 'Приложение не должно автоматически сохранять медиа в системную галерею. Полное отсутствие следов ОС и браузера не гарантируется.' : 'Automatic saves to system galleries are not intended. The absence of OS and browser traces cannot be guaranteed.' }}</p>
        </article>
        <article>
          <h3>Safety Tech · Local-First</h3>
          <p>{{ ru ? 'Задания, команды, контролируемый доступ и понятное состояние синхронизации при плохой сети.' : 'Assignments, teams, controlled access, and clear sync status on unreliable networks.' }}</p>
        </article>
      </div>
    </template>

    <template v-else-if="page === 'faq'">
      <label class="help-field" for="help-faq-query">{{ ru ? 'Найти ответ' : 'Find an answer' }}</label>
      <input id="help-faq-query" v-model="faqQuery" class="help-input" type="search"
        :placeholder="ru ? 'Поиск по вопросам' : 'Search questions'" autocomplete="off" />
      <p class="help-muted" role="status">{{ ru ? 'Найдено вопросов:' : 'Questions found:' }} {{ faqs.length }}</p>
      <section v-for="group in groups" :key="group" class="help-group">
        <h2>{{ group }}</h2>
        <div class="help-faq-list">
          <details v-for="entry in faqs.filter(item => item.group === group)"
            :key="entry.id" class="help-faq">
            <summary>{{ entry.question }}<span aria-hidden="true">⌄</span></summary>
            <p>{{ entry.answer }}</p>
          </details>
        </div>
      </section>
      <p v-if="faqs.length === 0" role="status">{{ ru ? 'Ничего не найдено.' : 'No matches.' }}</p>
      <button type="button" class="help-action" @click="navigate('support')">
        {{ ru ? 'Помощь' : 'Help' }}
      </button>
    </template>

    <template v-else-if="page === 'support'">
      <div class="help-panel">
        <h2>{{ ru ? 'Сначала проверь FAQ' : 'Start with the FAQ' }}</h2>
        <p>{{ ru ? 'Ответы о ключах, резервных копиях, сроках и безопасности доступны офлайн.' : 'Answers about keys, backups, retention, and security are available offline.' }}</p>
        <button type="button" class="help-action" @click="navigate('faq')">
          {{ ru ? 'Перейти к FAQ' : 'Open FAQ' }}
        </button>
      </div>
      <h2>{{ ru ? 'Подготовить сообщение' : 'Prepare a message' }}</h2>
      <div class="help-panel">
        <p class="help-muted">{{ ru ? 'Отправка в поддержку не подключена. Составь сообщение и скопируй его самостоятельно.' : 'There is no support submission endpoint. Prepare and manually copy your message.' }}</p>
        <form @submit.prevent="prepare">
          <label class="help-field" for="help-topic">{{ ru ? 'Тема' : 'Topic' }}</label>
          <select id="help-topic" v-model="topic" class="help-input" @change="prepared = ''">
            <option v-for="option in SUPPORT_TOPICS" :key="option">{{ option }}</option>
          </select>
          <label class="help-field" for="help-message">{{ ru ? 'Описание' : 'Description' }}</label>
          <textarea id="help-message" v-model="message" class="help-input" rows="6" maxlength="2000"
            :placeholder="ru ? 'Что произошло и на каком экране? Не вставляй секреты.' : 'What happened and where? Never paste secrets.'"
            @input="prepared = ''; copied = false"></textarea>
          <p class="help-muted">{{ ru ? 'Не добавляй PIN, Recovery Key, файлы, GPS и личные документы.' : 'Never include PINs, Recovery Keys, files, GPS or identity documents.' }}</p>
          <button type="submit" class="help-action primary">{{ ru ? 'Подготовить текст' : 'Prepare text' }}</button>
        </form>
        <p v-if="supportError" role="alert" class="help-error">{{ supportError }}</p>
        <div v-if="prepared" class="help-draft" role="status">
          <strong>{{ ru ? 'Текст готов, но никуда не отправлен.' : 'Draft prepared but not sent.' }}</strong>
          <pre>{{ prepared }}</pre>
          <button class="help-action" type="button" @click="copyDraft">
            {{ copied ? (ru ? 'Скопировано' : 'Copied') : (ru ? 'Скопировать' : 'Copy draft') }}
          </button>
        </div>
      </div>
    </template>

    <template v-else>
      <div class="help-legal" data-legal-status="draft">
        <strong>{{ ru ? 'ЧЕРНОВИК · НЕ ЮРИДИЧЕСКИЙ ДОКУМЕНТ' : 'DRAFT · NOT A LEGAL DOCUMENT' }}</strong>
        <h2>{{ headings[page] }}</h2>
        <p v-if="page === 'terms'">
          {{ ru ? 'Текст условий ещё не утверждён. Правила оплаты, использования, ограничения ответственности и юрисдикция будут определены и юридически проверены до публикации.' : 'These terms are not approved. Payment rules, usage terms, liability and jurisdiction require legal review before publication.' }}
        </p>
        <p v-else>
          {{ ru ? 'Политика ещё не утверждена. Перечень обрабатываемых данных, цели, сроки хранения и права пользователей должны быть подтверждены до публикации.' : 'The privacy policy is not approved. Data categories, purposes, retention, and user rights require verification before publication.' }}
        </p>
        <p class="help-muted">{{ ru ? 'Этот раздел не создаёт договорных обязательств и не заменяет опубликованную политику.' : 'This section is not a published policy or contractual agreement.' }}</p>
      </div>
      <button class="help-action" type="button" @click="navigate(page === 'terms' ? 'privacy' : 'terms')">
        {{ page === 'terms' ? editorial.sections[4].title : editorial.sections[3].title }}
      </button>
    </template>
  </section>
</template>

<style scoped>
.help-center{width:100%;max-width:920px;margin:0 auto;padding:22px 14px 40px;color:var(--text,#f3f3f3);font-size:13px;line-height:1.48}
.help-center h1{font-size:27px;line-height:1.12;letter-spacing:-.04em;margin:0}
.help-center h2{font-size:13px;margin:20px 0 10px}
.help-center h3{font-size:13px;margin:0 0 7px}
.help-center p{line-height:1.6}
.help-heading{display:flex;gap:12px;align-items:center;margin-bottom:20px}
.help-heading p,.help-muted{color:#aaa;font-size:12px;margin:7px 0 12px}
.help-back{border:0;background:none;color:inherit;font-size:29px;line-height:1;min-width:34px;min-height:44px;cursor:pointer}
.help-intro{color:#bbb;max-width:660px;margin-bottom:20px}
.help-input{width:100%;min-height:42px;padding:10px 12px;color:inherit;background:#292929;border:1px solid #4a4a4a;border-radius:8px;font:inherit}
.help-field{display:block;font-size:12px;font-weight:600;margin:15px 0 6px}
.help-input:focus-visible,.help-center button:focus-visible,.help-faq summary:focus-visible{outline:2px solid var(--accent,#1ed760);outline-offset:2px}
.help-group{margin:20px 0}.help-group h2{color:#aaa;font-size:12px}
.help-list,.help-faq-list{background:var(--surface,#202020);border-radius:9px;overflow:hidden}
.help-row{width:100%;min-height:58px;text-align:left;border:0;border-bottom:1px solid #363636;background:transparent;color:inherit;display:flex;align-items:center;justify-content:space-between;gap:14px;padding:13px;cursor:pointer}
.help-row:last-child{border-bottom:0}.help-row:hover{background:#292929}
.help-row strong{display:block;font-size:13px}.help-row small{display:block;color:#a4a4a4;margin-top:4px;font-size:11px}
.help-row>span:last-child{font-size:22px;color:#aaa}
.help-hero,.help-panel,.help-legal{background:var(--surface,#202020);padding:18px;border-radius:9px;margin:15px 0}
.help-hero h2{font-size:18px;margin:0 0 12px}
.help-feature-list{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:10px}
.help-feature-list article{background:var(--surface,#202020);padding:15px;border-radius:9px}
.help-feature-list p{margin:0;color:#b3b3b3}
.help-faq{border-bottom:1px solid #363636}.help-faq:last-child{border:0}
.help-faq summary{cursor:pointer;min-height:54px;padding:14px;display:flex;align-items:center;justify-content:space-between;gap:10px;font-weight:600;list-style:none}
.help-faq summary::-webkit-details-marker{display:none}.help-faq[open] summary span{transform:rotate(180deg)}
.help-faq p{margin:0;padding:0 14px 16px;color:#b8b8b8}
.help-action{display:inline-flex;justify-content:center;align-items:center;min-height:42px;padding:10px 15px;margin:8px 8px 8px 0;border:1px solid #555;background:#303030;color:inherit;border-radius:8px;font:inherit;cursor:pointer}
.help-action.primary{background:var(--accent,#1ed760);color:#111;border:0;font-weight:700}
.help-error{color:#ff8989}.help-draft{border-top:1px solid #444;margin-top:18px;padding-top:12px}
.help-draft pre{white-space:pre-wrap;overflow-wrap:anywhere;font:inherit;max-height:240px;overflow:auto;user-select:text}
.help-legal{border:1px solid #555}.help-legal>strong{font-size:11px;color:#e6c886;letter-spacing:.03em}
.help-legal h2{font-size:17px}
@media(max-width:560px){.help-center{padding:18px 12px 34px}.help-feature-list{grid-template-columns:1fr}}
@media(prefers-reduced-motion:reduce){.help-center *{scroll-behavior:auto!important;transition:none!important}}
</style>
