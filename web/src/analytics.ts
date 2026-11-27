/**
 * Page views are counted by the gma2 tools hub's Vercel Web Analytics (enabled on the hub
 * project only). Behind the hub these root-absolute URLs resolve on gma2.chienchuanw.com, so the
 * hub serves the script and receives the page views. Keep in sync with gma2-hub
 * `src/lib/analytics.ts`.
 */
export const ANALYTICS_PROPS = {
  scriptSrc: '/_vercel/insights/script.js',
  endpoint: '/_vercel/insights',
} as const
