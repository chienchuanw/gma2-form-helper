import { render } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import App from './App'
import { ANALYTICS_PROPS } from './analytics'

describe('analytics', () => {
  afterEach(() => {
    document.head.querySelectorAll('script[src*="insights"]').forEach((s) => s.remove())
  })

  it("uses the hub's same-origin endpoint, so behind the hub page views reach its dashboard", () => {
    expect(ANALYTICS_PROPS).toEqual({
      scriptSrc: '/_vercel/insights/script.js',
      endpoint: '/_vercel/insights',
    })
  })

  it('loads the analytics script with that endpoint when the app renders', () => {
    render(<App />)
    const script = document.head.querySelector('script[src="/_vercel/insights/script.js"]')
    expect(script).not.toBeNull()
    expect(script?.getAttribute('data-endpoint')).toBe('/_vercel/insights')
  })
})
