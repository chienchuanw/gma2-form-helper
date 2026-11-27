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
      // Vercel serves a static root index.html without applying the /:path* catch-all, so the
      // root needs its own rule.
      { source: '/', has: LEGACY_HOST, permanent: true, destination: 'https://gma2.chienchuanw.com/form' },
      { source: '/form/:path*', has: LEGACY_HOST, permanent: true, destination: HUB_FORM },
      { source: '/:path*', has: LEGACY_HOST, permanent: true, destination: HUB_FORM },
    ])
  })

  it('serves /form/* from the root when reached without the hub, so previews and the origin still load their assets', () => {
    expect(vercel.rewrites).toEqual([{ source: '/form/:path*', destination: '/:path*' }])
  })

  it('labels the hub link in both languages', () => {
    expect(STRINGS.en.hubLink).toBe('gma2 tools')
    expect(STRINGS['zh-TW'].hubLink).toBe('gma2 工具')
  })
})
