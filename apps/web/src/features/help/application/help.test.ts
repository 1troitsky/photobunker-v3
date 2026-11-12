import { describe, expect, it } from 'vitest'
import { helpEditorial, searchFaq } from '../domain/help-content'
import { containsPossibleSecret, prepareSupportDraft } from './support-draft'

describe('S21 offline help content', () => {
  it('has the five accepted sections and locally searchable FAQ in both languages', () => {
    for (const locale of ['ru', 'en'] as const) {
      expect(helpEditorial[locale].sections.map(item => item.id))
        .toEqual(['about', 'faq', 'support', 'terms', 'privacy'])
      expect(searchFaq(locale, '')).toHaveLength(15)
      expect(searchFaq(locale, 'impossible-nonexistent-phrase')).toEqual([])
    }
    expect(searchFaq('ru', 'ключ').length).toBeGreaterThan(0)
    expect(searchFaq('en', 'backup').length).toBeGreaterThan(0)
    expect(searchFaq('en', '   BACKUP   ').length).toBeGreaterThan(0)
  })
  it('never presents the drafts as approved legal documents', () => {
    for (const locale of ['ru', 'en'] as const) {
      expect(helpEditorial[locale].sections.slice(-2).every(s =>
        /черновик|draft/i.test(s.description))).toBe(true)
    }
  })
})

describe('copy-only support preparation', () => {
  it('rejects empty, too-short, too-long and unknown topics', () => {
    expect(prepareSupportDraft('Вопрос о функциях', 'short')).toEqual({ok:false,reason:'too_short'})
    expect(prepareSupportDraft('Вопрос о функциях', 'a'.repeat(2001)))
      .toEqual({ok:false,reason:'too_long'})
    expect(prepareSupportDraft('arbitrary', 'This is a valid length message'))
      .toEqual({ok:false,reason:'invalid_topic'})
  })
  it('rejects apparent secrets but allows discussion about lost keys', () => {
    for (const secret of [
      'Recovery Key: super-secret-material-here',
      'PIN=12345678',
      '-----BEGIN PRIVATE KEY-----\nsecret',
      'Backup token ' + 'a'.repeat(80),
      '1 2 3 4 5 6 7 8 9 10 11 12',
    ]) {
      expect(containsPossibleSecret(secret)).toBe(true)
      expect(prepareSupportDraft('Безопасность и приватность', secret + ' longer description').ok)
        .toBe(false)
    }
    const prepared=prepareSupportDraft('Проблема с аккаунтом или ключом',
      'Я потерял Recovery Key. Можно ли восстановить аккаунт?')
    expect(prepared.ok).toBe(true)
    if (prepared.ok) expect(prepared.text).toContain('Тема: Проблема')
  })
})
