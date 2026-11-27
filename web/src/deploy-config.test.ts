import { describe, expect, it } from 'vitest'
import viteConfig from '../vite.config'
import { STRINGS } from './i18n'
import vercelJson from '../vercel.json?raw'

const LEGACY_HOST = [{ type: 'host', value: 'gma2-form-helper.vercel.app' }]
const HUB_FORM = 'https://gma2.chienchuanw.com/form/:path*'

const vercel = JSON.parse(vercelJson)

describe('deploy config', () => {
  it('builds asset URLs under /form/ for the hub', () => {
    expect(viteConfig.base).toBe('/form/')
  })

  it('redirects the legacy host to the hub, matching /form paths first so the prefix is not doubled', () => {
    expect(vercel.redirects).toEqual([
      { source: '/form/:path*', has: LEGACY_HOST, permanent: true, destination: HUB_FORM },
      { source: '/:path*', has: LEGACY_HOST, permanent: true, destination: HUB_FORM },
    ])
  })

  it('labels the hub link in both languages', () => {
    expect(STRINGS.en.hubLink).toBe('gma2 tools')
    expect(STRINGS['zh-TW'].hubLink).toBe('gma2 工具')
  })
})
