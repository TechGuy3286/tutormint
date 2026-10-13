// lib/searchCountCore.ts
//
// Which searches COUNT as demand (owner, 13 Oct 2026). PURE — no database, no
// server-only import — so the proxy, the three search logs, the recount and the
// tests share one rule (scripts/test-search-count.ts).
//
// The search log feeds the blog topic queue, the recruitment cards and "Unmet
// searches". On 13 Oct it held 5,783 anonymous tutor searches from 5,728
// "visitors": crawlers. A crawler sends no cookie, so every page it opened was
// a brand-new visitor making one search. A search is therefore NOT counted when:
//
//   bot        the user-agent is a known bot or crawler, or is missing
//   link_check it is our own check:links / SEO audit crawl (fixed user-agent)
//   staff      a signed-in staff member made it
//   first_hit  the visitor arrived with no visitor cookie — the first request
//              of a browser, and every request of a crawler. A person's next
//              page carries the cookie and counts.
//   repeat     the same visitor made the identical search in the last 30 minutes
//
// Nothing here blocks or changes a search: the page renders the same for
// everyone. Only the counting differs.

/** Our own crawlers say who they are (scripts/check-internal-redirects.mjs, scripts/audit-seo-live.mjs). */
export const OWN_CRAWLER_TOKENS = ['TutorMint-link-check', 'TutorMint-SEO-audit']

/** proxy.ts stamps this on every request: '1' when the browser sent no visitor
 *  cookie. Overwritten by the proxy, so a client cannot fake it. */
export const NEW_VISITOR_HEADER = 'x-tm-new-visitor'

/** The identical search by the same visitor inside this window is one search. */
export const REPEAT_WINDOW_SECONDS = 30 * 60

const BOT_RE =
  /bot\b|bot[\/;) ]|crawl|spider|slurp|scrap|fetch|headless|lighthouse|pagespeed|preview|monitor|uptime|pingdom|statuscake|gtmetrix|facebookexternalhit|facebookcatalog|whatsapp|telegram|skype|discord|embedly|quora link|pinterest|bingpreview|yandex|baidu|duckduck|semrush|ahrefs|mj12|dotbot|petal|bytespider|gptbot|chatgpt|oai-search|claude|anthropic|perplexity|ccbot|amazonbot|applebot|google-inspectiontool|googleother|adsbot|mediapartners|feedfetcher|apis-google|storebot|curl\/|wget\/|python-requests|python-urllib|aiohttp|httpx|okhttp|go-http-client|java\/|libwww|node-fetch|undici|axios|postman|insomnia|phantomjs|selenium|puppeteer|playwright|vercel-screenshot|vercelbot|cloudflare|datadog|newrelic|site24x7/i

export type NotCounted = 'bot' | 'link_check' | 'staff' | 'first_hit' | 'repeat'

/** Our own crawl (check:links, the SEO audit). */
export function isOwnCrawler(ua: string | null | undefined): boolean {
  const v = (ua ?? '').toLowerCase()
  return OWN_CRAWLER_TOKENS.some((t) => v.includes(t.toLowerCase()))
}

/** A known bot or crawler — or no user-agent at all, which no browser sends. */
export function isBotUserAgent(ua: string | null | undefined): boolean {
  const v = (ua ?? '').trim()
  if (v.length < 12) return true
  return BOT_RE.test(v)
}

/**
 * Why this search is not counted, or null when it counts. `staff` is a
 * signed-in staff member; `newVisitor` is the proxy's stamp (true = the browser
 * sent no visitor cookie). A signed-in member is a person whatever their cookie.
 */
export function notCountedReason(input: {
  userAgent: string | null | undefined
  staff?: boolean
  signedIn?: boolean
  newVisitor?: boolean | null
}): NotCounted | null {
  if (isOwnCrawler(input.userAgent)) return 'link_check'
  if (isBotUserAgent(input.userAgent)) return 'bot'
  if (input.staff) return 'staff'
  if (!input.signedIn && input.newVisitor) return 'first_hit'
  return null
}

// ------------------------------------------------------------ the recount ---

export type LoggedSearch = {
  id: string
  /** The visitor: a member id, or an anonymous session id. */
  visitor: string
  /** What was searched, as one comparable string. */
  what: string
  at: string
}

/**
 * The repeats in a visitor's searches: the identical search made again within
 * 30 minutes of the one that was counted. Returns the ids to leave out.
 */
export function repeatIds(rows: LoggedSearch[], windowSeconds = REPEAT_WINDOW_SECONDS): Set<string> {
  const out = new Set<string>()
  const last = new Map<string, number>()
  const sorted = [...rows].sort((a, b) => new Date(a.at).getTime() - new Date(b.at).getTime() || a.id.localeCompare(b.id))
  for (const r of sorted) {
    const key = `${r.visitor}|${r.what}`
    const t = new Date(r.at).getTime()
    const prev = last.get(key)
    if (prev !== undefined && t - prev < windowSeconds * 1000) out.add(r.id)
    else last.set(key, t)
  }
  return out
}

/**
 * The recount of rows logged BEFORE these rules, when no user-agent was kept.
 * A crawler is recognisable all the same: it never sends a cookie, so each of
 * its requests is a visitor seen exactly once. An anonymous visitor with ONE
 * search in the whole log is therefore left out (`first_hit` — the same rule
 * new searches follow); a visitor seen again keeps their searches, less the
 * repeats inside 30 minutes.
 */
export function recountAnon(rows: LoggedSearch[]): Map<string, NotCounted> {
  const out = new Map<string, NotCounted>()
  const perVisitor = new Map<string, number>()
  for (const r of rows) perVisitor.set(r.visitor, (perVisitor.get(r.visitor) ?? 0) + 1)
  const kept: LoggedSearch[] = []
  for (const r of rows) {
    if ((perVisitor.get(r.visitor) ?? 0) <= 1) out.set(r.id, 'first_hit')
    else kept.push(r)
  }
  for (const id of repeatIds(kept)) out.set(id, 'repeat')
  return out
}
