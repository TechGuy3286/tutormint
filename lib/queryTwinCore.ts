// PURE. Query twins (push 3, owner 1 Nov 2026).
//
// A cached page cannot read its query string. The few public pages that DO
// need one — the blog's topic filter and page number, a tuition-jobs hub's page
// number, a tutor's own preview — have a dynamic twin under /qs, and proxy.ts
// rewrites only the requests that carry that query there. The clean address
// stays cached; the visitor's address bar never changes.

export const QUERY_TWIN_PREFIX = '/qs'

const HUB = /^\/tuition-jobs\/(?!school\/)[^/]+(?:\/[^/]+)?$/
const TUTOR = /^\/tutor\/[^/]+$/

const BROWSE = /^\/browse\/(tutors|tuitions)$/

/** The twin to rewrite to, or null to serve the cached page.
 *  Browse (owner, 2 Nov 2026 — phone speed): only the bare address for a
 *  signed-out visitor is cached; any query, or a sign-in cookie, goes live. */
export function queryTwinPath(pathname: string, params: URLSearchParams, signedIn = false): string | null {
  if (pathname.startsWith(QUERY_TWIN_PREFIX + '/')) return null
  if (BROWSE.test(pathname) && (signedIn || [...params.keys()].length > 0)) return QUERY_TWIN_PREFIX + pathname
  const has = (k: string) => (params.get(k) ?? '') !== ''
  if (pathname === '/blog' && (has('cluster') || has('page'))) return QUERY_TWIN_PREFIX + pathname
  if (HUB.test(pathname) && has('page') && params.get('page') !== '1') return QUERY_TWIN_PREFIX + pathname
  if (TUTOR.test(pathname) && params.get('preview') === '1') return QUERY_TWIN_PREFIX + pathname
  return null
}
