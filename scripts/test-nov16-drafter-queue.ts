// npm run test:nov16 — the 16 Nov 2026 PR: the blog AI drafter, the content
// queue refresh, Owner-only "Clear mobile verification", and People's Export
// CSV following the selected chips. Invented data only.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'

import { AI_DRAFT_FAILED_MESSAGE, extractJsonObject, parseOutlineReply, runOutline, stripDraftHead } from '../lib/ai/draftReply'
import { sanitizeDraft } from '../lib/ai/blogChecker'
import { blockedTitles, normTitle, queueUpdatedLabel, refreshCandidates, rowOfferable } from '../lib/contentQueue/refreshCore'
import { ALL_STAFF_ROLES, canClearMobileVerification } from '../lib/adminAccessCore'
import { peopleExportHref, peopleListQuery } from '../lib/peopleListQuery'

const read = (f: string) => fs.readFileSync(f, 'utf8')
const OUTLINE = '{"sections": ["How do I find female tuition jobs?", "What do schools ask for?", "How do I apply?", "Frequently asked questions"], "seoTitle": "Female teaching jobs in a city", "seoDescription": "How to find female teaching and tuition jobs."}'

// ------------------------------------------------------------ 1. the drafter ---

test('a reply inside a ```json code fence is read', () => {
  const p = extractJsonObject('```json\n' + OUTLINE + '\n```')
  assert.ok(p)
  assert.equal((p.sections as string[]).length, 4)
})

test('a reply with text before and after the JSON is read', () => {
  const p = extractJsonObject('Here is the outline you asked for:\n\n' + OUTLINE + '\n\nLet me know if you want changes {or not}.')
  assert.ok(p)
  assert.equal(p.seoTitle, 'Female teaching jobs in a city')
})

test('a brace inside a string does not confuse the reader', () => {
  const p = extractJsonObject('{"sections": ["What is {this}?", "b", "c"], "seoTitle": "x}"}')
  assert.deepEqual(p?.sections, ['What is {this}?', 'b', 'c'])
})

test('a reply cut off before its closing brace has no JSON object', () => {
  assert.equal(extractJsonObject('{"sections": ["How do I find', ), null)
  assert.equal(parseOutlineReply('{"sections": ["a", "b"', 'T').ok, false)
})

test('the outline retries ONCE on an unreadable reply and then succeeds', async () => {
  const calls: number[] = []
  const out = await runOutline(async (attempt) => {
    calls.push(attempt)
    return attempt === 1 ? { ok: true, text: '{"sections": ["How do', stopReason: 'max_tokens' } : { ok: true, text: '```\n' + OUTLINE + '\n```' }
  }, 'Title')
  assert.deepEqual(calls, [1, 2])
  assert.equal(out.ok, true)
  assert.equal(out.attempts, 2)
})

test('two failures stop at two calls; the editor shows the plain message', async () => {
  let n = 0
  const logged: string[] = []
  const out = await runOutline(
    async () => {
      n++
      return { ok: true, text: 'Sorry, here are some headings: one, two, three.' }
    },
    'Title',
    (_a, d) => logged.push(d),
  )
  assert.equal(n, 2)
  assert.equal(out.ok, false)
  assert.equal(logged.length, 2)
  // The server log carries the shape, never the reply text.
  assert.ok(logged.every((l) => !l.includes('Sorry')))
  assert.equal(AI_DRAFT_FAILED_MESSAGE, "The AI draft didn't work this time. Your notes are kept — please try again in a minute.")
  const editor = read('components/admin/blog/PostEditor.tsx')
  assert.ok(editor.includes('{AI_DRAFT_FAILED_MESSAGE}'))
  assert.ok(!editor.includes('nothing was written. Your notes are kept. ({genFailed})'))
  assert.ok(read('lib/blogQueueDraft.ts').includes('error: AI_DRAFT_FAILED_MESSAGE'))
})

test('a timeout is not retried (a second try would only time out again)', async () => {
  let n = 0
  const out = await runOutline(async () => {
    n++
    return { ok: false, reason: 'timed out after 30000ms' }
  }, 'T')
  assert.equal(n, 1)
  assert.equal(out.ok, false)
})

test('the outline has room for thinking and asks for low effort first', () => {
  const src = read('lib/ai/blogCopy.ts')
  assert.ok(src.includes("maxTokens: attempt === 1 ? 4000 : 8000"))
  assert.ok(src.includes("effort: 'low'"))
  assert.ok(!src.includes('maxTokens: 900'))
})

test('a draft body never starts with a title (H1) or metadata lines', () => {
  const raw = [
    '---',
    'title: Female teaching jobs',
    '---',
    '# Female teaching and tuition jobs in a city',
    '**Title:** Female teaching jobs',
    'Meta description: How to find them.',
    'Slug: female-teaching-jobs',
    '',
    '## How do I find female tuition jobs?',
    'Start with the city page.',
    '# A stray title later',
  ].join('\n')
  const out = stripDraftHead(raw)
  assert.ok(out.startsWith('## How do I find female tuition jobs?'))
  assert.ok(!/^# /m.test(out))
  assert.ok(!/^(?:\*\*)?(?:title|meta description|slug)/im.test(out))
  const fixed = sanitizeDraft(raw, { blogSlugs: [], audience: 'tutors' })
  assert.ok(!/^#\s/m.test(fixed))
  assert.ok(!fixed.split('\n')[0].toLowerCase().includes('title'))
})

test('a normal section is left as it is', () => {
  const s = '## How do I apply?\n\nOpen the tuition and tap Apply.'
  assert.equal(stripDraftHead(s), s)
})

// ------------------------------------------------------- 2. the queue refresh ---

test('used and staff-dismissed titles stay out; a queue set-aside may return', () => {
  const now = new Date('2026-11-16T03:00:00Z')
  assert.equal(rowOfferable({ status: 'drafted' }, now), false)
  assert.equal(rowOfferable({ status: 'done' }, now), false)
  assert.equal(rowOfferable({ status: 'dismissed', dismiss_reason: 'not relevant' }, now), false)
  assert.equal(rowOfferable({ status: 'dismissed', dismiss_reason: 'auto: not in the current mix' }, now), true)
  assert.equal(rowOfferable({ status: 'snoozed', snooze_until: '2026-12-01T00:00:00Z' }, now), false)
  assert.equal(rowOfferable(undefined, now), true)
})

test('the refresh skips used titles, post duplicates and repeated titles', () => {
  const now = new Date('2026-11-16T03:00:00Z')
  const rows = new Map([
    ['gsc:a', { status: 'drafted', title: 'Home tuition jobs in Lahore' }],
    ['gsc:b', { status: 'dismissed', dismiss_reason: 'too thin', title: 'Online tutor jobs' }],
    ['gsc:c', { status: 'suggested', title: 'Female teaching jobs in Karachi' }],
  ])
  const blocked = blockedTitles(['How to become a home tutor in Pakistan'], [...rows.values()])
  const kept = refreshCandidates(
    [
      { fingerprint: 'gsc:a', title: 'Home tuition jobs in Lahore' },
      { fingerprint: 'gsc:x', title: 'Home Tuition Jobs in Lahore!' }, // same words as a used title
      { fingerprint: 'gsc:b', title: 'Online tutor jobs' },
      { fingerprint: 'gsc:d', title: 'How to become a home tutor in Pakistan' }, // an existing post
      { fingerprint: 'gsc:c', title: 'Female teaching jobs in Karachi' },
      { fingerprint: 'gsc:e', title: 'Female  teaching jobs in Karachi' }, // a duplicate candidate
      { fingerprint: 'gsc:f', title: 'Teaching jobs in Islamabad' },
    ],
    rows,
    blocked,
    now,
  )
  assert.deepEqual(kept.map((k) => k.fingerprint), ['gsc:c', 'gsc:f'])
  assert.equal(normTitle('Grade 9 & 10 — Physics'), 'grade 9 and 10 physics')
})

test('the editor box says when the queue was updated', () => {
  assert.equal(queueUpdatedLabel('2026-11-16T03:00:00Z'), 'Queue updated 16 Nov 2026')
  assert.equal(queueUpdatedLabel(null), 'Queue not updated yet')
  assert.ok(read('components/admin/blog/PostEditor.tsx').includes('queueUpdatedLabel(queueUpdatedAt)'))
  assert.ok(read('lib/contentQueue/build.ts').includes('QUEUE_REBUILT_KEY'))
})

// ---------------------------------------------------- 3. clear mobile verification ---

test('only the Owner may clear a mobile verification', () => {
  assert.equal(canClearMobileVerification('owner'), true)
  for (const role of ALL_STAFF_ROLES) assert.equal(canClearMobileVerification(role), false, role)
  assert.equal(canClearMobileVerification(null), false)
})

test('the route refuses every other role with the blocked-attempt alert', () => {
  const src = read('app/api/admin/tutors/clear-mobile/route.ts')
  assert.ok(src.includes('checkAdminRole(...ALL_STAFF_ROLES)'))
  assert.ok(src.includes('refuseUnlessOwnerModeration('))
  assert.ok(!src.includes("checkAdminRole('owner', 'partner')"))
  // The refusal comes before any read or write.
  assert.ok(src.indexOf('refuseUnlessOwnerModeration(') < src.indexOf('createAdminClient()'))
  assert.ok(read('app/admin/tutors/videos/page.tsx').includes('canClearMobile={canClearMobileVerification(actor.adminRole)}'))
})

// --------------------------------------------------------------- 4. export CSV ---

function queryFromHref(href: string) {
  const url = new URL(href, 'https://x.invalid')
  const sp: Record<string, string> = {}
  url.searchParams.forEach((v, k) => (sp[k] = v))
  return { tab: sp.tab as 'tutors' | 'parents', sp }
}

test('Export CSV runs the SAME query as the list on screen ("Tried to pay")', () => {
  const now = Date.UTC(2026, 10, 16, 6)
  const sp = { tab: 'tutors', stage: 'approved', fu: 'tried', q: 'lahore', n: '50' }
  const page = peopleListQuery('tutors', sp, { showAll: false, showDeleted: false, nowMs: now })
  const href = peopleExportHref('tutors', sp)
  assert.ok(!href.includes('n=50'))
  const back = queryFromHref(href)
  const exp = peopleListQuery(back.tab, back.sp, { showAll: back.sp.all === '1', showDeleted: back.sp.deleted === '1', nowMs: now })
  for (const k of ['list', 'fixed', 'since', 'until', 'q', 'order', 'rowQuery'] as const) assert.deepEqual(exp[k], page[k], k)
  assert.deepEqual(page.rowQuery, [
    { param: 'stages', value: 'approved' },
    { param: 'fus', value: 'tried' },
  ])
})

test('every People view round-trips through the export link', () => {
  const now = Date.UTC(2026, 10, 16, 6)
  const views: Record<string, string>[] = [
    { tab: 'tutors' },
    { tab: 'tutors', stage: 'all' },
    { tab: 'tutors', stage: 'paid', plan: 'premium' },
    { tab: 'tutors', stage: 'missing', fu: 'f2', all: '1' },
    { tab: 'tutors', signed: 'today' },
    { tab: 'tutors', ni: '1' },
    { tab: 'tutors', deleted: '1' },
    { tab: 'parents', posted: 'notposted', pv: 'waiting', q: 'ali' },
  ]
  for (const sp of views) {
    const tab = sp.tab as 'tutors' | 'parents'
    const opts = { showAll: sp.all === '1', showDeleted: sp.deleted === '1', nowMs: now }
    const page = peopleListQuery(tab, sp, opts)
    const back = queryFromHref(peopleExportHref(tab, sp))
    const exp = peopleListQuery(back.tab, back.sp, { showAll: back.sp.all === '1', showDeleted: back.sp.deleted === '1', nowMs: now })
    for (const k of ['list', 'fixed', 'since', 'until', 'q', 'order', 'rowQuery'] as const) assert.deepEqual(exp[k], page[k], `${JSON.stringify(sp)} ${k}`)
  }
})

test('the export route and the page both read lib/peopleListQuery; the button shows the count', () => {
  const route = read('app/api/admin/users/export/route.ts')
  assert.ok(route.includes('peopleListQuery(tab, sp'))
  assert.ok(route.includes('rows: lq.rowQuery'))
  const tabs = read('app/admin/users/PeopleTabs.tsx')
  assert.ok(tabs.includes('peopleListQuery('))
  assert.ok(tabs.includes('`Export CSV (${exportCount})`'))
  assert.ok(tabs.includes('headerFor(res.total)'))
})
