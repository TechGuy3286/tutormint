// npm run test:searchcount — which searches count as demand (owner, 13 Oct 2026).
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

import { isBotUserAgent, isOwnCrawler, notCountedReason, recountAnon, repeatIds, REPEAT_WINDOW_SECONDS, OWN_CRAWLER_TOKENS, NEW_VISITOR_HEADER } from '../lib/searchCountCore'

const CHROME = 'Mozilla/5.0 (Linux; Android 13; SM-A135F) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Mobile Safari/537.36'
const SAFARI = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1'

test('known bots and crawlers are not counted; real browsers are', () => {
  for (const ua of [
    'Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)',
    'Mozilla/5.0 (Linux; Android 6.0.1; Nexus 5X Build/MMB29P) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Mobile Safari/537.36 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)',
    'Mozilla/5.0 (compatible; bingbot/2.0; +http://www.bing.com/bingbot.htm)',
    'facebookexternalhit/1.1 (+http://www.facebook.com/externalhit_uatext.php)',
    'WhatsApp/2.23.20.0 A',
    'Mozilla/5.0 (compatible; AhrefsBot/7.0; +http://ahrefs.com/robot/)',
    'Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko; compatible; GPTBot/1.2; +https://openai.com/gptbot)',
    'curl/8.4.0',
    'python-requests/2.31.0',
    'node',
    '',
    null,
    'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) HeadlessChrome/126.0.0.0 Safari/537.36',
    'Mozilla/5.0 (Linux; Android 11; moto g power) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Mobile Safari/537.36 Chrome-Lighthouse',
  ]) {
    assert.equal(isBotUserAgent(ua), true, String(ua))
  }
  for (const ua of [CHROME, SAFARI, 'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:128.0) Gecko/20100101 Firefox/128.0']) {
    assert.equal(isBotUserAgent(ua), false, ua)
    assert.equal(notCountedReason({ userAgent: ua, newVisitor: false }), null)
  }
})

test('our own check:links and SEO audit crawls carry a fixed user-agent and are skipped', () => {
  for (const f of ['scripts/check-internal-redirects.mjs', 'scripts/audit-seo-live.mjs']) {
    const src = readFileSync(f, 'utf8')
    const ua = /const UA = '([^']+)'/.exec(src)?.[1] ?? ''
    assert.ok(OWN_CRAWLER_TOKENS.some((t) => ua.includes(t)), `${f}: ${ua}`)
    assert.equal(isOwnCrawler(ua), true)
    // Skipped even though the rest of the string reads as a phone browser, and
    // even if it somehow carried a cookie or a session.
    assert.equal(notCountedReason({ userAgent: ua, newVisitor: false, signedIn: true }), 'link_check')
  }
})

test('signed-in staff are not counted; a member is', () => {
  assert.equal(notCountedReason({ userAgent: CHROME, staff: true, signedIn: true, newVisitor: false }), 'staff')
  assert.equal(notCountedReason({ userAgent: CHROME, staff: false, signedIn: true, newVisitor: false }), null)
  // A signed-in member is a person whatever their visitor cookie.
  assert.equal(notCountedReason({ userAgent: CHROME, signedIn: true, newVisitor: true }), null)
})

test('a request with no visitor cookie is not counted — the first request, and every request of a crawler', () => {
  assert.equal(notCountedReason({ userAgent: CHROME, newVisitor: true }), 'first_hit')
  assert.equal(notCountedReason({ userAgent: CHROME, newVisitor: false }), null)
  // The proxy stamps the fact on every request, overwriting what a client sent.
  const proxy = readFileSync('proxy.ts', 'utf8')
  assert.ok(proxy.includes("headers.set(NEW_VISITOR_HEADER, request.cookies.has(ANON_COOKIE) ? '0' : '1')"))
  assert.equal(NEW_VISITOR_HEADER, 'x-tm-new-visitor')
})

const row = (id: string, visitor: string, what: string, at: string) => ({ id, visitor, what, at })

test('the identical search by one visitor inside 30 minutes is one search', () => {
  assert.equal(REPEAT_WINDOW_SECONDS, 1800)
  const out = repeatIds([
    row('1', 'v', 'physics|lahore', '2026-10-13T10:00:00Z'),
    row('2', 'v', 'physics|lahore', '2026-10-13T10:10:00Z'), // repeat
    row('3', 'v', 'physics|lahore', '2026-10-13T10:29:00Z'), // still inside 30 min of the counted one
    row('4', 'v', 'physics|lahore', '2026-10-13T10:31:00Z'), // counted again
    row('5', 'v', 'maths|lahore', '2026-10-13T10:05:00Z'), // a different search
    row('6', 'w', 'physics|lahore', '2026-10-13T10:05:00Z'), // another visitor
  ])
  assert.deepEqual([...out].sort(), ['2', '3'])
})

test('the recount: a visitor seen once is left out; a returning visitor keeps their searches, less repeats', () => {
  const rows = [
    // A crawl: 5 "visitors", one search each.
    ...Array.from({ length: 5 }, (_, i) => row(`c${i}`, `crawl-${i}`, 'robotics|lahore', `2026-10-13T06:0${i}:00Z`)),
    // A person: three searches, one a quick repeat.
    row('p1', 'person', 'physics|lahore', '2026-10-12T09:00:00Z'),
    row('p2', 'person', 'physics|lahore', '2026-10-12T09:05:00Z'),
    row('p3', 'person', 'maths|lahore', '2026-10-12T09:06:00Z'),
  ]
  const flags = recountAnon(rows)
  for (let i = 0; i < 5; i++) assert.equal(flags.get(`c${i}`), 'first_hit')
  assert.equal(flags.get('p2'), 'repeat')
  assert.equal(flags.has('p1'), false)
  assert.equal(flags.has('p3'), false)
})

test('every search log asks the rule before it writes, and the queue reads only counted rows', () => {
  for (const [f, call] of [
    ['lib/anonSearch.ts', 'if (await searchNotCounted()) return'],
    ['lib/activityLog.ts', 'if (await searchNotCounted({ userId: params.userId })) return'],
    ['lib/smartSearch.ts', 'if (await searchNotCounted({ userId: input.userId ?? null, role: input.role })) return'],
  ] as const) {
    assert.ok(readFileSync(f, 'utf8').includes(call), f)
  }
  const build = readFileSync('lib/contentQueue/build.ts', 'utf8')
  assert.ok(build.includes(".is('excluded', null)"), 'the blog queue and recruitment cards skip flagged rows')
  assert.ok(build.includes('staffIds.has(row.user_id)') && build.includes('repeats.has('), 'member searches: no staff, no repeats')
  // Nothing is deleted by the recount.
  const dataop = readFileSync('scripts/dataop-recount-searches.ts', 'utf8')
  assert.ok(!/delete from/i.test(dataop))
})
