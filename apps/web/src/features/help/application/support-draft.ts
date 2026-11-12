/**
 * A local copy-only support draft. No network, persistence or form submission.
 * Heuristic safety gate; cannot reliably recognize every possible secret.
 */
export const SUPPORT_TOPICS = [
  'Вопрос о функциях', 'Проблема с аккаунтом или ключом',
  'Ошибка приложения', 'Задания и команды', 'Тарифы и платежи',
  'Безопасность и приватность',
] as const
export const SUPPORT_TOPICS_EN = [\n  'Feature question', 'Account or key problem', 'App error',\n  'Assignments and teams', 'Plans and payments', 'Security and privacy',\n] as const\nexport type SupportTopic = typeof SUPPORT_TOPICS[number]
export type DraftResult =
  | {ok:true; text:string}
  | {ok:false; reason:'too_short'|'too_long'|'sensitive'|'invalid_topic'}

export function containsPossibleSecret(message: string): boolean {
  // Explicitly pasted secret material, not ordinary discussion about a key or PIN.
  return /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/i.test(message)
    || /(?:recovery[ -]?key|seed[ -]?phrase|private[ -]?key|ключ(?:[а-я]*) восстановления|секретн(?:ый|ого) ключ|пин|pin)[ \t]*[:=][ \t]*\S{4,}/i.test(message)
    || /\b(?:[A-Fa-f0-9]{64,}|[A-Za-z0-9+/_-]{64,}={0,2})\b/.test(message)
    || /(?:^|\n)\s*(?:\d+\s+){11,23}\d+\s*(?:$|\n)/.test(message)
}
export function prepareSupportDraft(topic: string, message: string, locale: 'ru' | 'en' = 'ru'): DraftResult {
  if(!(SUPPORT_TOPICS as readonly string[]).includes(topic))
    return {ok:false,reason:'invalid_topic'}
  const body=message.trim()
  if(body.length<15)return {ok:false,reason:'too_short'}
  if(body.length>2000)return {ok:false,reason:'too_long'}
  if(containsPossibleSecret(body))return {ok:false,reason:'sensitive'}
  return {ok:true,text:`Тема: ${topic}\n\n${body}`}
}
