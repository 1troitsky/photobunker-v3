// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest'
import { createApp, nextTick } from 'vue'
import HelpCenter from '../ui/HelpCenter.vue'

let app: ReturnType<typeof createApp> | null = null
let root: HTMLElement | null = null

function mount(locale: 'ru' | 'en' = 'ru'): HTMLElement {
  root = document.createElement('div')
  document.body.appendChild(root)
  app = createApp(HelpCenter, { locale })
  app.mount(root)
  return root
}
async function clickText(container: HTMLElement, text: string): Promise<void> {
  const button = [...container.querySelectorAll('button')]
    .find(node => node.textContent?.includes(text))
  expect(button, `Missing button: ${text}`).toBeDefined()
  button!.click()
  await nextTick()
}
afterEach(() => {
  app?.unmount()
  root?.remove()
  app = null
  root = null
})

describe('S21 standalone Vue help UI', () => {
  it('opens every accepted section without Shell or navigation dependency', async () => {
    const el = mount()
    expect(el.querySelectorAll('.help-row')).toHaveLength(5)
    await clickText(el, 'Частые вопросы')
    expect(el.querySelectorAll('.help-faq')).toHaveLength(15)
    const first = el.querySelector('summary') as HTMLElement
    first.click()
    expect((first.parentElement as HTMLDetailsElement).open).toBe(true)
    const search = el.querySelector<HTMLInputElement>('#help-faq-query')!
    search.value = 'невозможный-запрос-без-совпадений'
    search.dispatchEvent(new Event('input', { bubbles: true }))
    await nextTick()
    expect(el.querySelectorAll('.help-faq')).toHaveLength(0)
    expect(el.querySelector('[role="status"]')?.textContent).toContain('0')
    await clickText(el, 'Назад')
    expect(el.querySelectorAll('.help-row')).toHaveLength(5)
    await clickText(el, 'Условия использования')
    expect(el.querySelector('[data-legal-status="draft"]')?.textContent).toContain('НЕ ЮРИДИЧЕСКИЙ')
    await clickText(el, 'Политика конфиденциальности')
    expect(el.querySelector('[data-legal-status="draft"]')?.textContent).toContain('Политика')
  })
  it('never presents a fake support success or submits a support network form', async () => {
    const el = mount()
    await clickText(el, 'Помощь')
    expect(el.textContent).toContain('Отправка в поддержку не подключена')
    const message = el.querySelector<HTMLTextAreaElement>('#help-message')!
    message.value = 'Recovery Key: super-secret-material-here'
    message.dispatchEvent(new Event('input', { bubbles: true }))
    await nextTick()
    el.querySelector('form')!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }))
    await nextTick()
    expect(el.querySelector('[role="alert"]')?.textContent).toContain('секрет')
    expect(el.querySelector('.help-draft')).toBeNull()
    message.value = 'В приложении не открывается экран камеры после переключения режима.'
    message.dispatchEvent(new Event('input', { bubbles: true }))
    await nextTick()
    el.querySelector('form')!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }))
    await nextTick()
    expect(el.querySelector('.help-draft')?.textContent).toContain('никуда не отправлен')
    expect(el.querySelector('.help-draft')?.textContent).toContain('камеры')
  })
  it('renders English and can return via keyboard', async () => {
    const el = mount('en')
    expect(el.textContent).toContain('Help and information')
    await clickText(el, 'Frequently asked questions')
    expect(el.querySelectorAll('.help-faq')).toHaveLength(15)
    el.querySelector('.help-center')!.dispatchEvent(new KeyboardEvent('keydown', {
      key:'Escape',bubbles:true,cancelable:true
    }))
    await nextTick()
    expect(el.textContent).toContain('Help and information')
  })
})
