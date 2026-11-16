/**
 * scripts/test-followup-cleanup.ts — the follow-up clean-up (owner, 15 Nov 2026),
 * on INVENTED data only:
 *   1. member-page contacts (WhatsApp, a call that reached them, a voice note,
 *      a Team inbox send) log a follow-up and move the card; opening does not;
 *   2. the follow-up chips: due now · 1st · 2nd · 3rd+, and back to due;
 *   3. call outcomes: "No answer" stays due (again tomorrow), "Wrong number"
 *      suggests Not interested;
 *   4. a re-upload after a rejection: tagged, first in its stage, cleared on
 *      the decision;
 *   5. the member page has exactly one WhatsApp button; the compact card.
 *
 *   npm run test:followupcleanup
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

import {
  callLogAttempt,
  CALL_OUTCOMES_FROM,
  followBucket,
  followState,
  followTag,
  FU_BUCKETS,
  FU_DONE,
  kindAllowed,
  kindOfTemplateKey,
  pipelineOrder,
  pipeTemplateKey,
  REUPLOADED,
  retryPending,
  tutorStageFromAddress,
  type DocState,
  type PipeContact,
} from '../lib/tutorPipelineCore'
import {
  approvedAgoLine,
  feePendingDue,
  lastOutcomeLine,
  pipeCardFrom,
  pipeDetailLine,
  pipeMetaLine,
  pipeSortAt,
  pipeTags,
  REUPLOAD_SORT_AT,
  reuploadedAfterRejection,
  withContacts,
  type PipeDocFacts,
} from '../lib/tutorPipelineCardCore'
import type { CardDocState } from '../lib/tutorDocQueueCore'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const read = (p: string) => readFileSync(join(ROOT, p), 'utf8')
const DAY = 86_400_000
const T0 = Date.parse('2026-11-16T06:00:00Z') // after CALL_OUTCOMES_FROM
const iso = (ms: number) => new Date(ms).toISOString()
const day = (s: string) => new Date(s).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', timeZone: 'Asia/Karachi' })

function cs(s: DocState, reason: string | null = null): CardDocState {
  if (s === 'approved') return { status: 'approved', reason: null, hasUpload: true }
  if (s === 'waiting') return { status: 'pending', reason, hasUpload: true }
  if (s === 'rejected') return { status: 'rejected', reason, hasUpload: true }
  return { status: 'none', reason: null, hasUpload: false }
}
function docs(cnic: CardDocState, photo: CardDocState, selfie: CardDocState = cs('none'), approvedAt: string | null = null): PipeDocFacts {
  return { statuses: { cnic, profilePic: photo, selfie }, oldestUploadAt: null, approvedAt }
}
function card(a: { d?: PipeDocFacts; contacts?: PipeContact[]; now?: number; completion?: number }) {
  return pipeCardFrom({
    name: 'Invented Tutor',
    feePaid: false,
    completion: a.completion ?? 90,
    mobileOk: true,
    docs: a.d ?? docs(cs('approved'), cs('approved'), cs('none'), iso(T0 - 3 * DAY)),
    contacts: a.contacts ?? [],
    notInterested: false,
    paused: false,
    lastActiveAt: iso(T0),
    support: '0300 0000000',
    nowMs: a.now ?? T0,
  })
}
const contact = (at: number, kind: PipeContact['kind'], stage: PipeContact['stage'] = 'approved', extra: Partial<PipeContact> = {}): PipeContact => ({
  at: iso(at),
  kind,
  stage,
  docsApproved: null,
  staffName: 'Staff A',
  ...extra,
})

// -------------------------------------------------- 1. member page logs ---

test('member page WhatsApp, Call-Yes, voice note and inbox each log a follow-up and move the card', () => {
  const base = card({})
  assert.equal(base.stage, 'approved')
  assert.equal(base.section, 'not')
  // From the member page any of these counts as the next follow-up (not strict),
  // and each is stored with its kind and read back the same way.
  for (const kind of ['whatsapp', 'call', 'voice', 'inbox'] as const) {
    assert.equal(kindOfTemplateKey(pipeTemplateKey('approved', kind)), kind)
    const moved = withContacts(base, [contact(T0, kind)], T0 + 60_000)
    assert.equal(moved.section, 'done', `${kind} moves the card to a numbered chip`)
    assert.deepEqual(pipeTags(moved).fus, [FU_DONE, 'f1'])
    assert.equal(moved.follow?.sent, 1)
  }
  // A call that reached them and a Team inbox message count at ANY number.
  for (const next of ['whatsapp', 'voice', 'either'] as const) {
    assert.ok(kindAllowed(next, 'call'), `call at ${next}`)
    assert.ok(kindAllowed(next, 'inbox'), `inbox at ${next}`)
  }
  // The route: the card is strict, the member page is not; the inbox send logs.
  const route = read('app/api/admin/people/follow-up/route.ts')
  assert.match(route, /strict: \(b\.from \?\? 'card'\) === 'card'/)
  assert.match(route, /from: z\.enum\(\['card', 'member'\]\)/)
  assert.match(read('app/api/admin/inbox/route.ts'), /await recordInboxFollowUp\(body\.memberId!, gate\.actor/)
  assert.match(read('components/admin/PipeContactButtons.tsx'), /action: 'record', memberId, stage, kind, from/)
  assert.match(read('app/admin/users/[id]/MemberActions.tsx'), /<PipeContactButtons[\s\S]*?from="member"/)
})

test('opening a card or the member page logs nothing', () => {
  // A card's state is built from recorded contacts only; nothing is written on render.
  const page = read('app/admin/users/[id]/page.tsx')
  assert.ok(!/recordPipelineFollowUp|recordFollowUp|recordCallAttempt|\/api\/admin\/people\/follow-up/.test(page), 'the member page records nothing while rendering')
  assert.ok(!/recordPipelineFollowUp|recordFollowUp/.test((read('app/admin/users/PeopleTabs.tsx') + read('lib/peopleListQuery.ts'))), 'the People list records nothing')
  // The card's whole-card link is a plain navigation, never a POST.
  const pa = read('components/admin/PipelineActions.tsx')
  assert.match(pa, /<Link href=\{`\/admin\/users\/\$\{memberId\}`\} aria-label=\{`Open \$\{m\.name\}`\}/)
  // Unchanged when nothing new is recorded.
  const base = card({})
  assert.equal(withContacts(base, [], T0 + DAY).section, 'not')
})

// ------------------------------------------------------- 2. the chips ---

test('chip counts for due now, 1st, 2nd and 3rd+; each returns to due when its follow-up is due', () => {
  const people = [
    [], // never contacted → due now
    [contact(T0, 'whatsapp')], // 1st, due in 2 days
    [contact(T0 - 2 * DAY, 'whatsapp'), contact(T0, 'voice')], // 2nd
    [contact(T0 - 5 * DAY, 'whatsapp'), contact(T0 - 3 * DAY, 'voice'), contact(T0, 'call')], // 3rd
    [contact(T0 - 9 * DAY, 'whatsapp'), contact(T0 - 7 * DAY, 'voice'), contact(T0 - 4 * DAY, 'call'), contact(T0, 'whatsapp')], // 4th → 3rd+
    [contact(T0 - 3 * DAY, 'whatsapp')], // 1st but due again → due now
  ]
  const counts: Record<string, number> = { not: 0, f1: 0, f2: 0, f3: 0 }
  for (const cs1 of people) {
    const s = followState('approved', cs1, T0 + 60_000)
    const b = followBucket(s)
    assert.ok(b && (FU_BUCKETS as readonly string[]).includes(b))
    counts[b as string]++
    const tag = followTag(s)
    // Every chip lists exactly its own people; the old "done" lists every numbered one.
    if (b === 'not') assert.deepEqual(tag, ['not'])
    else assert.deepEqual(tag, [FU_DONE, b])
  }
  assert.deepEqual(counts, { not: 2, f1: 1, f2: 1, f3: 2 })
  // When the next one is due, they are back in "Not followed up".
  const one = [contact(T0, 'whatsapp')]
  assert.equal(followBucket(followState('approved', one, T0 + 2 * DAY - 1)), 'f1')
  assert.equal(followBucket(followState('approved', one, T0 + 2 * DAY)), 'not')
  const three = people[3]
  assert.equal(followBucket(followState('approved', three, T0 + 3 * DAY - 1)), 'f3')
  assert.equal(followBucket(followState('approved', three, T0 + 3 * DAY)), 'not')
  // The chips read the array tag; the old ?fu= addresses still resolve.
  const tabs = (read('app/admin/users/PeopleTabs.tsx') + read('lib/peopleListQuery.ts'))
  assert.match(tabs, /sqlParam: 'fus'/)
  assert.match(tabs, /\{ key: FU_DONE, label: 'Followed up \(all\)', hidden: true \}/)
  assert.ok(FU_BUCKETS[0] === 'not', '?fu=not is the first chip')
})

// ------------------------------------------------- 3. call outcomes ---

test('No answer: an attempt only — stays due, again the next day', () => {
  const att = contact(T0, 'call', null, { attempt: 'no_answer', staffName: 'Staff B' })
  const s = followState('approved', [att], T0 + 60_000)
  assert.equal(s.sent, 0, 'an attempt is never a follow-up')
  assert.equal(s.section, 'not')
  assert.equal(followBucket(s), 'not')
  assert.equal(s.retryAt, iso(T0 + DAY))
  assert.ok(retryPending(s, T0 + 60_000), 'not an act-now item today')
  assert.ok(!retryPending(s, T0 + DAY), 'due again the next day')
  const c = card({ contacts: [att], now: T0 + 60_000 })
  // PR-02 (16 Nov 2026): the badge counts the Not followed up chip exactly, so a
  // "No answer" today stays counted; the card says "try again <date>".
  assert.ok(feePendingDue(c, T0 + 60_000), 'still on the chip and in the badge')
  assert.ok(feePendingDue(c, T0 + DAY + 1))
  assert.match(lastOutcomeLine(c, day, T0 + 60_000) ?? '', /No answer by Staff B · try again /)
  // After a real follow-up, earlier attempts are done with.
  const later = followState('approved', [att, contact(T0 + 3_600_000, 'whatsapp')], T0 + 2 * 3_600_000)
  assert.equal(later.sent, 1)
  assert.equal(later.retryAt, null)
  // Call-log rows: "no answer" / "wrong number" are attempts at any date (PR-02).
  assert.equal(callLogAttempt('no_answer', CALL_OUTCOMES_FROM), 'no_answer')
  assert.equal(callLogAttempt('wrong_number', iso(T0)), 'wrong_number')
  assert.equal(callLogAttempt('no_answer', '2026-11-01T00:00:00.000Z'), 'no_answer')
  assert.equal(callLogAttempt('called', iso(T0)), null)
})

test('Wrong number is logged and suggests Not interested · Wrong number (staff confirm)', () => {
  const att = contact(T0, 'call', null, { attempt: 'wrong_number' })
  const s = followState('approved', [att], T0 + 1)
  assert.equal(s.sent, 0)
  assert.equal(s.lastAttempt?.outcome, 'wrong_number')
  const route = read('app/api/admin/people/follow-up/route.ts')
  assert.match(route, /suggestNotInterested: b\.outcome === 'wrong_number'/)
  const btn = read('components/admin/PipeContactButtons.tsx')
  assert.match(btn, /title: 'Mark as Not interested\?'/)
  assert.match(btn, /body: JSON\.stringify\(\{ memberId, reason: 'wrong_number' \}\)/)
  assert.match(btn, /'Yes, talked'[\s\S]*'No answer'[\s\S]*'Wrong number'/)
  // "Call done" is gone everywhere.
  for (const f of ['components/admin/PipelineActions.tsx', 'components/admin/PipeContactButtons.tsx', 'components/admin/OverviewCardGrid.tsx']) assert.ok(!read(f).includes('Call done'), f)
  assert.match(read('supabase/migrations/231_call_outcome_wrong_number.sql'), /'wrong_number'/)
})

// ------------------------------------------------------- 4. re-uploads ---

test('a re-upload after a rejection is tagged, sorted first, and clears on the decision', () => {
  // A new CNIC after a rejection: waiting, the old reason kept.
  const reup = docs(cs('waiting', 'Blurry'), cs('approved'))
  assert.ok(reuploadedAfterRejection(reup.statuses))
  const c = card({ d: reup })
  assert.ok(c.reuploaded)
  assert.equal(c.stage, 'waiting', 'meets the Waiting rule (both in, one pending, 80%+)')
  assert.deepEqual(pipeTags(c).stages, ['waiting', REUPLOADED])
  assert.equal(pipeSortAt(c), REUPLOAD_SORT_AT, 'first in the oldest-first Waiting list')
  // Under 80%: not Waiting — top of its own stage instead.
  const low = card({ d: reup, completion: 60 })
  assert.equal(low.stage, 'missing')
  assert.ok(low.reuploaded)
  const sorted = pipelineOrder([
    { stage: 'missing' as const, section: 'not' as const, paused: false, lastActiveAt: iso(T0 + DAY), id: 'other' },
    { stage: 'missing' as const, section: 'not' as const, paused: false, lastActiveAt: iso(T0 - 9 * DAY), reuploaded: true, id: 'reup' },
  ])
  assert.equal(sorted[0].id, 'reup')
  // A first upload (no rejection) and an approved re-review are not re-uploads.
  assert.ok(!reuploadedAfterRejection(docs(cs('waiting'), cs('approved')).statuses))
  assert.ok(!reuploadedAfterRejection(docs({ status: 'pending', reason: null, hasUpload: true, rereview: true }, cs('approved')).statuses))
  // Staff decide: approved or rejected again — the tag clears.
  assert.ok(!card({ d: docs(cs('approved'), cs('approved')) }).reuploaded)
  assert.ok(!card({ d: docs(cs('rejected', 'Blurry'), cs('approved')) }).reuploaded)
  // The stage row offers "Re-uploaded".
  assert.equal(tutorStageFromAddress({ tab: 'tutors', stage: 'reuploaded' }), 'reuploaded')
  assert.match((read('app/admin/users/PeopleTabs.tsx') + read('lib/peopleListQuery.ts')), /\{ key: REUPLOADED, label: REUPLOADED_LABEL(, hint: CHIP_HINT.reuploaded)? \}/)
})

// ------------------------------------------- 5. member page + compact card ---

test('the member page has exactly one WhatsApp button', () => {
  const page = read('app/admin/users/[id]/page.tsx')
  assert.ok(!page.includes('PaymentFollowUp'), 'the payment-row WhatsApp is gone')
  const ma = read('app/admin/users/[id]/MemberActions.tsx')
  // Contact: the pipeline's buttons OR the plain WhatsApp — never both.
  assert.match(ma, /\{pipeContact \? \(\s*<PipeContactButtons[\s\S]*?\) : \(\s*<>\s*\{whatsappMsisdn && \(\s*<AdminWhatsAppLink/)
  assert.equal((ma.match(/<AdminWhatsAppLink/g) ?? []).length, 1)
  const btn = read('components/admin/PipeContactButtons.tsx')
  assert.equal((btn.match(/data-pipe-wa=""/g) ?? []).length, 1, 'one WhatsApp anchor')
  assert.match(btn, /waHref/)
  // The ready message is built with lib/waLinkCore.
  assert.match(page, /waSendHref\(memberMsisdn, pipeCard\.message, senderCode\)/)
})

test('the compact card: one meta line, a detail line, a last-outcome line; approval age and order', () => {
  assert.equal(pipeMetaLine({ city: 'Multan', joinedAt: '2026-11-08T07:00:00Z', completion: 94 }, day), 'Multan · joined 8 Nov · 94%')
  assert.equal(pipeMetaLine({ city: null, joinedAt: null, completion: 50 }, day), '50%')
  const c = card({})
  assert.equal(approvedAgoLine(iso(T0 - 3 * DAY), T0), 'Approved 3 days ago')
  assert.equal(approvedAgoLine(iso(T0), T0), 'Approved today')
  assert.equal(pipeDetailLine(c, T0), 'Approved 3 days ago')
  assert.ok(!/Approved, fee pending|Documents approved · fee pending/.test(pipeDetailLine(c, T0) ?? ''), 'the stage is not repeated')
  assert.equal(lastOutcomeLine(c, day, T0), 'Never contacted · Follow-up 1 due')
  // Approved before the follow-up (PR-02: contacts count from the approval on).
  const early = card({ d: docs(cs('approved'), cs('approved'), cs('none'), '2026-11-10T07:00:00Z') })
  const sent = withContacts(early, [contact(Date.parse('2026-11-11T07:00:00Z'), 'whatsapp', 'approved', { staffName: 'Alee' })], Date.parse('2026-11-12T07:00:00Z'))
  assert.equal(lastOutcomeLine(sent, day, Date.parse('2026-11-12T07:00:00Z')), '11 Nov · WhatsApp by Alee · Follow-up 2 due 13 Nov')
  // Approved, fee pending: newest approval first (owner, 15 Nov 2026).
  const order = pipelineOrder([
    { stage: 'approved' as const, section: 'not' as const, paused: false, lastActiveAt: iso(T0 - 5 * DAY), approvedAt: iso(T0 - 9 * DAY), id: 'old' },
    { stage: 'approved' as const, section: 'not' as const, paused: false, lastActiveAt: iso(T0), approvedAt: iso(T0 - DAY), id: 'new' },
  ], T0)
  assert.deepEqual(order.map((r) => r.id), ['new', 'old'])
  // The layout rules in the source.
  const pa = read('components/admin/PipelineActions.tsx')
  assert.ok(!/>\s*Joined\s*</.test(pa) && !/>\s*Fee\s*</.test(pa), 'no Joined or Fee rows')
  assert.ok(!/ExternalLink aria-hidden size=\{13\} \/> Open/.test(pa), 'no big Open button')
  assert.match(pa, /showWhatsApp=\{due\}/)
  const grid = read('components/admin/OverviewCardGrid.tsx')
  assert.match(grid, /data-chip-row=""/)
  assert.match(grid, /flex-nowrap gap-2 overflow-x-auto/)
  assert.match(grid, /sticky top-\[61px\]/)
})

test('Approved, fee pending: newest approval first in every chip; bottom rules still apply', () => {
  const row = (id: string, approvedDaysAgo: number, extra: Record<string, unknown> = {}) => ({
    id,
    stage: 'approved' as const,
    section: 'done' as const,
    paused: false,
    lastActiveAt: iso(T0 - 2 * DAY),
    approvedAt: iso(T0 - approvedDaysAgo * DAY),
    ...extra,
  })
  const order = pipelineOrder(
    [
      row('old', 40),
      row('noMobile', 1, { noMobile: true }),
      row('mid', 10, { lastActiveAt: iso(T0 - 9 * DAY) }),
      row('pausedNew', 0, { paused: true }),
      row('newest', 2),
      row('recent', 1, { lastContactAt: iso(T0 - DAY) }),
      row('tieActive', 10, { lastActiveAt: iso(T0) }),
      row('contactedLongAgo', 5, { lastContactAt: iso(T0 - 4 * DAY) }),
    ],
    T0,
  )
  assert.deepEqual(order.map((r) => r.id), ['newest', 'contactedLongAgo', 'tieActive', 'mid', 'old', 'recent', 'pausedNew', 'noMobile'])
  // The page keeps the stored order (pos) for every Approved chip.
  assert.match((read('app/admin/users/PeopleTabs.tsx') + read('lib/peopleListQuery.ts')), /sel\.stage !== 'approved'/)
  // Other stages are untouched by the approval date.
  const missing = pipelineOrder(
    [
      { id: 'a', stage: 'missing' as const, section: 'not' as const, paused: false, lastActiveAt: iso(T0 - DAY), approvedAt: iso(T0) },
      { id: 'b', stage: 'missing' as const, section: 'not' as const, paused: false, lastActiveAt: iso(T0), approvedAt: iso(T0 - 9 * DAY) },
    ],
    T0,
  )
  assert.deepEqual(missing.map((r) => r.id), ['b', 'a'])
})
