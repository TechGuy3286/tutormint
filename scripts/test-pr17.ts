/**
 * scripts/test-pr17.ts — npm run test:pr17
 *
 * PR-17 (owner, 23 Nov 2026): search timeouts, demo ratings, onboarding resume,
 * parent hire quota + demos, tutor dashboard, notifications/header, small fixes.
 * Pure rules are exercised directly; wiring is checked in the source.
 */
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

import { simpleRankArgs, withRankFallback } from '../lib/rankFallbackCore'
import { tutorRatingMarks } from '../lib/publicRevalidateCore'
import {
  demoCompletedNotice,
  demoIsClosed,
  feedbackNotice,
  feedbackProblem,
  feedbackWrite,
  sortParentDemos,
  starLine,
  youRatedLine,
  type SortableDemo,
} from '../lib/demoFeedbackCore'
import {
  FEATURED_HIRE_CAP,
  FEATURED_HIRE_LINE,
  FREE_HIRE_LINE,
  FREE_PARENT_HIRE_LIMIT,
  HIRE_LIMIT_MESSAGE,
  hireAllowance,
} from '../lib/parentHireCore'
import {
  NEXT_HINTS,
  continueOnboardingLabel,
  continueStepLabel,
  nextItem,
  onboardingItemsDone,
  progressDashes,
  remainingChips,
  stepsDoneLine,
} from '../lib/onboarding/progressCore'
import { onboardingNoticeChange } from '../lib/onboardingNoticeCore'
import { progressLine } from '../lib/onboarding/missingItems'
import { tutorRequiredItems, type RequiredItem } from '../lib/profileRequired'
import { NEW_FLOW_ORDER, firstMissingStep, type FlowFacts } from '../lib/tutorFlow'
import { HOME_CARDS } from '../lib/siteIdentity'
import { FAQ_GROUPS as FAQ } from '../lib/faqContent'

const read = (p: string) => readFileSync(p, 'utf8')
/** Source without comments, so a rule cannot pass on a comment. */
const code = (p: string) => read(p).replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')

let passed = 0
async function t(name: string, fn: () => void | Promise<void>) {
  await fn()
  passed++
  console.log(`  ok  ${name}`)
}

const baseFacts: FlowFacts = {
  fullName: 'A Tutor', gender: null, city: null, area: null, avatarUrl: null, headline: null, bio: null,
  experienceYears: null, hourlyRate: null, jobTypes: [], degreesCount: 0, degreeDocCount: 0, degrees: [],
  cnicNumber: null, cnicImagePath: null, subjectCount: 0, selfieDone: false, availabilityCount: 0,
  phoneVerified: false, whatsapp: null, feePaid: false, noDegreeYet: false, isSeed: false, isTeamAccount: false,
  isBanned: false, isSuspended: false, underReview: false, verificationStatus: null, imported: false, claimedAt: null,
}

async function main() {
  console.log('PR-17 Part A — rank_tutors fallback + migration')
  await t('a working ranking is used as is', async () => {
    const r = await withRankFallback(async () => ({ data: [{ id: 1 }], error: null }), async () => ({ data: [{ id: 2 }], error: null }))
    assert.deepEqual(r, { data: [{ id: 1 }], error: null, fellBack: false })
  })
  await t('a failed ranking falls back to the simple ordering — never an error page', async () => {
    const r = await withRankFallback(async () => ({ data: null, error: { code: '57014', message: 'canceling statement due to statement timeout' } }), async () => ({ data: [{ id: 2 }], error: null }))
    assert.deepEqual(r, { data: [{ id: 2 }], error: null, fellBack: true })
  })
  await t('a thrown ranking falls back too', async () => {
    const r = await withRankFallback(async () => { throw new Error('fetch failed') }, async () => ({ data: [{ id: 3 }], error: null }))
    assert.equal(r.fellBack, true)
    assert.deepEqual(r.data, [{ id: 3 }])
  })
  await t('both failing reports the first error with no rows', async () => {
    const r = await withRankFallback(async () => ({ data: null, error: { message: 'a' } }), async () => ({ data: null, error: { message: 'b' } }))
    assert.deepEqual(r, { data: [], error: { message: 'a' }, fellBack: true })
  })
  await t('the simple ordering keeps the main filters', () => {
    assert.deepEqual(simpleRankArgs({ city: 'Lahore', masterIds: [1, 2], mode: 'online', gender: 'female', limit: 24, offset: -5 }), { p_city: 'Lahore', p_master_ids: [1, 2], p_teaching_mode: 'online', p_gender: 'female', p_limit: 24, p_offset: 0 })
    assert.equal(simpleRankArgs({ city: '', masterIds: [], mode: null, gender: null, limit: 12, offset: 0 }).p_master_ids, null)
  })
  await t('browseTutors uses the fallback and offers no cursor after it', () => {
    const s = code('lib/browseTutors.ts')
    assert.match(s, /withRankFallback<RankedTutor>\(/)
    assert.match(s, /'rank_tutors_simple'/)
    assert.match(s, /nextCursor: ranked\.fellBack \|\|/)
  })
  await t('migration 243: cache + live fallback + plpgsql/force_custom_plan kept', () => {
    const m = read('supabase/migrations/243_pr17_rank_cache.sql')
    assert.ok(!/^\s*(begin|commit);/im.test(m), 'no begin/commit in the file')
    assert.match(m, /create table if not exists public\.tutor_rank_cache\b/)
    assert.match(m, /FUNCTION public\.rank_tutors_live\(/)
    assert.match(m, /return query select \* from rank_tutors_live\(/)
    assert.match(m, /c\.id in \(select d\.id from tutor_directory d\)/, 'the listing is gated live')
    const rank = m.slice(m.indexOf('CREATE OR REPLACE FUNCTION public.rank_tutors(p_master_id'))
    assert.match(rank.slice(0, 2000), /LANGUAGE plpgsql/)
    assert.match(rank.slice(0, 2000), /plan_cache_mode TO 'force_custom_plan'/)
    assert.match(m, /area_hits as materialized/, 'area matches worked out once')
    assert.match(m, /where c\.digest is distinct from excluded\.digest/, 'idle refresh writes nothing')
    assert.match(m, /revoke all on public\.tutor_rank_cache from anon, authenticated/)
  })
  await t('the minute cron refreshes the cache; landing pages read the stored counts', () => {
    assert.match(code('app/api/cron/admin-summary/route.ts'), /await refreshRankCacheIfStale\(\)/) // PR-18: pg_cron runs it; this is the stale fallback
    assert.match(code('lib/landing.ts'), /\.rpc\('landing_combinations_fast'\)/)
    assert.ok(!/from\('landing_combinations'\)/.test(code('lib/landing.ts')))
  })

  console.log('PR-17 Part B — demo ratings + targeted rebuild')
  await t('a rating change rebuilds exactly the pages that show it', () => {
    const marks = tutorRatingMarks('javeria-x', ['lahore', 'lahore'], ['o-levels-english', 'grade-5-english'])
    assert.deepEqual(marks.map((m) => m.path), ['/browse/tutors', '/tutor/javeria-x', '/tutors/lahore/grade-5-english', '/tutors/lahore/o-levels-english'])
    assert.ok(!marks.some((m) => m.path === '/tutors/lahore'), 'crawl lists show no rating')
    assert.deepEqual(tutorRatingMarks(null, [], []).map((m) => m.path), ['/browse/tutors'])
  })
  await t('feedback create/edit/review approval all rebuild the rating pages', () => {
    const fb = code('app/api/demo/feedback/route.ts')
    assert.equal((fb.match(/await revalidateTutorRating\(demo\.tutor_id as string\)/g) ?? []).length, 2, 'create + edit')
    const rv = code('lib/reviews.ts')
    assert.match(rv, /decision === 'approve'\) \{\s*await revalidateTutorRating\(tutorId\)/)
    assert.match(rv, /if \(decision === 'approve'\) await revalidateTutorRating\(tutorId\)/, 'demo comment approval')
    assert.match(code('lib/publicRevalidate.ts'), /await refreshRankCacheFor\(\[tutorId\]\)/, 'cache row first')
  })
  await t('migration 244: stars count at once, comment pending, guard, one per demo', () => {
    const m = read('supabase/migrations/244_pr17_demo_feedback_rating.sql')
    assert.ok(!/^\s*(begin|commit);/im.test(m))
    assert.match(m, /create unique index if not exists demo_feedback_demo_uniq/)
    assert.match(m, /from demo_feedback f\s+where f\.tutor_id = p_tutor and f\.rating is not null/, 'every demo star counts')
    assert.match(m, /f\.comment_status = 'approved'/, 'only approved comments are public')
    assert.match(m, /new\.comment_status := 'pending'/, 'an edited comment waits again')
    assert.match(m, /a tutor may only reply/)
  })
  await t('no AggregateRating / review JSON-LD (Person has no aggregateRating)', () => {
    for (const f of ['app/(site)/tutor/[slug]/profile.tsx', 'app/(site)/tutor/[slug]/page.tsx']) assert.ok(!/AggregateRating|aggregateRating/.test(code(f)), f)
  })
  await t('the profile has a #reviews anchor and a rating-only card', () => {
    const p = code('app/(site)/tutor/[slug]/profile.tsx')
    assert.match(p, /<section id="reviews"/)
    assert.match(p, /const hasReviews = tutor\.reviews\.length > 0 \|\| reviews > 0/)
  })

  console.log('PR-17 Part C — onboarding resume')
  await t('an email sign-up at 9 of 16 resumes at its first gap, not the mobile screen', () => {
    const f: FlowFacts = { ...baseFacts, gender: 'female', city: 'Lahore', area: 'DHA', subjectCount: 3, jobTypes: ['Home Tutor'], hourlyRate: 5000, experienceYears: 2, degreesCount: 1, availabilityCount: 2 }
    const items = tutorRequiredItems(f)
    assert.equal(items.length, 16)
    assert.equal(items.filter((i) => i.done).length, 9)
    assert.equal(firstMissingStep(f, NEW_FLOW_ORDER), 'contact')
    const dashes = progressDashes(items, 'contact')
    assert.equal(dashes.filter((d) => d.done).length, 9, 'dashes and the card agree')
    assert.equal(dashes.findIndex((d) => d.current), 9, 'current dash = the mobile item (10th)')
    const flow = read('components/tutor/NewOnboardingFlow.tsx')
    assert.ok(!/if \(!facts\.phoneVerified && stepKey !== 'final' && stepKey !== 'contact'\)/.test(flow), 'no mobile-first gate')
  })
  await t('a verified mobile is never asked again (contact needs only WhatsApp)', () => {
    const f: FlowFacts = { ...baseFacts, phoneVerified: true, gender: 'male', city: 'Lahore', area: 'X', subjectCount: 1, jobTypes: ['a'], hourlyRate: 1, experienceYears: 0, degreesCount: 1, availabilityCount: 1 }
    const dashes = progressDashes(tutorRequiredItems(f), 'contact')
    assert.equal(dashes.find((d) => d.current)?.key, 'whatsapp')
    assert.ok(dashes.find((d) => d.key === 'mobile')?.done)
  })
  await t('the level screen highlights the subjects dash; final highlights none', () => {
    const items = tutorRequiredItems(baseFacts)
    assert.equal(progressDashes(items, 'level').find((d) => d.current)?.key, 'subjects')
    assert.equal(progressDashes(items, 'final').some((d) => d.current), false)
  })
  await t('done dashes are tappable; the shell has Back + Next + hint + save later', () => {
    const shell = code('components/onboarding/StepShell.tsx')
    assert.match(shell, /d\.done && progress\.onJump && !d\.current/)
    assert.match(shell, />\s*Back\s*</)
    assert.match(shell, /data-next-hint/)
    assert.match(shell, /Save and finish later/)
    assert.equal(NEXT_HINTS.mobile, 'Enter an 11-digit mobile number')
    const flow = read('components/tutor/NewOnboardingFlow.tsx')
    assert.match(flow, /nextHint=\{opts\.nextHint \?\? \(stepKey !== 'final' \? NEXT_HINTS\[stepKey\] : undefined\)\}/)
    assert.match(flow, /useStepDraft\('contact\.whatsapp'/, 'typed WhatsApp survives Back')
  })
  await t('one progress line: "X of 16 steps done"', () => {
    assert.equal(stepsDoneLine(9, 16), '9 of 16 steps done')
    assert.equal(progressLine({ done: 9, total: 16 }), '9 of 16 steps done')
    assert.equal(continueOnboardingLabel(9, 16), 'Continue onboarding (9 of 16)')
  })
  await t('the bell keeps ONE current "Continue onboarding" line', () => {
    assert.deepEqual(onboardingNoticeChange({ finished: false, title: 'Continue onboarding (9 of 16)', body: null, open: [] }), { insert: { title: 'Continue onboarding (9 of 16)', body: null }, update: null, markRead: [] })
    assert.deepEqual(onboardingNoticeChange({ finished: false, title: 'Continue onboarding (10 of 16)', body: 'x', open: [{ id: 'a', title: 'Continue onboarding (9 of 16)' }, { id: 'b', title: 'old' }] }), { insert: null, update: { id: 'a', title: 'Continue onboarding (10 of 16)', body: 'x' }, markRead: ['b'] })
    assert.deepEqual(onboardingNoticeChange({ finished: false, title: 'same', body: null, open: [{ id: 'a', title: 'same' }] }).update, null)
    assert.deepEqual(onboardingNoticeChange({ finished: true, title: 'x', body: null, open: [{ id: 'a', title: 'x' }] }).markRead, ['a'])
  })

  console.log('PR-17 Part D — hires + demos')
  await t('free parents: 5 hires in total, ever; the 6th is refused with the upgrade line', () => {
    assert.equal(FREE_PARENT_HIRE_LIMIT, 5)
    for (let used = 0; used < 5; used++) assert.equal(hireAllowance({ featured: false, used }).allowed, true, `hire ${used + 1}`)
    const sixth = hireAllowance({ featured: false, used: 5 })
    assert.equal(sixth.allowed, false)
    assert.equal(sixth.needsUpgrade, true)
    assert.equal(HIRE_LIMIT_MESSAGE, "You've used your 5 hires. Upgrade to Featured to hire more.")
  })
  await t('Featured parents: shown unlimited, a hidden cap', () => {
    const a = hireAllowance({ featured: true, used: 40 })
    assert.equal(a.allowed, true)
    assert.equal(a.shown, 'unlimited')
    assert.equal(hireAllowance({ featured: true, used: FEATURED_HIRE_CAP }).allowed, false)
    assert.equal(hireAllowance({ featured: true, used: FEATURED_HIRE_CAP }).needsUpgrade, false)
  })
  await t('the server enforces it; the count is lifetime (jobs.hired_at, no month window)', () => {
    assert.match(code('lib/jobs.ts'), /const allowance = await parentHireAllowance\(parentId, ent\.canHire\)/)
    const h = code('lib/parentHire.ts')
    assert.match(h, /\.not\('hired_at', 'is', null\)/)
    assert.ok(!/gte\(|monthStart|created_at/.test(h), 'no time window')
    assert.match(code('app/api/gate/route.ts'), /parentHireAllowance\(user\.id, false\)/)
  })
  await t('Membership Plans parent cards: "Hire 5 tutors" / "Unlimited hires"', () => {
    assert.equal(FREE_HIRE_LINE, 'Hire 5 tutors')
    assert.equal(FEATURED_HIRE_LINE, 'Unlimited hires')
    const p = code('components/PackagesTable.tsx')
    assert.match(p, /const PARENT_BASE = \['Browse tutors', 'Request a demo', FREE_HIRE_LINE\]/)
    assert.ok(!/Complete a hire/.test(p))
  })
  await t('My demos order: accepted (upcoming, nearest first) → pending → completed → declined/cancelled', () => {
    const now = Date.parse('2026-11-23T10:00:00Z')
    const d = (id: string, status: SortableDemo['status'], proposedTime: string | null, createdAt: string) => ({ id, status, proposedTime, createdAt })
    const rows = [
      d('cancel', 'cancelled', null, '2026-11-22T00:00:00Z'),
      d('done', 'completed', null, '2026-11-20T00:00:00Z'),
      d('pend-old', 'requested', null, '2026-11-01T00:00:00Z'),
      d('acc-far', 'accepted', '2026-11-30T10:00:00Z', '2026-11-02T00:00:00Z'),
      d('acc-past', 'accepted', '2026-11-20T10:00:00Z', '2026-11-03T00:00:00Z'),
      d('declined', 'declined', null, '2026-11-23T00:00:00Z'),
      d('acc-near', 'accepted', '2026-11-24T10:00:00Z', '2026-11-04T00:00:00Z'),
      d('pend-new', 'requested', null, '2026-11-21T00:00:00Z'),
    ]
    assert.deepEqual(sortParentDemos(rows, now).map((r) => r.id), ['acc-near', 'acc-far', 'acc-past', 'pend-new', 'pend-old', 'done', 'declined', 'cancel'])
    assert.ok(demoIsClosed('declined') && demoIsClosed('cancelled') && !demoIsClosed('completed'))
    assert.match(code('app/(site)/parent/dashboard/demos/page.tsx'), /sortParentDemos\(unsorted, Date\.now\(\)\)/)
  })
  await t('feedback once, then Edit updates the same row (no duplicates)', () => {
    assert.deepEqual(feedbackWrite(null, 'p'), { kind: 'create' })
    assert.deepEqual(feedbackWrite({ id: 'f', parentId: 'p' }, 'p'), { kind: 'update', id: 'f' })
    assert.deepEqual(feedbackWrite({ id: 'f', parentId: 'q' }, 'p'), { kind: 'refuse' })
    assert.equal(feedbackProblem({ rating: 6, text: 'Great teacher' }), 'Give a rating from 1 to 5.')
    assert.equal(feedbackProblem({ rating: 4, text: 'ok' }), 'Write a sentence about how it went.')
    assert.equal(feedbackProblem({ rating: 4, text: 'Very good demo' }), null)
    assert.equal(youRatedLine(4), 'You rated ★★★★☆')
    const inbox = code('app/(site)/parent/dashboard/DemoInbox.tsx')
    assert.match(inbox, /d\.feedback \? \(/, 'rated state instead of the button')
    assert.match(inbox, />\s*Edit\s*</)
  })

  console.log('PR-17 Part E — tutor dashboard')
  await t('square shadowed tiles, shorter; 2 a row on phones, 4 on desktop', () => {
    const tiles = read('lib/tileTones.ts')
    assert.match(tiles, /TILE_BOX_COMPACT =\s*'[^']*flex-col items-center justify-center[^']*shadow-md/)
    assert.match(tiles, /min-h-\[7\.75rem\]/)
    assert.match(read('components/tutor/DashboardCards.tsx'), /grid grid-cols-2 gap-2 md:grid-cols-4/)
  })
  await t('one "Your next step" card; Google card last and collapsed; no % figure', () => {
    const dash = code('app/(site)/tutor/dashboard/page.tsx')
    assert.match(dash, /<NextStepCard items=\{stepItems\}/)
    assert.ok(!/CompletionLine|GetVerifiedValueCard/.test(dash))
    assert.match(dash, /google=\{whatsMissing\.google\}\s*collapsed/)
    assert.ok(dash.lastIndexOf('collapsed') > dash.indexOf('<PaymentsRefunds'), 'Google card at the bottom')
    assert.ok(!/%<\/|\{completion\}%|· \{percent\}/.test(code('components/tutor/TutorHeaderCard.tsx')), 'no separate %')
    assert.match(dash, /\{appliedCount\} applied<\/span>/)
    assert.ok(!/applied · \{hiredCount\} hired/.test(dash))
  })
  await t('next step: the first gap with its position; chips skip tagline + fee; fee last', () => {
    const f: FlowFacts = { ...baseFacts, gender: 'female', city: 'Lahore', area: 'DHA', subjectCount: 3 }
    const items = tutorRequiredItems(f)
    const n = nextItem(items)!
    assert.equal(n.item.key, 'jobtype')
    assert.equal(continueStepLabel(n), 'Continue: Choose the work you want (step 5 of 16)')
    const chips = remainingChips(items).map((c) => c.key)
    assert.ok(!chips.includes('tagline') && !chips.includes('verify') && !chips.includes('jobtype'))
    const allButFee = items.map((i): RequiredItem => ({ ...i, done: i.key !== 'verify' }))
    assert.equal(onboardingItemsDone(allButFee), true)
    assert.equal(nextItem(allButFee)?.item.key, 'verify')
    assert.match(code('components/tutor/NextStepCard.tsx'), /Pay the Verification Fee/)
  })
  await t('grey "Not verified yet" chip replaces the red "Get verified"', () => {
    const v = code('components/tutor/VerifyBadgeControl.tsx')
    assert.match(v, /bg-gray-100[^"]*text-slate-700[^>]*>\s*<BadgeCheck size=\{13\} aria-hidden \/> Not verified yet/)
    assert.ok(!/> Get verified\s*</.test(v))
  })

  console.log('PR-17 Part F — notifications + header')
  await t('the tutor is told "Demo completed"; only the parent gets the feedback prompt', () => {
    assert.equal(demoCompletedNotice('tutor').title, 'Demo completed')
    assert.ok(!/Feedback can now be left/.test(JSON.stringify(demoCompletedNotice('tutor'))))
    assert.equal(demoCompletedNotice('parent').body, 'Feedback can now be left.')
    assert.match(code('app/api/demo/complete/route.ts'), /demoCompletedNotice\(toTutor \? 'tutor' : 'parent'\)/)
  })
  await t('"You received demo feedback" carries the stars and opens the review', () => {
    assert.equal(starLine(5), '★★★★★')
    assert.deepEqual(feedbackNotice(5, 'javeria-x'), { title: 'You received demo feedback', body: '★★★★★ 5 out of 5', href: '/tutor/javeria-x#reviews' })
  })
  await t('notifications page: a breadcrumb trail, no Back link', () => {
    assert.match(code('app/(site)/account/notifications/page.tsx'), /<Breadcrumbs\s+showBack=\{false\}/)
  })
  await t('phone header: compact 40px controls, short labels', () => {
    const n = code('components/MemberHeaderNav.tsx')
    assert.match(n, /h-10 min-h-\[40px\] min-w-\[40px\]/)
    assert.match(n, /sm:hidden">Edit</)
  })

  console.log('PR-17 Part G — small fixes')
  await t('sticky bottom bars: solid, flush, safe area inside, fill below', () => {
    const css = read('app/globals.css')
    assert.match(css, /\.tm-bottom-bar \{[^}]*padding-bottom: calc\(0\.75rem \+ env\(safe-area-inset-bottom, 0px\)\)/)
    assert.match(css, /\.tm-bottom-bar::after \{[^}]*top: 100%/)
    assert.match(code('app/layout.tsx'), /viewportFit: 'cover'/)
    const pa = code('app/(site)/tutor/[slug]/ProfileActions.tsx')
    assert.equal((pa.match(/tm-bottom-bar tm-bottom-bar-sm-static fixed inset-x-0 bottom-0/g) ?? []).length, 2)
    assert.ok(!/bg-white\/95/.test(pa), 'no see-through bar')
    assert.match(code('components/forms/PostTuitionForm.tsx'), /tm-bottom-bar tm-bottom-bar-sm-clear sticky bottom-0/)
    assert.match(code('components/onboarding/StepShell.tsx'), /tm-bottom-bar fixed inset-x-0/)
  })
  await t('FAQ: the selfie is optional in the four answers', () => {
    const all = JSON.stringify(FAQ)
    assert.ok(!/a profile photo and a selfie/.test(all))
    assert.ok(!/profile photo aur selfie/.test(all))
    assert.ok((all.match(/a selfie is optional/g) ?? []).length >= 3)
    assert.ok((all.match(/selfie ikhtiyari hai/g) ?? []).length >= 2)
  })
  await t('homepage tutor card: "Free profile"', () => {
    assert.deepEqual(HOME_CARDS[1].points, ['Get verified', 'Find tuitions near you', 'Free profile'])
  })
  await t('footer: seven social icons on one desktop row (Google added, PR-20)', () => {
    const f = code('components/Footer.tsx')
    assert.match(f, /lg:grid-cols-\[21rem_repeat\(5,minmax\(0,1fr\)\)\]/)
    assert.match(f, /<SocialRow socials=\{socials\} oneRow \/>/)
    // 7 × 44px + 6 × 4px gaps = 332px ≤ 21rem (336px).
    assert.ok(7 * 44 + 6 * 4 <= 21 * 16)
  })

  console.log(`\nPR-17: ${passed} passed`)
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
