import { describe, expect, it } from 'vitest'
import { STRINGS, detectLang } from './i18n'

describe('i18n', () => {
  it('picks Traditional Chinese for any Chinese browser language and English otherwise', () => {
    expect(detectLang(['zh-TW'])).toBe('zh-TW')
    expect(detectLang(['zh-Hant-HK', 'en'])).toBe('zh-TW')
    expect(detectLang(['en-US', 'zh-TW'])).toBe('en')
    expect(detectLang([])).toBe('en')
  })

  it('has every string in both languages', () => {
    expect(Object.keys(STRINGS['zh-TW']).sort()).toEqual(Object.keys(STRINGS.en).sort())
  })
})
