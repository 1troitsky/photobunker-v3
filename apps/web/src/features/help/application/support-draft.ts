/**
 * Local copy-only support draft: no network, persistence, or fake delivery.
 * Detection is heuristic and is NOT a guarantee against sharing all secrets.
 */
export const SUPPORT_TOPICS = [
  'Вопрос о функциях', 'Проблема с аккаунтом или ключом',
  'Ошибка приложения', 'Задания и команды', 'Тарифы и платежи',
  'Безопасность и приватность',
] as const
export const SUPPORT_TOPICS_EN = [
  'Feature question', 'Account or key problem', 'App error',
  'Assignments and teams', 'Plans and payments', 'Security and privacy',
] as const
export type SupportTopic = typeof SUPPORT_TOPICS[number]
export type DraftResult =
  | {ok:true; text:string}
  | {ok:false; reason:'too_short'|'too_long'|'sensitive'|'invalid_topic'}

export function containsPossibleSecret(message: string): boolean {
  return /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/i.test(message)
    || /(?:recovery[ -]?key|seed[ -]?phrase|private[ -]?key|ключ(?:[а-я]*) восстановления|секретн(?:ый|ого) ключ|пин|pin)[ \t]*[:=][ \t]*\S{4,}/i.test(message)
    || /\b(?:[A-Fa-f0-9]{64,}|[A-Za-z0-9+/_-]{64,}={0,2})\b/.test(message)
    || /(?:^|\s)(?:\d{1,6}[ \t]+){11,23}\d{1,6}(?=\s|$)/.test(message)
}
export function prepareSupportDraft(
  topic: string, message: string, locale: 'ru' | 'en' = 'ru',
): DraftResult {
  const index = (SUPPORT_TOPICS as readonly string[]).indexOf(topic)
  if (index < 0) return {ok:false,reason:'invalid_topic'}
  const body = message.trim()
  if (body.length < 15) return {ok:false,reason:'too_short'}
  if (body.length > 2000) return {ok:false,reason:'too_long'}
  if (containsPossibleSecret(body)) return {ok:false,reason:'sensitive'}
  const subject = locale === 'en' ? SUPPORT_TOPICS_EN[index] : topic
  return {ok:true,text:`${locale === 'en' ? 'Subject' : 'Тема'}: ${subject}\n\n${body}`}
}
