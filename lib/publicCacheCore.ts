// PURE. Cache-Control for public, non-personal GET responses (PR-15).
//
// The CDN keeps the response (s-maxage) and serves a stale copy while it
// fetches a fresh one in the background (stale-while-revalidate), so a burst
// of visitors or crawlers costs one function run, not one each. Only for
// responses that are the same for every visitor: never a signed-in answer,
// never anything personal.

/** Sitemaps and other crawl files: rebuilt at most hourly. */
export const CACHE_SITEMAP = 'public, max-age=0, s-maxage=3600, stale-while-revalidate=86400'

/** Public lists and lookups (blog list, city areas, search words, cities). */
export const CACHE_PUBLIC_LIST = 'public, max-age=300, s-maxage=600, stale-while-revalidate=86400'

/** Small public switches (which checkout options are on). */
export const CACHE_PUBLIC_SWITCH = 'public, max-age=60, s-maxage=300, stale-while-revalidate=3600'
