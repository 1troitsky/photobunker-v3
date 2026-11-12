/**
 * S21 / J-20 — offline, read-only editorial material.
 * Copy follows docs/ux/help-legal/README.md (OWNER-ACCEPTED UI, TEXT DRAFT).
 * Not an agreement, certification, support endpoint, or public security claim.
 */
export type HelpPage = 'home' | 'about' | 'faq' | 'support' | 'terms' | 'privacy'
export type HelpLocale = 'ru' | 'en'
export type FaqEntry = { id: string; group: string; question: string; answer: string }
export type HelpSection = { id: Exclude<HelpPage, 'home'>; title: string; description: string }

const ruFaq: FaqEntry[] = [
  {id:'purpose',group:'Начало работы',question:'Для чего нужно приложение?',answer:'Инструмент для заданий, команд, фото, видео и аудио с контролем доступа и сроков хранения. Это не обычный облачный диск.'},
  {id:'assignments',group:'Начало работы',question:'Как работают задания и команды?',answer:'В задании задаются инструкции, участники, требования к материалам и сроки. Право на просмотр каждого материала зависит от разрешений.'},
  {id:'offline',group:'Начало работы',question:'Можно ли работать без интернета?',answer:'Целевая модель Local-First: данные сначала защищённо сохраняются локально, затем синхронизируются. До подтверждения загрузки единственная копия может оставаться на устройстве.'},
  {id:'zero-knowledge',group:'Конфиденциальность',question:'Что означает Zero-Knowledge?',answer:'Это архитектурная цель: шифрование на устройстве до передачи на сервер. Заявление о полной безопасности требует независимой проверки реализации.'},
  {id:'gallery',group:'Конфиденциальность',question:'Попадают ли фотографии в системную галерею?',answer:'Приложение не должно автоматически добавлять отснятые материалы в системную фототеку. Ручной экспорт может создать копии вне приложения.'},
  {id:'traces',group:'Конфиденциальность',question:'Могут ли остаться следы на устройстве?',answer:'Нельзя гарантировать отсутствие кэшей ОС, буферов, скриншотов или следов на скомпрометированном устройстве.'},
  {id:'access',group:'Конфиденциальность',question:'Кто может просматривать файлы?',answer:'Архитектура предполагает выдачу ключей лишь участникам с нужными правами. Фактические гарантии зависят от проверки E2EE и ACL.'},
  {id:'emergency',group:'Конфиденциальность',question:'Что делает экстренный PIN?',answer:'Предназначен для прекращения локального доступа. Удаление в облаке нельзя считать выполненным, пока оно не подтверждено сервером.'},
  {id:'deadman',group:'Конфиденциальность',question:'Есть ли Dead Man’s Switch?',answer:'Автоматический механизм пока не подтверждён как доступная функция; это отдельная будущая возможность, не экстренный PIN.'},
  {id:'recovery',group:'Конфиденциальность',question:'Что будет, если потеряю ключ восстановления?',answer:'Без Recovery Key и доверенного устройства доступ к зашифрованным данным может быть потерян навсегда. Резервная копия не заменяет ключ.'},
  {id:'backup',group:'Хранение и тарифы',question:'Как работает резервная копия?',answer:'Резервные копии хранятся в зашифрованном виде по правилам тарифа и обновляются; доступность конкретной функции определяется фактической реализацией. Free не включает backup.'},
  {id:'ttl',group:'Хранение и тарифы',question:'Как работают сроки хранения?',answer:'Срок хранения файла или задания действует отдельно от срока подписки. После удаления восстановление может быть невозможно.'},
  {id:'plan',group:'Хранение и тарифы',question:'Что будет после окончания тарифа?',answer:'Для платных тарифов предусмотрен льготный период в зависимости от плана. Проверяйте точные даты в аккаунте; материал также подчиняется собственному TTL.'},
  {id:'storage',group:'Хранение и тарифы',question:'Почему есть ограничения облака?',answer:'Объём и количество файлов — ресурсные ограничения, отдельные от заданий и функциональности. Тариф Unlimited не означает бесконечное хранилище.'},
  {id:'s3',group:'Хранение и тарифы',question:'Можно ли подключить собственное S3?',answer:'Дополнительные хранилища рассматриваются отдельно; наличие этой функции не гарантируется существующим тарифом.'},
]
const enFaq: FaqEntry[] = [
  {id:'purpose',group:'Getting started',question:'What is this app?',answer:'An assignment and team workflow for photos, videos, and audio with controlled access and retention, not a conventional cloud drive.'},
  {id:'assignments',group:'Getting started',question:'How do assignments and teams work?',answer:'Assignments define instructions, participants, file requirements, and retention. Access to each item depends on permissions.'},
  {id:'offline',group:'Getting started',question:'Can I work offline?',answer:'The Local-First goal is to store encrypted local data first, then sync. Until acknowledged, the only copy may remain on your device.'},
  {id:'zero-knowledge',group:'Privacy',question:'What does Zero-Knowledge mean?',answer:'Client-side encryption before uploading is an architectural goal. Independent implementation audits are needed before making security guarantees.'},
  {id:'gallery',group:'Privacy',question:'Will photos appear in my device gallery?',answer:'Automatic saving to the system library is not intended. A manual export can create copies outside the app.'},
  {id:'traces',group:'Privacy',question:'Can device traces remain?',answer:'Operating-system caches, screenshots, temporary buffers, or traces on a compromised device cannot be ruled out.'},
  {id:'access',group:'Privacy',question:'Who can view my files?',answer:'Only authorized recipients should receive decryption access; actual protection depends on tested E2EE and ACL enforcement.'},
  {id:'emergency',group:'Privacy',question:'What does the emergency PIN do?',answer:'It is designed to stop local access. Cloud deletion is not complete until the server has acknowledged it.'},
  {id:'deadman',group:'Privacy',question:'Is Dead Man’s Switch available?',answer:'This automated mechanism remains a separate unconfirmed future capability, not the emergency PIN.'},
  {id:'recovery',group:'Privacy',question:'What if I lose my Recovery Key?',answer:'Without the key or a trusted device, access to encrypted data may be irrecoverable. A backup cannot replace the key.'},
  {id:'backup',group:'Storage and plans',question:'How do backups work?',answer:'Encrypted backups follow plan rules and are updated. Actual availability depends on implementation. Free does not include backups.'},
  {id:'ttl',group:'Storage and plans',question:'How does retention work?',answer:'A file or assignment retention deadline applies independently of subscription expiration. Deletion may be irreversible.'},
  {id:'plan',group:'Storage and plans',question:'What if my plan expires?',answer:'Paid plans have plan-specific grace periods. Check exact account deadlines; individual file TTL still applies.'},
  {id:'storage',group:'Storage and plans',question:'Why are there storage limits?',answer:'File quantity and bytes are resource limits separate from assignment functionality. Unlimited does not mean infinite storage.'},
  {id:'s3',group:'Storage and plans',question:'Can I connect my own S3 storage?',answer:'Additional storage adapters are a separate future area, not a promised feature of an existing plan.'},
]
export const helpEditorial = {
  ru: {
    title:'Помощь и информация',
    sections:[
      {id:'about',title:'О приложении',description:'Назначение и принципы'},
      {id:'faq',title:'Частые вопросы',description:'Ключи, TTL, приватность, backup'},
      {id:'support',title:'Помощь',description:'Найти ответ и подготовить обращение'},
      {id:'terms',title:'Условия использования',description:'Черновик, не юридический документ'},
      {id:'privacy',title:'Политика конфиденциальности',description:'Черновик, не юридический документ'},
    ] satisfies HelpSection[],
    faq:ruFaq,
  },
  en: {
    title:'Help and information',
    sections:[
      {id:'about',title:'About',description:'Purpose and principles'},
      {id:'faq',title:'Frequently asked questions',description:'Keys, retention, privacy and backups'},
      {id:'support',title:'Help',description:'Find answers and prepare a message'},
      {id:'terms',title:'Terms of use',description:'Draft, not a legal document'},
      {id:'privacy',title:'Privacy policy',description:'Draft, not a legal document'},
    ] satisfies HelpSection[],
    faq:enFaq,
  },
} as const

export function searchFaq(locale: HelpLocale, query: string): FaqEntry[] {
  const q=query.trim().toLocaleLowerCase(locale)
  return q ? helpEditorial[locale].faq.filter(f => [f.question,f.answer,f.group]
    .some(text => text.toLocaleLowerCase(locale).includes(q))) : [...helpEditorial[locale].faq]
}
