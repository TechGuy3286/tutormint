/**
 * scripts/test-pr15.ts — PR-15: Vercel cost cuts, English-only plan badges,
 * tutor profile polish, footer tidy, admin text fixes. Pure checks and source
 * checks; reads no database.
 *   npm run test:pr15
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { groupLevels, shortLevelName, firstN } from '../lib/levelGroupCore'
import { tuitionMarks, tutorListingMarks, areaMarks, tutorProfileMarks, pathOfUrl, eventRebuildsProfile, PUBLIC_REVALIDATE } from '../lib/publicRevalidateCore'
import { inboxCronDue, INBOX_CRON_INTERVAL_MS, pkDayKeyOf } from '../lib/interestInboxCore'
import { insightsRunDue, INSIGHTS_TODAY_MAX_AGE_MS } from '../lib/insightsCore'
import { footerColumns, FOOTER_CITY_MAX } from '../lib/footerLinksCore'
import { feeFromLabel, feeFromLabelOf } from '../lib/fee'
import { CACHE_SITEMAP, CACHE_PUBLIC_LIST } from '../lib/publicCacheCore'

const read = (p: string) => readFileSync(p, 'utf8')
const S = (...labels: string[]) => labels.map((label, i) => ({ label, masterId: i + 1 }))
const PRE = 'Pre - Primary / Pre - School'

// ----------------------------------------------------------- grade grouping ---

test('C8: consecutive grades with the same subjects become one row', () => {
  const prim = S('English', 'Mathematics', 'Urdu')
  const g = groupLevels([
    { category: PRE, level: 'Pre Nursery / Play Group / KG I', subjects: S('English', 'Urdu'), masterId: 1 },
    { category: PRE, level: 'Nursery / KG - II', subjects: S('Urdu', 'English'), masterId: 2 },
    { category: PRE, level: 'Prep / KG- III', subjects: S('English', 'Urdu'), masterId: 3 },
    ...[1, 2, 3, 4, 5].map((n) => ({ category: 'Primary', level: `Grade ${n}`, subjects: prim, masterId: 10 + n })),
    ...['Grade 9 - Arts', 'Grade 10 - Arts', 'Grade 9 - Science', 'Grade 10 - Science'].map((level, i) => ({ category: 'Matriculation / Secondary', level, subjects: S('Mathematics'), masterId: 30 + i })),
  ])
  assert.deepEqual(g.map((x) => x.label), ['Pre-nursery – Prep', 'Grade 1 – 5', 'Grade 9 – 10 (Arts and Science)'])
  assert.equal(g[1].masterId, 11, 'chips link to the first level of the row')
})

test('C8: a gap or a different subject list splits the row', () => {
  const a = S('English')
  const b = S('English', 'Mathematics')
  const g = groupLevels([
    { category: 'Primary', level: 'Grade 1', subjects: a, masterId: 1 },
    { category: 'Primary', level: 'Grade 2', subjects: b, masterId: 2 },
    { category: 'Primary', level: 'Grade 3', subjects: b, masterId: 3 },
    { category: 'Primary', level: 'Grade 5', subjects: b, masterId: 5 },
  ])
  assert.deepEqual(g.map((x) => x.label), ['Grade 1', 'Grade 2 – 3', 'Grade 5'])
})

test('C8: Arts and Science stay apart when their subjects differ', () => {
  const g = groupLevels([
    { category: 'Matriculation / Secondary', level: 'Grade 9 - Arts', subjects: S('Urdu'), masterId: 1 },
    { category: 'Matriculation / Secondary', level: 'Grade 9 - Science', subjects: S('Physics'), masterId: 2 },
    { category: 'Matriculation / Secondary', level: 'Grade 10 - Science', subjects: S('Physics'), masterId: 3 },
  ])
  assert.deepEqual(g.map((x) => x.label), ['Grade 9 (Arts)', 'Grade 9 – 10 (Science)'])
})

test('C8: short, normal-case level names; never all caps', () => {
  assert.equal(shortLevelName(PRE, 'Pre Nursery / Play Group / KG I'), 'Pre-nursery')
  assert.equal(shortLevelName(PRE, 'PRE NURSERY / PLAY GROUP / KG I'), 'Pre-nursery')
  assert.equal(shortLevelName(PRE, 'Nursery / KG - II'), 'Nursery')
  assert.equal(shortLevelName(PRE, 'Prep / KG- III'), 'Prep')
  assert.equal(shortLevelName('IGCSE', 'O Levels'), 'O Level')
  assert.equal(shortLevelName('Intermediate', 'FSC Part I & Part II'), 'FSc')
  assert.equal(shortLevelName('Teaching of Holy Quran', 'Teaching of Holy Quran'), 'Holy Quran')
  assert.equal(shortLevelName('BS (4 Years)', 'Semester 1 - 8'), 'BS')
  assert.equal(shortLevelName('IB', 'PYP'), 'IB PYP')
  assert.equal(shortLevelName('Primary', 'GRADE 4'), 'Grade 4')
  const leaf = groupLevels([{ category: 'Test Preparations', level: 'All Tests', subjects: [], masterId: 9 }])
  assert.deepEqual(leaf.map((x) => [x.label, x.leaf]), [['Test preparation', true]])
  const prof = read('app/(site)/tutor/[slug]/profile.tsx')
  assert.match(prof, /groupLevels\(/)
  assert.doesNotMatch(prof.slice(prof.indexOf('Subjects and levels')), /uppercase/, 'no all-caps level labels')
})

// --------------------------------------------------------------- badge row ---

test('B: Premium and Featured badges are English only, same shell as Verified', () => {
  for (const f of ['components/badges/PremiumBadge.tsx', 'components/badges/FeaturedBadge.tsx']) {
    const s = read(f)
    assert.doesNotMatch(s, /urdu=/, `${f}: no Urdu label`)
    assert.match(s, /<BadgeBase/)
  }
  for (const dir of ['app', 'components', 'lib']) {
    // The two Urdu badge words appear nowhere as a badge label.
    for (const f of ['components/badges/PremiumBadge.tsx', 'components/badges/FeaturedBadge.tsx', 'components/badges/BadgeRow.tsx']) {
      assert.doesNotMatch(read(f), /پریمیم|نمایاں/, `${dir}: ${f}`)
    }
  }
})

test('C1: one badge row on the profile and the Browse card — no CNIC chip, no FEATURED pill', () => {
  for (const f of ['app/(site)/tutor/[slug]/profile.tsx', 'components/TutorCard.tsx']) {
    const s = read(f)
    assert.doesNotMatch(s, /<CnicVerifiedChip/, f)
    assert.doesNotMatch(s, /<FeaturedTag/, f)
    assert.match(s, /<BadgeRow/, f)
  }
  assert.doesNotMatch(read('components/badges/FeaturedTag.tsx'), /uppercase/, 'the tuition-card tag is not all caps either')
})

// ---------------------------------------------------- job titles and fee etc ---

test('C2: job titles — first 5, then "+N more" in place', () => {
  assert.deepEqual(firstN(['a', 'b', 'c', 'd', 'e', 'f', 'g'], 5), { shown: ['a', 'b', 'c', 'd', 'e'], more: ['f', 'g'] })
  const chips = read('components/ExpandableChips.tsx')
  assert.match(chips, /'use client'/)
  assert.match(chips, /\+\{more\} more/)
  assert.match(chips, /min-h-\[44px\]/, 'a real tap target')
  assert.match(read('app/(site)/tutor/[slug]/profile.tsx'), /<ExpandableChips items=\{\(tutor\.job_types \?\? \[\]\)[^}]*\} max=\{5\}/)
})

test('C3/C4/C5: "No reviews yet", "From Rs X / month", no Back link', () => {
  const prof = read('app/(site)/tutor/[slug]/profile.tsx')
  assert.doesNotMatch(prof, /New tutor/)
  assert.doesNotMatch(read('components/TutorCard.tsx'), />New tutor</)
  // PR-19: "No reviews yet" now comes from the shared RatingStars (lib/ratingStarsCore).
  assert.match(prof, /<RatingStars rating={rating} count={reviews}/)
  assert.match(read('lib/ratingStarsCore.ts'), /No reviews yet/)
  assert.equal(feeFromLabel(10000, 100000), 'From Rs 10,000 / month')
  assert.equal(feeFromLabel(null, 8000), 'From Rs 8,000 / month')
  assert.equal(feeFromLabel(null, null), null)
  assert.equal(feeFromLabelOf({ hourly_rate_pkr: 5000 }), 'From Rs 5,000 / month')
  assert.match(prof, /feeFromLabelOf\(tutor\)/)
  assert.match(prof, /<Breadcrumbs[\s\S]{0,120}showBack=\{false\}/)
})

test('C6: actions — sticky bar on phones, under the top card from sm up', () => {
  const prof = read('app/(site)/tutor/[slug]/profile.tsx')
  const header = prof.indexOf('-- header ---')
  const island = prof.indexOf('<ProfileActionsIsland')
  const contact = prof.indexOf('<TutorContactBox')
  assert.ok(header > 0 && island > header && island < contact, 'right after the top card')
  assert.equal(prof.split('<ProfileActionsIsland').length - 1, 1, 'rendered once')
  const bar = read('app/(site)/tutor/[slug]/ProfileActions.tsx')
  assert.equal(bar.split('fixed inset-x-0 bottom-0 z-30').length - 1, 2, 'fixed at the bottom on phones (both bars)')
  assert.equal(bar.split('sm:static sm:rounded-2xl').length - 1, 2, 'in the page flow from sm')
})

test('C7/C9/C10: join-free contact, one line for empty cards, photo links', () => {
  const viewer = read('components/viewer/TutorViewer.tsx')
  assert.match(viewer, /Join free to contact/)
  assert.match(viewer, /authHref\('\/register', `\/tutor\/\$\{slug\}`, 'parent'\)/)
  const prof = read('app/(site)/tutor/[slug]/profile.tsx')
  assert.match(prof, /<TutorContactBox tutorName=\{tutor\.full_name\} slug=\{tutor\.slug\} \/>/)
  assert.match(prof, /!hasAvailability && !hasReviews \?/)
  const rel = read('components/seo/RelatedTutorLinks.tsx')
  assert.match(rel, /<Avatar /)
  assert.match(rel, /<VerifiedBadge /)
  assert.match(read('lib/tutorCrawl.ts'), /avatar_url/)
})

test('C11: the profile JSON-LD is unchanged in shape', () => {
  const prof = read('app/(site)/tutor/[slug]/profile.tsx')
  assert.match(prof, /indexable && !preview\s*\?\s*tutorProfileJsonLd\(/)
})

// ------------------------------------------------------------------ footer ---

test('D: footer — every link once; city columns over one set of cities', () => {
  const cities = ['Lahore', 'Karachi', 'Islamabad', 'Rawalpindi', 'Peshawar', 'Multan'].map((c) => ({ city: c, citySlug: c.toLowerCase(), href: `/tuition-jobs/${c.toLowerCase()}` }))
  const female = [
    { label: 'x', href: '/tuition-jobs/karachi/female' },
    { label: 'x', href: '/tuition-jobs/lahore/female' },
    { label: 'x', href: '/tuition-jobs/multan/female' },
  ]
  const { main, cities: cc } = footerColumns(cities, female)
  const all = [...main, ...cc].flatMap((c) => c.links)
  const hrefs = all.filter((l) => !l.memberDashboard).map((l) => l.href)
  assert.equal(new Set(hrefs).size, hrefs.length, 'no href twice')
  for (const label of ['Sign Up', 'Login', 'Dashboard', 'Membership Plans']) {
    assert.equal(all.filter((l) => l.label === label).length, 1, `${label} once`)
  }
  assert.equal(cc[0].links.length, FOOTER_CITY_MAX)
  assert.deepEqual(cc[1].links.map((l) => l.label), ['Female teaching jobs in Lahore', 'Female teaching jobs in Karachi'], 'only cities in the city column, in its order')
  assert.deepEqual(footerColumns([], []).cities, [])
  const footer = read('components/Footer.tsx')
  assert.match(footer, /whitespace-nowrap/)
  assert.match(read('components/FooterTagline.tsx') + read('lib/siteIdentity.ts'), /Free to join\. Verified tutors\. Contact tutors directly\./)
})

// ----------------------------------------------------------- revalidation ---

test('A1: on-demand marks — a change rebuilds its own pages only', () => {
  const t = tuitionMarks({ public_slug: 'maths-tutor-abc', city: 'Lahore' })
  assert.deepEqual(t.map((m) => m.path), ['/tuitions/lahore/maths-tutor-abc', '/tuition-jobs/lahore', '/tuition-jobs/school/[school]', '/browse/tuitions', '/'])
  assert.ok(!tutorListingMarks().some((m) => m.path === '/tutor/[slug]'), 'a listing change does not rewrite every profile')
  assert.ok(tutorListingMarks().some((m) => m.path === '/browse/tutors'))
  assert.deepEqual(areaMarks(), [{ path: '/tuition-jobs/[city]', type: 'layout' }])
  assert.deepEqual(tutorProfileMarks('ali-tutor'), [{ path: '/tutor/ali-tutor' }])
  assert.deepEqual(tutorProfileMarks(null), [])
  assert.equal(pathOfUrl('https://www.tutormint.org/tuitions/lahore/x'), '/tuitions/lahore/x')
  assert.equal(pathOfUrl('not a url'), null)
  for (const e of ['message_sent', 'application_submitted', 'login', 'shortlist_added', 'payment_submitted']) assert.equal(eventRebuildsProfile(e), false, e)
  for (const e of ['profile_updated', 'subjects_changed', 'verification_fee_paid', 'plan_expired', 'suspended', 'review_approved']) assert.equal(eventRebuildsProfile(e), true, e)
})

test('A1: safety-net time limits are hours, not minutes', () => {
  const want: [string, number][] = [
    ['app/(site)/tutor/[slug]/page.tsx', PUBLIC_REVALIDATE.entity],
    ['app/(site)/tuitions/[city]/[slug]/page.tsx', PUBLIC_REVALIDATE.entity],
    ['app/(site)/tutors/[city]/[subject]/page.tsx', PUBLIC_REVALIDATE.entity],
    ['app/(site)/tutors/[city]/female/page.tsx', PUBLIC_REVALIDATE.entity],
    ['app/(site)/tuition-jobs/[city]/[variant]/page.tsx', PUBLIC_REVALIDATE.entity],
    ['app/(site)/tuition-jobs/school/[school]/page.tsx', PUBLIC_REVALIDATE.entity],
    ['app/(site)/blog/[slug]/page.tsx', PUBLIC_REVALIDATE.entity],
    ['app/(site)/tuition-jobs/[city]/page.tsx', PUBLIC_REVALIDATE.hub],
    ['app/(site)/tutors/[city]/page.tsx', PUBLIC_REVALIDATE.hub],
    ['app/(site)/blog/page.tsx', PUBLIC_REVALIDATE.hub],
    ['app/(site)/browse/tutors/page.tsx', PUBLIC_REVALIDATE.browse],
    ['app/(site)/browse/tuitions/page.tsx', PUBLIC_REVALIDATE.browse],
    ['app/(site)/faq/page.tsx', PUBLIC_REVALIDATE.static],
    ['app/api/search/words/route.ts', PUBLIC_REVALIDATE.api],
  ]
  for (const [f, n] of want) {
    const m = /export const revalidate = (\d+)/.exec(read(f))
    assert.ok(m, f)
    assert.equal(Number(m![1]), n, f)
    assert.ok(n >= 3600, `${f}: at least an hour`)
  }
})

test('A1: the nightly sweeps rebuild what they change; sitemaps hourly at the CDN', () => {
  assert.match(read('lib/tuitionPause.ts'), /ids\.push\(j\.id\)\s*\n\s*\/\/[^\n]*\n\s*revalidatePublicTuition\(j\)/)
  assert.match(read('lib/googleIndexing.ts'), /for \(const u of urls\) revalidatePublicUrl\(u\)/)
  for (const f of ['sitemap.xml', 'sitemap-blog.xml', 'sitemap-pages.xml', 'sitemap-tuitions.xml', 'sitemap-tutors.xml']) {
    const s = read(`app/${f}/route.ts`)
    assert.match(s, /'cache-control': CACHE_SITEMAP/, f)
    assert.doesNotMatch(s, /no-store/, f)
  }
  assert.match(CACHE_SITEMAP, /s-maxage=3600/)
  assert.match(CACHE_PUBLIC_LIST, /s-maxage=\d+, stale-while-revalidate=\d+/)
  for (const f of ['app/api/blog/list/route.ts', 'app/api/onboarding/areas/route.ts', 'app/api/browse/cities/route.ts', 'app/api/search/words/route.ts', 'app/api/payments/methods/route.ts']) {
    assert.match(read(f), /'Cache-Control': CACHE_PUBLIC_(LIST|SWITCH)/, f)
  }
})

// ------------------------------------------------------------------- crons ---

test('A2: the inbox cron rebuilds every 10 minutes, skips otherwise', () => {
  const now = Date.parse('2026-11-22T10:00:00Z')
  const day = pkDayKeyOf(now)
  assert.equal(INBOX_CRON_INTERVAL_MS, 10 * 60 * 1000)
  assert.equal(inboxCronDue(null, now), true, 'nothing stored')
  assert.equal(inboxCronDue({ builtAt: new Date(now - 60_000).toISOString(), pkDay: day }, now), false, 'a minute old: skip')
  assert.equal(inboxCronDue({ builtAt: new Date(now - 9 * 60_000).toISOString(), pkDay: day }, now), false, '9 minutes: skip')
  assert.equal(inboxCronDue({ builtAt: new Date(now - 10 * 60_000 + 5_000).toISOString(), pkDay: day }, now), true, 'the 10th minute')
  assert.equal(inboxCronDue({ builtAt: new Date(now - 60_000).toISOString(), pkDay: '2000-01-01' }, now), true, 'a new Pakistan day')
  assert.equal(inboxCronDue({ builtAt: 'garbage', pkDay: day }, now), true)
  const cron = read('app/api/cron/admin-summary/route.ts')
  assert.match(cron, /refreshInterestInboxIfDue\(\)/)
  assert.doesNotMatch(cron, /refreshInterestInboxSnapshot\(\)/)
})

test('A2: Insights runs one 5-minute run in three; today rebuilt after 15 minutes', () => {
  assert.equal(INSIGHTS_TODAY_MAX_AGE_MS, 15 * 60 * 1000)
  const at = (min: number) => Date.parse(`2026-11-22T10:${String(min).padStart(2, '0')}:10Z`)
  assert.deepEqual([0, 5, 10, 15, 20, 25, 30, 45, 50].map((m) => insightsRunDue(at(m))), [true, false, false, true, false, false, true, true, false])
  assert.match(read('app/api/cron/every-5-min/route.ts'), /insightsRunDue\(t0\) \? await refreshInsights/)
})

// --------------------------------------------------------- signed-up event ---

test('A4: a mobile sign-up writes "registered" once — the auth trigger, not the code', () => {
  const ps = read('lib/pendingSignup.ts')
  assert.doesNotMatch(ps, /event: 'registered'/)
  assert.match(ps, /event: 'otp_verified'/)
  const trig = read('supabase/migrations/132_hotfix64_signup_trigger_tolerant.sql')
  assert.match(trig, /insert into public\.user_activity_log[\s\S]*'registered'/)
  // Nothing else in the app writes it.
  for (const f of ['lib/ensureProfile.ts', 'app/api/auth/otp/route.ts']) assert.doesNotMatch(read(f), /event: 'registered'/, f)
})

// ------------------------------------------------------------- admin text ---

test('E: admin wording', () => {
  assert.match(read('app/admin/payments/settings/gateways/GatewaysClient.tsx'), /the Owner or staff approve it before anything activates \(staff approve the Verification Fee; plans are approved by the Owner\)\./)
  assert.match(read('lib/paymentSettingsCore.ts'), /label: 'PayPro \(closed\) — kept for records'/)
})
