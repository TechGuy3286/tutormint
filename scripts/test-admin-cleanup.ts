/**
 * scripts/test-admin-cleanup.ts  —  npm run test:admincleanup
 *
 * The admin clean-up (owner, 20 Oct 2026): breadcrumbs that follow the list a
 * record was opened from (and the direct-open fallback), the list's filter
 * coming back with it, Copy profile link disabled when the profile is not
 * public, the Change ▾ menu keeping the Owner-only options, the merged
 * timeline's counts agreeing, grouped events, the payment labels and the
 * empty-sections line. Pure logic + source scans — no database, no names,
 * numbers or emails printed.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

import { adminTrail } from '../lib/adminNav'
import { OVERVIEW_ITEMS } from '../lib/overviewItemsCore'
import { fromOf, safeAdminFrom, trailFor, withFrom, type FromCrumb } from '../lib/adminFromCore'
import { profileShareState, publicProfileUrl, whatsappShareHref } from '../lib/profileShareCore'
import { changeMenuOptions } from '../lib/docChangeMenuCore'
import {
  buildTimeline,
  dedupeAgainstAudit,
  auditSentence,
  activitySummaryLine,
  type AuditRow,
  type LogRow,
  type SessionRow,
} from '../lib/memberTimelineCore'
import { paymentLabel, paymentNeedsFollowUp, type PaymentFacts } from '../lib/paymentLabelCore'
import { documentsFact, emptySectionsLine, parentDocKind, tutorStatusFact, videoFact } from '../lib/memberPageCore'
import { DOC_FILTERS, docFilterLabel, applyDocFilter, docFilterCounts, isDocFilter } from '../lib/tutorDocSummaryCore'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const read = (p: string) => readFileSync(join(ROOT, p), 'utf8')

const MEMBER = '/admin/users/11111111-2222-4333-8444-555555555555'
const NAME = 'Muhammad Dawood'

/** The header trail, as the @pagehead slot builds it, with fixed labels. */
const labels: Record<string, string> = {
  '/admin/overview/tutors': OVERVIEW_ITEMS.tutors.title,
  [MEMBER]: NAME,
}
const trail = (url: string) => trailFor(url, (path) => adminTrail(path, labels[path] ?? null).crumbs)
const words = (t: FromCrumb[]) => t.map((c) => c.label).join(' › ')

// ── Part A: breadcrumbs ────────────────────────────────────────────────

test('breadcrumbs: Overview → Tutors → member', async () => {
  const list = '/admin/overview/tutors?docs=waiting&q=lahore'
  const opened = withFrom(MEMBER, list)
  assert.equal(fromOf(opened), list)
  const t = await trail(opened)
  assert.equal(words(t), `Admin › Overview › Tutors › ${NAME}`)
  // The list crumb goes back to the exact list: the chip and the search come back.
  assert.equal(t[t.length - 2].href, list)
  // "Overview" has no page of its own; it is /admin.
  assert.equal(t[1].href, '/admin')
  assert.equal(t[t.length - 1].href, undefined)
})

test('breadcrumbs: Follow-ups → member', async () => {
  const list = '/admin/follow-ups?scope=older&filter=uncontacted'
  const t = await trail(withFrom(MEMBER, list))
  assert.equal(words(t), `Admin › Follow-ups › ${NAME}`)
  assert.equal(t[t.length - 2].href, list)
})

test('breadcrumbs: My sign-ups → member', async () => {
  const list = '/admin/my-signups?frole=tutor&fq=ali'
  const t = await trail(withFrom(MEMBER, list))
  assert.equal(words(t), `Admin › My sign-ups › ${NAME}`)
  assert.equal(t[t.length - 2].href, list)
})

test('breadcrumbs: opened directly falls back to People', async () => {
  const t = await trail(MEMBER)
  assert.equal(words(t), `Admin › People › ${NAME}`)
  assert.equal(t[1].href, '/admin/users')
})

test('breadcrumbs: a record opened from a record keeps the whole path', async () => {
  const job = '/admin/jobs/99999999-2222-4333-8444-555555555555'
  const fromMember = withFrom(MEMBER, '/admin/overview/tutors?docs=partial')
  const t = await trail(withFrom(job, fromMember))
  assert.equal(words(t), `Admin › Overview › Tutors › ${NAME} › Tuition`)
  assert.equal(t[t.length - 2].href, fromMember)
})

test('breadcrumbs: a timeline tab keeps the list it came from', () => {
  const opened = withFrom(MEMBER, '/admin/follow-ups?filter=today')
  const tab = withFrom(`${MEMBER}?group=money`, opened)
  assert.equal(fromOf(tab), '/admin/follow-ups?filter=today')
})

test('breadcrumbs: only same-site admin addresses are trusted', () => {
  for (const bad of ['https://evil.example/admin', '//evil.example', '/admin\\..', '/administrator', '/admin%2f%2fevil', '/tutor/x']) {
    assert.equal(safeAdminFrom(bad), null, bad)
  }
  assert.equal(withFrom('/admin/users', '/admin/overview/tutors'), '/admin/users') // not a record
  assert.equal(withFrom('/tutor/abc', '/admin/overview/tutors'), '/tutor/abc')
})

test('Part A: no "Back to …" links at the top of admin pages', () => {
  for (const f of [
    'app/admin/overview/[key]/page.tsx',
    'app/admin/overview/todo-unmet/page.tsx',
    'app/admin/team-activity/claims/page.tsx',
    'app/admin/seo/locations/added/page.tsx',
    'app/admin/users/CleanupClient.tsx',
    'app/admin/team-activity/[id]/page.tsx',
  ]) {
    assert.doesNotMatch(read(f), /Back to Overview|← Back|← Locations|← All people|← Team activity/, f)
  }
  assert.match(read('components/admin/AdminShell.tsx'), /AdminReturnKeeper/)
})

// ── Filter restored on back ────────────────────────────────────────────

test('the list filter lives in the address, so back reopens it', () => {
  const grid = read('components/admin/OverviewCardGrid.tsx')
  assert.match(grid, /useUrlState<string>\('q'/)
  assert.match(grid, /useUrlState<DocFilter>\('docs'/)
  const rows = read('components/admin/SignupRows.tsx')
  assert.match(rows, /setUrlParam\(URL_KEY\[k\]/)
  // The keeper restores scroll on a breadcrumb return and on the back button.
  const keeper = read('components/admin/AdminReturnKeeper.tsx')
  assert.match(keeper, /popstate/)
  assert.match(keeper, /nav\[aria-label="Breadcrumb"\]/)
  // Every chip value read back from the address is a real chip.
  for (const f of DOC_FILTERS) assert.ok(isDocFilter(f))
  assert.equal(isDocFilter('bogus'), false)
})

// ── Part B: copy profile link ──────────────────────────────────────────

test('Copy profile link: the clean public address when public', () => {
  const s = profileShareState({ slug: 'sara-ali-tutor', listed: true, blockers: [] })
  assert.equal(s.url, 'https://www.tutormint.org/tutor/sara-ali-tutor')
  assert.equal(s.disabledReason, null)
  assert.equal(whatsappShareHref(publicProfileUrl('a-b')), 'https://api.whatsapp.com/send?text=https%3A%2F%2Fwww.tutormint.org%2Ftutor%2Fa-b')
})

test('Copy profile link: disabled with the reason when not public', () => {
  const s = profileShareState({ slug: 'x', listed: false, blockers: ['suspended'] })
  assert.equal(s.url, null)
  assert.equal(s.disabledReason, 'Profile not public yet: account suspended')
  assert.equal(profileShareState({ slug: null, listed: true, blockers: [] }).url, null)
  assert.match(profileShareState({ slug: 'x', listed: false, blockers: [] }).disabledReason ?? '', /^Profile not public yet/)
  // Every tutor-card list renders the buttons.
  for (const f of ['components/admin/OverviewCardGrid.tsx', 'components/admin/SignupRows.tsx', 'app/admin/follow-ups/UnpaidSignupRow.tsx', 'app/admin/users/[id]/page.tsx']) {
    assert.match(read(f), /ProfileShareButtons/, f)
  }
})

test('member page facts: documents colours, video line, tutor status reason', () => {
  assert.deepEqual(documentsFact('approved'), { text: 'Approved', tone: 'text-tm-green-deep' })
  assert.equal(documentsFact('waiting').tone, 'text-tm-gold-ink')
  assert.equal(documentsFact('partial').tone, 'text-tm-gold-ink')
  assert.equal(documentsFact('rejected').tone, 'text-tm-red')
  assert.equal(documentsFact('none').tone, 'text-gray-500')
  const A = { status: 'approved' as const, hasUpload: true }
  const W = { status: 'pending' as const, hasUpload: true }
  const N = { status: 'none' as const, hasUpload: false }
  assert.equal(parentDocKind([A, A]), 'approved')
  assert.equal(parentDocKind([A, W]), 'waiting')
  assert.equal(parentDocKind([A, N]), 'partial')
  assert.equal(parentDocKind([N, N]), 'none')
  assert.equal(videoFact('none', 'private'), 'None')
  assert.equal(videoFact(null, null), 'None')
  assert.equal(videoFact('uploaded', 'private'), 'Uploaded · Private')
  assert.equal(videoFact('approved', 'public'), 'Approved · Public')
  assert.equal(tutorStatusFact('pending', { feePaid: false, docKind: 'approved' }), 'Pending: fee not paid')
  assert.equal(tutorStatusFact('pending', { feePaid: true, docKind: 'waiting' }), 'Pending: documents waiting')
  assert.equal(tutorStatusFact('pending', { feePaid: true, docKind: 'none' }), 'Pending: documents missing')
  assert.equal(tutorStatusFact('pending', { feePaid: false, docKind: 'partial' }), 'Pending: fee not paid · documents missing')
  assert.equal(tutorStatusFact('verified', { feePaid: true, docKind: 'approved' }), 'Verified')
})

// ── Part C: Change ▾ ───────────────────────────────────────────────────

test('Change menu: Owner-only options, nothing for anyone else', () => {
  const base = { status: 'approved' as const, hasUpload: true, unlockable: true, unlockOpen: false, canUnlock: true }
  assert.deepEqual(changeMenuOptions({ ...base, canDecide: true }), ['reject', 'unlock'])
  assert.deepEqual(changeMenuOptions({ ...base, canDecide: true, status: 'rejected', unlockable: false }), ['approve'])
  // Not the Owner: no options at all (they see what they saw before).
  assert.deepEqual(changeMenuOptions({ ...base, canDecide: false }), [])
  // Unlock only when locked, not already open, and allowed.
  assert.deepEqual(changeMenuOptions({ ...base, canDecide: true, unlockOpen: true }), ['reject'])
  assert.deepEqual(changeMenuOptions({ ...base, canDecide: true, canUnlock: false }), ['reject'])
  // Undecided documents keep their Approve / Reject buttons, no menu.
  assert.deepEqual(changeMenuOptions({ ...base, canDecide: true, status: 'pending' }), [])
  for (const f of ['components/admin/TutorDocumentReview.tsx', 'components/admin/ParentDocumentReview.tsx']) {
    const src = read(f)
    assert.match(src, /DocChangeMenu/, f)
    assert.match(src, /canDecide: canReview/, f) // canReview already requires useCanApprove()
    assert.doesNotMatch(src, /Change decision|View original|<UnlockDocButton/, f)
  }
})

// ── Part G: one timeline ───────────────────────────────────────────────

const at = (min: number) => new Date(Date.UTC(2026, 9, 19, 17, 0) + min * 60_000).toISOString()

function sample() {
  const logs: LogRow[] = []
  // Eight profile saves, a minute apart, newest first.
  for (let i = 0; i < 8; i++) logs.push({ id: `p${i}`, event: 'profile_updated', meta: { fields: ['bio'] }, at: at(53 - i) })
  logs.push({ id: 'v1', event: 'verification_decision_received', meta: { item: 'cnic', decision: 'approve' }, at: at(30) })
  logs.push({ id: 'v2', event: 'verification_decision_received', meta: { item: 'selfie', decision: 'approve' }, at: at(29) })
  logs.push({ id: 'pay', event: 'verification_fee_paid', meta: {}, at: at(10) })
  logs.push({ id: 'reg', event: 'registered', meta: { role: 'tutor' }, at: at(0) })
  const audits: AuditRow[] = [
    { id: 'a1', action: 'tutor.approve', detail: { item: 'cnic' }, at: at(30), actorName: 'Alee Sabeer' },
    { id: 'a2', action: 'tutor.approve', detail: { item: 'selfie' }, at: at(29), actorName: 'Alee Sabeer' },
    { id: 'a3', action: 'tutor.approve', detail: { item: 'profile_pic' }, at: at(28), actorName: 'Alee Sabeer' },
    { id: 'a4', action: 'cnic.reveal', detail: {}, at: at(27), actorName: 'Alee Sabeer' },
    { id: 'a5', action: 'staff.signup_credit', detail: {}, at: at(1), actorName: 'Aqsa Mughal' },
  ]
  const sessions: SessionRow[] = [{ id: 's1', startedAt: at(45), activeMs: 6 * 60_000, pageCount: 4 }]
  return { logs, audits, sessions }
}

test('timeline: specific names, with who did it', () => {
  assert.equal(auditSentence('tutor.approve', { item: 'cnic' }), 'Approved CNIC')
  assert.equal(auditSentence('tutor.approve', { item: 'profile_pic' }), 'Approved profile picture')
  assert.equal(auditSentence('tutor.approve', { item: 'selfie' }), 'Approved selfie')
  assert.equal(auditSentence('tutor.hold', { item: 'selfie' }), 'Rejected selfie')
  assert.equal(auditSentence('parent.verify.approve', { item: 'address' }), 'Approved home address')
  assert.equal(auditSentence('document.unlock', { item: 'photo' }), 'Unlocked profile picture for re-upload')
  const mod = buildTimeline(sample(), 'moderation')
  assert.deepEqual(
    mod.map((i) => i.text),
    ['Approved CNIC', 'Approved selfie', 'Approved profile picture', 'Showed the full CNIC number', 'Sign-up credited to a staff member'],
  )
  assert.ok(mod.every((i) => i.who?.startsWith('by ')))
  assert.ok(!mod.some((i) => /Approved a tutor/.test(i.text)))
})

test('timeline: an admin action is shown once (its member-side twin is dropped)', () => {
  const s = sample()
  const kept = dedupeAgainstAudit(s.logs, s.audits)
  assert.ok(!kept.some((l) => l.event === 'verification_decision_received'))
  // With no audit row, the member's own row stays.
  assert.equal(dedupeAgainstAudit(s.logs, []).length, s.logs.length)
})

test('timeline: repeats in a row are one line, tap to expand', () => {
  const all = buildTimeline(sample(), 'all')
  const prof = all.find((i) => i.text === 'Updated their profile')
  assert.ok(prof)
  assert.equal(prof!.count, 8)
  assert.equal(prof!.children?.length, 8)
  assert.match(prof!.range ?? '', /^10:46–10:53\s?pm$/i)
})

test('timeline: the header count equals the list and the closing line', () => {
  const s = sample()
  for (const g of ['all', 'account', 'activity', 'money', 'moderation'] as const) {
    const full = buildTimeline(s, g)
    // Paging the way the page and "Show more" do: every slice of one list.
    let loaded = 0
    for (let off = 0; off < full.length; off += 3) loaded += full.slice(off, off + 3).length
    assert.equal(loaded, full.length, g)
  }
  // 37-vs-24 bug: the count is the grouped length, not the raw row count.
  const all = buildTimeline(s, 'all')
  assert.ok(all.length < s.logs.length + s.audits.length + s.sessions.length)
  const src = read('lib/memberTimeline.ts')
  assert.match(src, /total: all\.length/)
})

test('timeline: Activity starts with a one-line summary', () => {
  assert.equal(
    activitySummaryLine({ sessions30: 2, timeMs30: 6 * 60_000, lastSeen: '2026-10-19T12:00:00Z' }),
    '2 sessions · 6 min in the last 30 days · last seen 19 Oct 2026',
  )
  const act = buildTimeline(sample(), 'activity')
  assert.equal(act[0].text, 'Visited TutorMint — 6 min · 4 pages')
  assert.equal(act[0].sessionId, 's1')
  // The old separate boxes are gone from the member page.
  const page = read('app/admin/users/[id]/page.tsx')
  assert.doesNotMatch(page, /Admin actions about them|<MemberActivity/)
})

// ── Part F: payment labels ─────────────────────────────────────────────

test('payment labels', () => {
  const now = Date.parse('2026-10-19T12:00:00Z')
  const base: PaymentFacts = { planCode: 'verified', amountPkr: 199, status: 'pending', provider: 'paypro', createdAt: '2026-10-19T09:00:00Z', hasReceipt: false }
  const show = { showAmount: true }
  assert.equal(paymentLabel(base, now, show), 'Verification Fee Rs 199 — started, not paid')
  assert.ok(paymentNeedsFollowUp(base, now))
  assert.equal(paymentLabel({ ...base, status: 'approved' }, now, show), 'Verification Fee Rs 199 — paid')
  assert.equal(paymentLabel({ ...base, provider: 'manual', hasReceipt: true }, now, show), 'Verification Fee Rs 199 — receipt waiting')
  assert.equal(paymentLabel({ ...base, status: 'approved', refundedAmountPkr: 199 }, now, show), 'Verification Fee Rs 199 — refunded')
  assert.equal(paymentLabel({ ...base, checkoutClosedAt: '2026-10-19T10:00:00Z', checkoutCloseReason: 'cancelled_by_member' }, now, show), 'Verification Fee Rs 199 — cancelled')
  assert.equal(paymentLabel({ ...base, checkoutClosedAt: '2026-10-19T10:00:00Z', checkoutCloseReason: 'expired' }, now, show), 'Verification Fee Rs 199 — expired')
  assert.equal(paymentLabel({ ...base, planCode: 'premium', amountPkr: 499, status: 'approved' }, now, show), 'Premium Rs 499 — paid')
  assert.equal(paymentLabel({ ...base, planCode: 'parent_featured', amountPkr: 999, status: 'approved' }, now, show), 'Parent Featured Rs 999 — paid')
  // Under an hour old: not yet "not paid", no follow-up.
  const fresh = { ...base, createdAt: '2026-10-19T11:30:00Z' }
  assert.equal(paymentNeedsFollowUp(fresh, now), false)
  // Viewers who may not see amounts get none.
  assert.equal(paymentLabel(base, now, { showAmount: false }), 'Verification Fee — started, not paid')
  assert.doesNotMatch(paymentLabel({ ...base, status: 'pending' }, now, show), /^Verified/)
})

// ── Part E: empty sections ─────────────────────────────────────────────

test('empty sections on one grey line', () => {
  assert.equal(
    emptySectionsLine(['jobs', 'applications', 'subscriptions', 'reportsAbout', 'reportsBy', 'penalties', 'flags']),
    'No jobs, applications, subscriptions, reports, penalties or flags.',
  )
  assert.equal(emptySectionsLine(['jobs']), 'No jobs.')
  assert.equal(emptySectionsLine(['reportsAbout', 'payments']), 'No payments or reports about them.')
  assert.equal(emptySectionsLine([]), null)
  assert.match(read('app/admin/users/[id]/page.tsx'), /if \(empty\) return null/)
})

// ── Part H: Partly approved ────────────────────────────────────────────

test('Tutors list: a Partly approved chip with its count', () => {
  assert.ok(DOC_FILTERS.includes('partial'))
  assert.equal(docFilterLabel('partial', false), 'Partly approved')
  const items = [{ docs: { kind: 'partial' as const, oldestUploadAt: null } }, { docs: { kind: 'approved' as const, oldestUploadAt: null } }]
  assert.equal(applyDocFilter(items, 'partial').length, 1)
  assert.equal(docFilterCounts(items).partial, 1)
})
