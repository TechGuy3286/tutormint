/**
 * scripts/test-pr16.ts — npm run test:pr16
 *
 * PR-16 (owner, 22 Nov 2026): the signed-in header, the tutor dashboard and
 * Edit Profile redesign (English only), the footer social row, fee
 * positioning, Insights for the named Backend Support account, and the pages
 * that link to a tutor who left Browse. Pure rules + source scans; no DB,
 * browser or network.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
import vm from 'node:vm'

import { AUTH_MARK_ATTR, AUTH_MARK_SCRIPT, hasAuthCookie, headerAnswer } from '../lib/headerSessionCore'
import { displayTitle } from '../lib/titleCaseCore'
import { groupStepCount } from '../lib/profileRequired'
import { EDIT_PROFILE_LOCK_LINE } from '../lib/editProfileCopyCore'
import { FREE_PROFILE_APPLY_LINE, FREE_PROFILE_LINE, TUTOR_PAYS_NOTHING_RE } from '../lib/feePositioningCore'
import { FAQ_GROUPS } from '../lib/faqContent'
import { INSIGHTS_GRANT_KEY, ALL_ROWS_KEY, seesInsightsFrom, seesAllRowsFrom } from '../lib/staffAllRowsCore'
import { droppedSlugs, linkerMarks, redoDue, withPending, LINKER_REDO_MS, type LinkerTuition } from '../lib/tutorLinkersCore'
import { similarTutors, tutorsForTuition, type CrawlTutor } from '../lib/tutorCrawlCore'

const read = (p: string) => readFileSync(p, 'utf8')
/** The file without its comments — scans look at code, not at notes about it. */
const code = (p: string) => read(p).replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1')
const URDU = /[؀-ۿ]/

function walk(dir: string, out: string[] = []): string[] {
  for (const e of readdirSync(dir)) {
    const p = join(dir, e)
    if (statSync(p).isDirectory()) walk(p, out)
    else if (/\.(tsx?|mjs)$/.test(e)) out.push(p.replace(/\\/g, '/'))
  }
  return out
}

// ================================================================ PART A ===

test('A: the head script marks <html> only when a sign-in cookie is present', () => {
  const run = (cookie: string) => {
    const attrs: Record<string, string> = {}
    const document = { cookie, documentElement: { setAttribute: (k: string, v: string) => (attrs[k] = v) } }
    vm.runInNewContext(AUTH_MARK_SCRIPT, { document })
    return attrs[AUTH_MARK_ATTR] === '1'
  }
  for (const c of ['', 'tm_anon=abc', 'sb-abcd-auth-token=', 'tm_utm=x; other=1']) {
    assert.equal(run(c), false, c)
    assert.equal(run(c), hasAuthCookie(c), 'the script and hasAuthCookie agree')
  }
  for (const c of ['sb-abcd-auth-token=base64-xyz', 'tm_anon=1; sb-abcd-auth-token.0=part']) {
    assert.equal(run(c), true, c)
    assert.equal(run(c), hasAuthCookie(c))
  }
  // Never throws, even without a document.
  assert.doesNotThrow(() => vm.runInNewContext(AUTH_MARK_SCRIPT, {}))
})

test('A: a signed-in member never sees Join free / Login — the guest buttons hide while the mark is on', () => {
  const cta = read('components/AuthCTA.tsx')
  // Both guest buttons carry the class the CSS hides.
  assert.equal((cta.match(/className="tm-guest-only /g) ?? []).length, 2)
  assert.match(read('app/globals.css'), /html\[data-tm-auth\] \.tm-guest-only \{\s*display: none !important;/)
  const layout = read('app/layout.tsx')
  assert.match(layout, /dangerouslySetInnerHTML=\{\{ __html: AUTH_MARK_SCRIPT \}\}/)
  assert.match(layout, /<html lang="en" suppressHydrationWarning>/)
})

test('A: only a clear "signed out" shows the guest buttons; anything unclear retries', () => {
  assert.equal(headerAnswer(200, { signedIn: true, userId: 'x' }), 'signed-in')
  assert.equal(headerAnswer(200, { signedIn: false }), 'guest')
  for (const [status, body] of [[null, null], [500, { error: 'x' }], [403, { error: 'View as' }], [200, null], [200, 'html'], [502, { signedIn: false }]] as const) {
    assert.equal(headerAnswer(status, body), 'retry', `${status} ${JSON.stringify(body)}`)
  }
  const p = code('components/session/HeaderSessionProvider.tsx')
  assert.match(p, /headerAnswer\(status, body\)/)
  assert.doesNotMatch(p, /catch \{\s*setState\(\{ status: 'guest' \}\)/, 'a failed request is not a guest')
})

test('A: the header route no longer turns a failed side count into "signed out"', () => {
  const s = code('lib/headerSession.ts')
  for (const f of ['unreadCount()', 'unreadMessageCount(session.user.id)', 'currentViewAs()', 'adminScreensFor()']) {
    assert.ok(s.includes(`soft(${f}`), f)
  }
})

test('A: signed-in pages hand the header over from their own request; public pages never do', () => {
  const seeded = [
    'app/(site)/tutor/dashboard/layout.tsx',
    'app/(site)/parent/dashboard/layout.tsx',
    'app/(site)/pay/layout.tsx',
    'app/(site)/tutor/onboarding/layout.tsx',
    'app/(site)/tutor/complete-profile/layout.tsx',
    'app/(site)/account/layout.tsx',
    'app/(site)/messages/layout.tsx',
  ]
  for (const f of seeded) assert.match(read(f), /<SignedInHeader \/>/, f)
  // Each of them is per-request already (force-dynamic or a session read).
  for (const f of seeded) assert.match(read(f), /force-dynamic|getSessionUser\(/, f)
  // Nothing else renders it — a public, cached page must not read the cookie.
  const users = walk('app').filter((f) => /SignedInHeader/.test(read(f)))
  assert.deepEqual(users.sort(), seeded.sort())
  for (const f of ['components/SiteChrome.tsx', 'components/Navbar.tsx', 'components/Footer.tsx', 'app/(site)/layout.tsx', 'app/layout.tsx']) {
    assert.doesNotMatch(code(f), /SignedInHeader|getSessionUser|cookies\(\)|from 'next\/headers'/, f)
  }
})

// ================================================================ PART B ===

const DASH = 'app/(site)/tutor/dashboard/page.tsx'

test('B: the 100% banner hides on the dashboard; shown only while something is missing', () => {
  // PR-17 E.3: the dashboard now shows the one "Your next step" card (hidden when nothing is left).
  assert.match(read(DASH), /<NextStepCard /)
  const c = code('components/profile/CompletionLine.tsx')
  assert.match(c, /if \(complete && hideWhenComplete\) return null/)
})

test('B: "7 applied · 0 hired" from one list; the Hired tile uses the same list', () => {
  const s = code(DASH)
  // PR-17 E.6: the tile reads "N applied" only; the Hired tile shows hires.
  assert.match(s, /\{appliedCount\} applied<\/span>/)
  assert.match(s, /const appliedCount = myApplications\.length/)
  assert.match(s, /const hiredCount = myApplications\.filter\(\(a\) => a\.stage === 'hired'\)\.length/)
  assert.doesNotMatch(s, /quotaNote|appliedThisMonth/, 'no second "applied" number')
})

test('B: no "Selfie checked" on the top card; intro video says Add video / Added ✓', () => {
  assert.doesNotMatch(code('components/tutor/TutorHeaderCard.tsx'), /SELFIE_CHECKED_LABEL|selfieChecked/)
  assert.doesNotMatch(code(DASH), /selfieChecked/)
  assert.match(code(DASH), /hasVideo \? 'Added ✓' : 'Add video'/)
})

test('B: compact tiles — two to a row on a phone, four on desktop, each its own tone', () => {
  assert.match(code(DASH), /<CountGrid tiles=\{tiles\} compact \/>/)
  assert.match(code('components/tutor/DashboardCards.tsx'), /grid grid-cols-2 gap-2 md:grid-cols-4/)
  const tones = [...code(DASH).matchAll(/tone: '([a-z]+)'/g)].map((m) => m[1])
  assert.equal(tones.length, 8)
  assert.equal(new Set(tones).size, 8, 'no two tiles share a colour')
})

test('B: application titles in normal case (display only)', () => {
  assert.equal(displayTitle('LAHORE'), 'Lahore')
  assert.equal(displayTitle('Maths tutor needed in LAHORE'), 'Maths tutor needed in Lahore')
  assert.equal(displayTitle('O LEVEL MATHS TUTOR IN DHA LAHORE'), 'O Level Maths Tutor in DHA Lahore')
  assert.equal(displayTitle('FSc Physics tutor - DHA Phase 5'), 'FSc Physics tutor - DHA Phase 5', 'mixed case and short capitals kept')
  assert.equal(displayTitle('IGCSE CHEMISTRY'), 'IGCSE Chemistry')
  assert.equal(displayTitle(''), '')
  const s = code('components/tutor/MyApplicationsSection.tsx')
  assert.match(s, /\{displayTitle\(c\.title\)\}/)
  // Stored titles untouched: nothing in the section writes.
  assert.doesNotMatch(s, /\.update\(|\.upsert\(|fetch\(/)
})

test('B: the plan chip opens Membership Plans — a plain link, no pop-up', () => {
  const s = code('components/tutor/TutorHeaderCard.tsx')
  assert.match(s, /href="\/membership-plans\?for=tutors"[\s\S]*?\{planName\}/)
  assert.doesNotMatch(s, /onClick|Dialog|Upgrade/)
})

test('B: breadcrumb Home › Dashboard; English only on the dashboard', () => {
  assert.match(read(DASH), /<Breadcrumbs items=\{\[\{ label: 'Dashboard' \}\]\} \/>/)
  for (const f of [DASH, 'components/tutor/TutorHeaderCard.tsx', 'components/payments/PaymentReviewNotice.tsx', 'components/tutor/MyApplicationsSection.tsx', 'components/tutor/DashboardCards.tsx', 'components/profile/CompletionLine.tsx']) {
    assert.doesNotMatch(code(f), URDU, f)
  }
})

// ================================================================ PART C ===

const EDIT = 'app/(site)/tutor/dashboard/settings/page.tsx'
function keysIn(block: string): string[] {
  return [...block.matchAll(/\n\s{6}key: '([a-zA-Z]+)',/g)].map((m) => m[1])
}

test('C: the selfie is in Step 2 (optional); Step 1 holds only required cards', () => {
  const s = read(EDIT)
  const step1All = keysIn(s.slice(s.indexOf('const step1All'), s.indexOf('const step2Base')))
  assert.ok(step1All.includes('selfie'), 'the selfie card body is still defined')
  assert.match(s, /const step1Cards: CardDesc\[\] = step1All\.filter\(\(c\) => c\.key !== 'selfie'\)/)
  assert.match(s, /const step2Cards: CardDesc\[\] = \[\.\.\.step2Base, \.\.\.step1All\.filter\(\(c\) => c\.key === 'selfie'\)\]/)
})

test('C: the step counts match the rows shown', () => {
  const step1 = ['mobile', 'cnic', 'profilePic', 'subjects', 'location'].map((key) => ({ key, status: 'completed' }))
  assert.deepEqual(groupStepCount(step1, []), { done: 5, total: 5 })
  assert.deepEqual(groupStepCount(step1, ['location_areas', 'subjects']).total, 5)
  // An optional row (no required item) is done only when Completed.
  const step2 = [
    { key: 'certifications', status: 'missing' },
    { key: 'email', status: 'completed' },
    { key: 'selfie', status: 'neutral' },
  ]
  assert.deepEqual(groupStepCount(step2, []), { done: 1, total: 3 })
  assert.match(code(EDIT), /groupStepCount\(step1Cards, missingKeys\)/)
  assert.match(code(EDIT), /groupStepCount\(step2Cards, missingKeys\)/)
})

test('C: a compact list — icon · label · status · chevron, English only', () => {
  const p = code('components/tutor/SettingsPieces.tsx')
  assert.match(p, /export function SettingsRow/)
  for (const w of ["'Completed'", "'Missing'", "'Under review'", "'Locked'"]) assert.ok(p.includes(w), w)
  const row = p.slice(p.indexOf('export function SettingsRow'))
  assert.doesNotMatch(row, /<Urdu|lang="ur"/)
  assert.match(row, /ChevronRight/)
  const s = code(EDIT)
  assert.doesNotMatch(s, /SettingsTile|renderTiles/)
  for (const sec of ['step1', 'step2', 'account']) assert.match(s, new RegExp(`<StepHeader section="${sec}"[^>]* english />`))
  assert.match(s, /\n\s+english\n\s+>/, 'the open card has no Urdu title/badge')
  // Nothing Urdu is RENDERED (the checklists' stored `ur` strings stay as data).
  assert.doesNotMatch(s, /lang="ur"|<Urdu/, 'no Urdu line on Edit Profile')
  assert.match(s, /<FormChecklist items=\{items\} english \/>/)
  assert.match(s, /<ChecklistStatus items=\{items\} english \/>/)
})

test('C: locked rows say the support line with a WhatsApp button; an empty email is not locked', () => {
  assert.equal(EDIT_PROFILE_LOCK_LINE, 'To change this, contact support on WhatsApp 0321 5872222')
  const s = code(EDIT)
  assert.match(s, /\{EDIT_PROFILE_LOCK_LINE\}/)
  assert.match(s, /memberLockWhatsappHref\(c\.key as MemberLockField\)/)
  assert.match(s, /c\.locked \? lockPanel\(c\)/)
  // Email: locked only once a real address is on the account.
  assert.match(s, /key: 'email',[\s\S]*?locked: !!realEmail,/)
})

test('C: Danger zone at the bottom with Pause and Delete, red', () => {
  const s = read(EDIT)
  const account = s.slice(s.indexOf('const accountCards'), s.indexOf('const dangerCards'))
  const danger = s.slice(s.indexOf('const dangerCards'), s.indexOf('const missingKeys'))
  assert.deepEqual(keysIn(account), ['details', 'homeAddress', 'whatsappUpdates', 'password'])
  assert.deepEqual(keysIn(danger), ['pause', 'delete'])
  assert.match(danger, /<PauseAccountCard \/>/)
  assert.match(danger, /<DeleteAccountCard \/>/)
  const main = s.slice(s.indexOf('return (\n    <main'))
  assert.ok(main.indexOf('Danger zone') > main.indexOf('section="account"'), 'after Account')
  assert.match(main, /text-tm-red">Danger zone/)
  assert.match(main, /renderList\(dangerCards, true\)/)
})

test('C: breadcrumb Home › Dashboard › Edit Profile, no Back link', () => {
  const s = code(EDIT)
  assert.match(s, /<Breadcrumbs items=\{\[\{ label: 'Dashboard', href: '\/tutor\/dashboard' \}, \{ label: 'Edit Profile' \}\]\} \/>/)
  assert.doesNotMatch(s, /Back to Tutor dashboard/)
})

// ================================================================ PART D ===

test('D: footer social icons at 32px, one row on a phone; WhatsApp number on one line', () => {
  const f = code('components/Footer.tsx')
  // PR-20: seven icons (Google added) — 7 × 44px + 6 × 2px = 320px on a phone.
  assert.match(f, /<ul className=\{`mt-2 flex items-center \$\{oneRow \? 'flex-nowrap gap-1' : 'flex-wrap gap-0\.5'\}`\}/)
  assert.ok(7 * 44 + 6 * 2 <= 320)
  assert.match(f, /sizes="32px" className="h-8 w-8 object-contain"/)
  assert.match(f, /h-11 w-11/, '44px tap target kept')
  assert.equal((f.match(/whitespace-nowrap[^"]*"\s*>\s*WhatsApp \{formatSupportWhatsApp/g) ?? []).length, 2)
})

// ================================================================ PART E ===

test('E: homepage hero line — Free Profile / مفت پروفائل, the rest unchanged', () => {
  const home = read('app/(site)/page.tsx')
  assert.ok(home.includes('Free Profile &bull; Verified Tutors &bull; Contact Directly &bull; Live Demo'))
  assert.ok(home.includes('مفت پروفائل &bull; تصدیق شدہ ٹیوٹرز &bull; براہِ راست رابطہ &bull; لائیو ڈیمو'))
  assert.ok(!home.includes('Free to Join &bull;'))
  assert.ok(!home.includes('کوئی فیس نہیں'))
})

test('E: FAQ "Is TutorMint free?" — the owner’s answer, no amount', () => {
  const item = FAQ_GROUPS.flatMap((g) => g.items).find((i) => i.q === 'Is TutorMint free?')
  assert.ok(item)
  assert.equal(
    item!.a,
    'Creating your profile and browsing tuitions is free. To apply to tuitions and get the Verified badge, you pay a one-time Verification Fee. It covers checking your CNIC and photo.',
  )
  assert.doesNotMatch(item!.a, /Rs|\d/)
  // The selfie is optional — the FAQ does not say it is required.
  const verified = FAQ_GROUPS.flatMap((g) => g.items).find((i) => i.q === 'How are tutors verified?')!
  assert.match(verified.a, /a selfie is optional/)
})

test('E: tutor-facing lines never say a tutor can apply free; never "no fee"', () => {
  assert.doesNotMatch(FREE_PROFILE_APPLY_LINE + FREE_PROFILE_LINE, TUTOR_PAYS_NOTHING_RE)
  assert.doesNotMatch(FREE_PROFILE_APPLY_LINE, /\d|Rs/)
  for (const f of ['lib/browseMeta.ts', 'lib/hubCopy.ts', 'lib/jobPostingCore.ts', 'lib/landing.ts']) {
    const s = code(f)
    assert.match(s, /FREE_PROFILE_APPLY_LINE/, f)
    assert.doesNotMatch(s, /Free to join — apply|Apply on TutorMint — free to join|newest first — free to join/, f)
  }
  // Shipped copy (code, not comments) holds no "tutors pay nothing" claim.
  const shipped = [...walk('app'), ...walk('components'), ...walk('lib')].filter((f) => !/lib\/ai\/|feePositioningCore|platformFacts/.test(f))
  const hits: string[] = []
  for (const f of shipped) {
    const strings = code(f).match(/'[^'\n]*'|"[^"\n]*"|`[^`]*`/g) ?? []
    for (const s of strings) if (TUTOR_PAYS_NOTHING_RE.test(s)) hits.push(`${f}: ${s.slice(0, 80)}`)
  }
  assert.deepEqual(hits, [])
})

// ================================================================ PART F ===

test('F: Insights — Owner, Partner and the account on the grant; other Backend Support no', () => {
  const mohsin = '0a5687c8-5d5c-41bf-974e-a85a5fbee938'
  const other = '11111111-2222-4333-8444-555555555555'
  const granted = new Set([mohsin])
  assert.equal(seesInsightsFrom({ id: other, adminRole: 'owner' }, new Set()), true)
  assert.equal(seesInsightsFrom({ id: other, adminRole: 'partner' }, new Set()), true)
  assert.equal(seesInsightsFrom({ id: mohsin, adminRole: 'backend_support' }, granted), true)
  assert.equal(seesInsightsFrom({ id: other, adminRole: 'backend_support' }, granted), false, 'other Backend Support staff')
  for (const r of ['admin', 'operations', 'supervisor', 'tuitions_staff']) assert.equal(seesInsightsFrom({ id: other, adminRole: r }, granted), false, r)
  assert.equal(seesInsightsFrom({ id: mohsin, adminRole: null }, granted), false, 'no longer staff → no access')
  // Its own key: the all-rows grant does not open Insights, nor the reverse.
  assert.notEqual(INSIGHTS_GRANT_KEY, ALL_ROWS_KEY)
  assert.equal(seesAllRowsFrom({ id: mohsin, adminRole: 'backend_support' }, [], new Set()), false)
  const mig = read('supabase/migrations/242_pr16_staff_insights_grant.sql')
  assert.match(mig, /'staff\.insights', '\["0a5687c8-5d5c-41bf-974e-a85a5fbee938"\]'/)
  assert.match(mig, /on conflict \(key\) do nothing/)
  assert.doesNotMatch(mig, /\b(begin|commit)\b;/i)
})

test('F: both Insights screens and the nav use the grant; the screens show no rupees or contacts', () => {
  for (const f of ['app/admin/insights/page.tsx', 'app/admin/insights/members/page.tsx']) {
    const s = code(f)
    assert.match(s, /await requireInsights\(\)/, f)
    assert.doesNotMatch(s, /requireAdminRole/, f)
    assert.doesNotMatch(s, /paymentAmounts|amount_pkr|\bphone\b|cnic_number|\.email\b/, f)
  }
  assert.match(code('app/admin/layout.tsx'), /\(i\.screen === 'insights' && insightsGranted\)/)
})

// ================================================================ PART G ===

const T = (id: string, city: string, subjects: string[], gender: CrawlTutor['gender'] = 'male'): CrawlTutor => ({
  id,
  slug: `t-${id}`,
  name: '',
  city,
  citySlug: city.toLowerCase(),
  gender,
  masters: subjects.map((s) => s.length),
  subjects,
  levels: [],
})

test('G: a tutor who left rebuilds exactly the pages that showed them', () => {
  const gone = T('g', 'Lahore', ['maths'], 'female')
  const linker = T('a', 'Lahore', ['maths'])
  const otherSubject = T('b', 'Lahore', ['urdu'])
  const otherCity = T('c', 'Karachi', ['maths'])
  const before = [gone, linker, otherSubject, otherCity]
  const tuitions: LinkerTuition[] = [
    { id: 'j1', city: 'Lahore', publicSlug: 'maths-lahore', masters: [5], subjects: ['maths'], levels: [], genderPref: null },
    { id: 'j2', city: 'Lahore', publicSlug: 'male-only', masters: [5], subjects: ['maths'], levels: [], genderPref: 'male' },
    { id: 'j3', city: 'Karachi', publicSlug: 'maths-karachi', masters: [5], subjects: ['maths'], levels: [], genderPref: null },
  ]
  // Sanity: the page rules really do show the tutor on these pages.
  assert.ok(similarTutors(before, linker).some((t) => t.id === 'g'))
  assert.ok(tutorsForTuition(before, tuitions[0]).some((t) => t.id === 'g'))
  const paths = linkerMarks(before, [gone], tuitions).map((m) => m.path)
  assert.deepEqual(paths, [
    '/browse/tutors',
    '/tuitions/lahore/maths-lahore',
    '/tutor/t-a',
    '/tutor/t-g',
    '/tutors/lahore',
    '/tutors/lahore/female',
  ])
  // Targeted: not the other-subject profile, not the male-only tuition, not Karachi.
  for (const p of ['/tutor/t-b', '/tutor/t-c', '/tuitions/lahore/male-only', '/tuitions/karachi/maths-karachi', '/tutors/karachi']) {
    assert.ok(!paths.includes(p), p)
  }
  assert.deepEqual(linkerMarks(before, [], tuitions), [], 'nothing left → nothing rebuilt')
})

test('G: a profile whose six similar tutors never included them is not rebuilt', () => {
  // Seven Lahore maths tutors share more with each other than with `gone`.
  const strong = Array.from({ length: 7 }, (_, i) => ({ ...T(`s${i}`, 'Lahore', ['maths', 'physics']), masters: [1, 2] }))
  const gone = { ...T('g', 'Lahore', ['maths']), masters: [9] }
  const before = [...strong, gone]
  const linking = strong.filter((p) => similarTutors(before, p).some((t) => t.id === 'g')).map((p) => `/tutor/${p.slug}`)
  const paths = linkerMarks(before, [gone], []).map((m) => m.path)
  for (const p of strong.map((s) => `/tutor/${s.slug}`)) assert.equal(paths.includes(p), linking.includes(p), p)
  assert.equal(linking.length, 0, 'the six slots are all taken by stronger matches')
})

test('G: slugs that left; the second pass after every server’s memory has expired', () => {
  assert.deepEqual(droppedSlugs(['a', 'b', 'c'], ['a', 'c', 'd']), ['b'])
  assert.deepEqual(droppedSlugs([], ['a']), [])
  const now = Date.parse('2026-11-22T10:00:00Z')
  const p = withPending(null, [{ path: '/tutor/a' }], now)
  assert.equal(Date.parse(p.redoAt) - now, LINKER_REDO_MS)
  assert.ok(LINKER_REDO_MS > 300_000, 'longer than the 5-minute crawl-set memory')
  assert.equal(redoDue(p, now), false)
  assert.equal(redoDue(p, now + LINKER_REDO_MS), true)
  assert.equal(redoDue(null, now), false)
  const merged = withPending(p, [{ path: '/tutor/b' }, { path: '/tutor/a' }], now)
  assert.deepEqual(merged.marks.map((m) => m.path), ['/tutor/a', '/tutor/b'])
})

test('G: wired into the moderation route (at once) and the 1-minute admin cron (every path)', () => {
  assert.match(code('app/api/admin/tutors/moderate/route.ts'), /await syncListedTutors\(\)/)
  assert.match(code('app/api/cron/admin-summary/route.ts'), /const linkers = await syncListedTutors\(\)/)
  const s = code('lib/tutorLinkers.ts')
  // The snapshot keeps no name or photo.
  assert.match(s, /name: ''/)
  assert.doesNotMatch(s, /avatarUrl: t\.avatarUrl/)
  assert.match(s, /invalidateMemoTag\(LANDING_TAG\)/)
})
