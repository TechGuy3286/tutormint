// npm run test:sitespeed — speed, caching, private documents, the share message,
// the female title and the Search Console re-check (owner, 28 Oct 2026).
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { previewSrc, previewWidth, PREVIEW_WIDTHS } from '../lib/docPreviewSize'
import { fillShareMessage, shareMessageHref, shareSubjectsLine, PROFILE_SHARE_DEFAULT } from '../lib/profileShareCore'
import { femalePageTitle } from '../lib/femaleJobsCore'
import { needsFreshCheck, tutorSideFirst } from '../lib/contentQueue/searchTopics'
import { SHARE_GROUP, templateSaveCheck } from '../lib/templateRules'

const src = (f: string) => readFileSync(f, 'utf8')

test('Speed Insights is in the root layout', () => {
  const layout = src('app/layout.tsx')
  assert.match(layout, /import \{ SpeedInsights \} from '@vercel\/speed-insights\/next'/)
  assert.match(layout, /<SpeedInsights \/>/)
})

test('cached public reads are cleared when their data changes', () => {
  // Landing pages + sitemap share ONE live cache entry, tagged and cleared by
  // revalidateLanding() on every listing change.
  const landing = src('lib/landing.ts')
  assert.match(landing, /const liveCombinationsShared = unstable_cache\(/)
  assert.match(landing, /tags: \[LANDING_TAG\]/)
  assert.match(landing, /const all = await liveCombinationsForPages\(\)/)
  assert.match(src('lib/sitemaps.ts'), /liveCombinationsForPages\(\)/)
  assert.match(src('lib/landingRevalidate.ts'), /revalidateTag\(LANDING_TAG/)
  // Tuition pages: the repeat check is cached under TUITION_TAG, cleared on
  // every tuition change through the Indexing API helpers.
  const dup = src('lib/duplicates.ts')
  assert.match(dup, /unstable_cache\(repeatOfOlderOpenFresh, \[[^\]]+\], \{ revalidate: TUITION_REVALIDATE, tags: \[TUITION_TAG\] \}\)/)
  assert.match(src('lib/landingRevalidate.ts'), /revalidateTag\(TUITION_TAG/)
  const idx = src('lib/googleIndexing.ts')
  const upd = idx.slice(idx.indexOf('export function queueIndexingUpdate'), idx.indexOf('export function queueIndexingForStatus'))
  assert.match(upd, /revalidateTuitions\(\)/)
  const st = idx.slice(idx.indexOf('export function queueIndexingForStatus'))
  assert.match(st.slice(0, 300), /revalidateTuitions\(\)/)
  // Read once per request (metadata + body).
  assert.match(src('lib/jobFeed.ts'), /export const jobByPublicSlug = cache\(/)
})

test('private documents are never public', () => {
  const route = src('app/api/documents/[id]/preview/route.ts')
  assert.match(route, /'Cache-Control': 'private, no-store'/)
  assert.match(route, /documentServable\(/)
  // Only fixed widths; anything else is the stored preview.
  assert.deepEqual([...PREVIEW_WIDTHS], [160, 320, 640])
  assert.equal(previewWidth('320'), 320)
  assert.equal(previewWidth('333'), null)
  assert.equal(previewWidth('99999'), null)
  assert.equal(previewWidth(null), null)
  assert.equal(previewSrc('abc', { width: 640 }), '/api/documents/abc/preview?w=640')
  // Next's image optimiser only ever fetches PUBLIC storage objects.
  const cfg = src('next.config.ts')
  assert.match(cfg, /pathname: '\/storage\/v1\/object\/public\/\*\*'/)
  assert.doesNotMatch(cfg, /identity-docs|payment-proofs|message-media/)
  // No next/image is pointed at the document route.
  for (const f of ['components/SecureDocumentPreview.tsx', 'components/admin/DocumentThumb.tsx', 'components/admin/DocumentViewer.tsx']) {
    assert.doesNotMatch(src(f), /from 'next\/image'/, f)
  }
})

test('share message: verified, unverified, and with the staff ref', () => {
  const link = 'https://www.tutormint.org/tutor/sara-khan-tutor'
  const v = fillShareMessage(PROFILE_SHARE_DEFAULT, { name: 'Sara Khan', city: 'Lahore', subjects: ['English', 'Mathematics'], link, verified: true })
  assert.equal(v, `Meet Sara Khan, a verified tutor in Lahore for English and Mathematics.\nSee the profile:\n${link}`)
  const u = fillShareMessage(PROFILE_SHARE_DEFAULT, { name: 'Sara Khan', city: 'Lahore', subjects: ['English'], link, verified: false })
  assert.equal(u, `Meet Sara Khan, a tutor in Lahore for English.\nSee the profile:\n${link}`)
  assert.doesNotMatch(u, /verified/i)
  // Missing city / subjects drop their words cleanly.
  assert.equal(
    fillShareMessage(PROFILE_SHARE_DEFAULT, { name: 'Ali', city: null, subjects: [], link, verified: false }),
    `Meet Ali, a tutor.\nSee the profile:\n${link}`,
  )
  assert.equal(shareSubjectsLine(['A', 'B', 'C', 'D']), 'A, B, C and more')
  // The staff ref rides on the link inside the message.
  const href = shareMessageHref({ url: link, message: v }, 'AQSA')!
  assert.match(href, /^https:\/\/api\.whatsapp\.com\/send\?text=/)
  const text = decodeURIComponent(href.split('text=')[1])
  assert.match(text, /Meet Sara Khan, a verified tutor/)
  assert.match(text, /tutor\/sara-khan-tutor\?ref=AQSA/)
  // No ref for a sender without a code; no link when the profile is not public.
  assert.doesNotMatch(decodeURIComponent(shareMessageHref({ url: link, message: v }, null)!), /ref=/)
  assert.equal(shareMessageHref({ url: null, message: null }, 'AQSA'), null)
  // The button uses it.
  assert.match(src('components/admin/ProfileShareButtons.tsx'), /shareMessageHref\(share, refCode\)/)
})

test('share template is editable with its own placeholders', () => {
  assert.equal(SHARE_GROUP[0].key, 'profile_share')
  assert.equal(templateSaveCheck('profile_share', PROFILE_SHARE_DEFAULT).ok, true)
  const bad = templateSaveCheck('profile_share', 'Meet {tutor_nam}')
  assert.equal(bad.ok, false)
  assert.match(src('supabase/migrations/214_profile_share_template.sql'), /on conflict \(key\) do nothing/)
})

test('female jobs title', () => {
  assert.equal(femalePageTitle('Lahore'), 'Female Teaching Jobs in Lahore | TutorMint')
  assert.equal(femalePageTitle('Karachi'), 'Female Teaching Jobs in Karachi | TutorMint')
})

test('Search Console access is re-checked fresh, never an old stored error', () => {
  assert.equal(needsFreshCheck({ status: 'error' }, true, true), true)
  assert.equal(needsFreshCheck(null, true, true), true)
  assert.equal(needsFreshCheck({ status: 'ok' }, true, true), false)
  assert.equal(needsFreshCheck({ status: 'error' }, true, false), false, 'no credentials: nothing to ask')
  const server = src('lib/contentQueue/searchTopicsServer.ts')
  assert.match(server, /if \(needsFreshCheck\(api, opts\.recheck !== false, searchConsoleConfigured\(\)\)\) \{\s*await refreshSearchConsole\(\)/)
  // "Rebuild now" reads Google first.
  assert.match(src('lib/contentQueue/build.ts'), /await refreshSearchConsole\(\)/)
})

test('"Other topics" list tutor-side topics first', () => {
  const rows = [
    { id: 1, audience: 'parents', cluster: 'cost-hiring' },
    { id: 2, audience: 'both', cluster: 'tutor-career' },
    { id: 3, audience: 'tutors', cluster: 'subject-guides' },
    { id: 4, audience: 'both', cluster: 'boards-exams' },
  ]
  assert.deepEqual(tutorSideFirst(rows).map((r) => r.id), [2, 3, 1, 4])
  assert.match(src('app/admin/blog/queue/page.tsx'), /content=\{tutorSideFirst\(/)
})

test('every admin list pages 25 at a time with Load more', () => {
  for (const f of [
    'app/admin/follow-ups/page.tsx',
    'app/admin/paid-tutors/page.tsx',
    'app/admin/overview/todo-unmet/page.tsx',
    'app/admin/finance/settlement/SettlementsBoard.tsx',
  ]) {
    assert.match(src(f), /LoadMoreLink/, f)
  }
  assert.match(src('app/admin/finance/settlement/SettlementTab.tsx'), /pageSlice\(allItems\.filter/)
  assert.doesNotMatch(src('app/admin/finance/settlement/SettlementsBoard.tsx'), /financeCounts\(items\)/)
  for (const f of ['app/admin/jobs/page.tsx', 'app/api/admin/jobs/route.ts']) assert.match(src(f), /const PAGE_SIZE = ADMIN_PAGE_SIZE/, f)
})

test('the landing near-duplicate check is cached, and profile saves no longer clear the landing cache', () => {
  const o = src('lib/landingOverlap.ts')
  assert.match(o, /unstable_cache\(loadLandingMembers, \[[^\]]+\], \{ revalidate: LANDING_LIVE_REVALIDATE, tags: \[LANDING_TAG, TUITION_TAG\] \}\)/)
  assert.match(o, /overlapNoindexSet\(await membersForRequest\(\)\)/)
  assert.doesNotMatch(src('lib/completion.ts'), /revalidateLanding\(\)/)
  // Listing changes still clear it at once.
  assert.match(src('app/api/admin/tutors/moderate/route.ts'), /revalidateLanding\(\)/)
  assert.match(src('lib/jobs.ts'), /revalidateLanding\(\)/)
})
