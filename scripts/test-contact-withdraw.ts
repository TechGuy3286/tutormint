/**
 * scripts/test-contact-withdraw.ts — "Withdraw a contact" and the Do not use
 * list (owner, 27 Oct 2026). Pure rules (lib/contactWithdrawCore), the
 * hidden-tuition rules a withdrawn tuition inherits, and source checks of the
 * routes, the page and every posting path. Invented numbers only; no database.
 *   npx tsx --test scripts/test-contact-withdraw.ts
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, readdirSync } from 'node:fs'

import {
  DO_NOT_USE_MESSAGE,
  NUMBER_REMOVED,
  WITHDRAWN_LABEL,
  WITHDRAWN_REASON,
  auditDetailSafe,
  closeUpdate,
  consentCounts,
  contactUpdate,
  listedNumber,
  maskNumber,
  numberHash,
  numbersInText,
  parseWithdrawNumber,
  reasonProblem,
  scrubNumber,
  textHasNumber,
  tuitionNumbers,
} from '../lib/contactWithdrawCore'
import { hiddenTuitionTarget, isHiddenTuition, NO_LONGER_AVAILABLE_TUTOR } from '../lib/hiddenTuitionCore'
import { tuitionPublicState } from '../lib/tuitionStatus'
import { dueState, todoBadgeCount } from '../lib/applicationFollowUpCore'
import { forwardOverdue, paidCounts } from '../lib/paidTutorsCore'
import { canApprove } from '../lib/adminAccessCore'
import { AUDIT_LABELS } from '../lib/timelineLabelsCore'

const src = (p: string) => readFileSync(p, 'utf8')
// Invented: 0399 is not an issued Pakistani mobile range.
const M = '923991234567'

test('every common phone format reaches the same number', () => {
  for (const raw of ['03991234567', '0399 1234567', '0399-1234567', '+92 399 1234567', '+923991234567', '923991234567', '92 399 1234567', '00923991234567', ' 0399.123.4567 ']) {
    assert.equal(parseWithdrawNumber(raw), M, raw)
    assert.equal(numberHash(parseWithdrawNumber(raw)!), numberHash(M))
  }
  for (const bad of ['', '12345', '0423 1234567', 'abc', '0399123456']) assert.equal(parseWithdrawNumber(bad), null, bad)
})

test('hash and mask never hold the number in the clear', () => {
  const h = numberHash(M)
  assert.match(h, /^[0-9a-f]{64}$/)
  assert.ok(!h.includes('3991234567'))
  assert.notEqual(numberHash('923991234568'), h)
  assert.equal(maskNumber(M), '0399 •••• 567')
})

test('numbers written in text are found and scrubbed — only that number', () => {
  const text = 'Call 0399-1234567 or 0398 7654321. Fee 15000-20000.'
  assert.deepEqual(numbersInText(text).sort(), ['923987654321', M].sort())
  assert.ok(textHasNumber(text, M))
  const out = scrubNumber(text, M)!
  assert.ok(out.includes(NUMBER_REMOVED))
  assert.ok(!out.includes('1234567'))
  assert.ok(out.includes('0398 7654321'))
  assert.ok(out.includes('15000-20000'))
  assert.equal(scrubNumber('no number here', M), 'no number here')
  assert.equal(scrubNumber(null, M), null)
})

test('closing a tuition: hidden, contact_withdrawn, earlier status kept, number removed', () => {
  const u = closeUpdate({ status: 'open', title: 'Home tutor 0399 1234567', description: 'WhatsApp +92 399 1234567' }, M, '2026-10-27T10:00:00.000Z')
  assert.equal(u.status, 'hidden')
  assert.equal(u.hidden_reason, WITHDRAWN_REASON)
  assert.equal(u.hidden_prev_status, 'open')
  assert.equal(u.is_featured, false)
  assert.ok(!String(u.title).includes('1234567'))
  assert.ok(!String(u.description).includes('1234567'))
  // Already hidden with its parent: keep the earlier status it had.
  const h = closeUpdate({ status: 'hidden', title: 't', description: null }, M, 'x')
  assert.equal(h.hidden_reason, WITHDRAWN_REASON)
  assert.equal('hidden_prev_status' in h, false)
})

test('the number is removed from stored contact data', () => {
  const u = contactUpdate({ contact_phone: M, contact_whatsapp: '0399-1234567', contact_social: 'wa.me/923991234567', contact_address: 'House 1' }, M)!
  assert.equal(u.contact_phone, null)
  assert.equal(u.contact_whatsapp, null)
  assert.ok(!String(u.contact_social).includes('1234567'))
  assert.equal('contact_address' in u, false)
  assert.equal(contactUpdate({ contact_phone: '923987654321', contact_whatsapp: null, contact_social: null, contact_address: null }, M), null)
})

test('a withdrawn tuition: 301 to its city listing, no JobPosting, out of the sitemap', () => {
  assert.ok(isHiddenTuition('hidden'))
  assert.equal(hiddenTuitionTarget('Lahore', true), '/tuition-jobs/lahore')
  assert.equal(hiddenTuitionTarget('Lahore', false), '/browse/tuitions')
  const s = tuitionPublicState('hidden')
  assert.equal(s.emitJobPosting, false)
  assert.equal(s.inSitemap, false)
  assert.equal(s.indexable, false)
  // The 301 and the sitemap both read status, so contact_withdrawn is covered.
  assert.match(src('supabase/migrations/198_staff_cleanup_hidden_tuitions.sql'), /where j\.status = 'hidden'/)
  assert.match(src('lib/sitemaps.ts') + src('supabase/migrations/178_tuitions_on_google.sql'), /status = 'open'/)
  // The account-flag sync never un-hides or re-labels a withdrawn tuition.
  const m = src('supabase/migrations/207_contact_withdraw.sql')
  assert.equal((m.match(/hidden_reason is distinct from 'contact_withdrawn'/g) ?? []).length, 2)
})

test('applications on a withdrawn tuition leave To do, the red rules and every badge', () => {
  const item = { id: 'a', stage: 'applied' as const, stageChangedAt: '2026-10-01T00:00:00Z', ownerId: 'o', createdAt: '2026-10-01T00:00:00Z', jobCreatedAt: new Date().toISOString(), unavailable: true }
  const due = dueState(item, [], Date.now())
  assert.equal(due.tab, 'sent')
  assert.equal(due.overdue, null)
  assert.equal(todoBadgeCount([{ ...item, due }], { id: 'o', adminRole: 'owner' }), 0)
  const app = { jobId: 'j', stage: 'applied', createdAt: '2026-10-01T00:00:00Z', stageChangedAt: null, jobCreatedAt: new Date().toISOString(), forwarded: false, unavailable: true }
  assert.equal(forwardOverdue(app, Date.now()), false)
  assert.equal(paidCounts([app]).waitingToForward, 0)
  assert.equal(NO_LONGER_AVAILABLE_TUTOR, 'This tuition is no longer available')
  // The server lists read status 'hidden' (which a withdrawal sets).
  assert.match(src('lib/hiddenTuition.ts'), /eq\('status', 'hidden'\)/)
  assert.match(src('lib/applicantForwards.ts'), /eq\('status', 'hidden'\)/)
})

test('Do not use: the list check and the refusal text', () => {
  const live = new Set([numberHash(M)])
  assert.ok(listedNumber(['0399 1234567'], live))
  assert.ok(listedNumber([null, '+92-399-1234567'], live))
  assert.ok(!listedNumber(['0398 7654321', null, ''], live))
  assert.deepEqual(tuitionNumbers({ contactPhone: '0398 7654321', description: 'call 0399-1234567' }).sort(), ['923987654321', M].sort())
  assert.equal(DO_NOT_USE_MESSAGE, "This number has asked not to be contacted. Please don't use it.")
})

test('Do not use blocks every posting path', () => {
  const jobs = src('lib/jobs.ts')
  for (const fn of ['createJob', 'createTeamJob', 'updateTeamJob', 'updateJob']) {
    const start = jobs.indexOf(`export async function ${fn}(`)
    const next = jobs.indexOf('\nexport async function ', start + 10)
    assert.ok(start > 0, fn)
    assert.match(jobs.slice(start, next), /doNotUseRefusal\(/, `${fn} checks the list`)
  }
  assert.match(src('lib/tuitionContact.ts'), /doNotUseRefusal\(\[parsed\.msisdn\]\)/)
  assert.match(src('lib/import.ts'), /doNotUse\(\[msisdn, row\.whatsapp\]\)[\s\S]*DO_NOT_USE_MESSAGE/)
  assert.match(src('app/api/admin/members/route.ts'), /doNotUseRefusal\(\[newMobile\]\)/)
  assert.match(src('app/api/admin/tutors/edit/route.ts'), /doNotUseRefusal\(\[newMobile\]\)/)
})

test('owner only, with the password asked again for changes', () => {
  assert.equal(canApprove('owner'), true)
  for (const r of ['partner', 'admin', 'operations', 'supervisor', 'tuitions_staff'] as const) assert.equal(canApprove(r), false, r)
  assert.match(src('lib/contactWithdrawGate.ts'), /refuseUnlessOwnerApproval\(/)
  const dir = 'app/api/admin/contact-withdraw'
  const routes = readdirSync(dir).map((d) => src(`${dir}/${d}/route.ts`))
  assert.equal(routes.length, 3)
  for (const r of routes) assert.match(r, /ownerContactGate\(await checkAdminRole\(\.\.\.SCREEN_ACCESS\.contactWithdraw\)/)
  assert.match(src(`${dir}/withdraw/route.ts`), /requireFreshAuth\(/)
  assert.match(src(`${dir}/list/route.ts`), /export async function POST[\s\S]*requireFreshAuth\(/)
  // The number travels in a POST body, never a URL.
  assert.doesNotMatch(src(`${dir}/search/route.ts`), /export async function GET/)
  assert.match(src('app/admin/withdraw-contact/page.tsx'), /if \(!canApprove\(actor\.adminRole\)\) redirect\('\/admin'\)/)
})

test('no phone number in logs or Audit', () => {
  assert.ok(auditDetailSafe({ reason: 'Person says they never posted', refs: ['TM-1065'], closed: 2 }))
  assert.ok(!auditDetailSafe({ reason: 'x', n: '0399 1234567' }))
  assert.ok(!auditDetailSafe({ masked: '923991234567' }))
  assert.ok(reasonProblem('Asked to be removed, number 0399 1234567'))
  assert.equal(reasonProblem('Person says they never posted; asked for removal'), null)
  assert.ok(reasonProblem('ab'))
  const io = src('lib/contactWithdraw.ts')
  // console lines name no number, and Audit details carry no number or mask.
  for (const line of io.split('\n').filter((l) => l.includes('console.'))) assert.doesNotMatch(line, /msisdn|masked|phone/)
  for (const block of io.split('logAdminAction(').slice(1)) {
    const detail = block.slice(0, block.indexOf('})') + 2)
    assert.doesNotMatch(detail, /msisdn|masked/)
  }
  for (const a of ['contact.withdraw', 'contact.do_not_use_remove', 'job.close_contact_withdrawn']) assert.ok(AUDIT_LABELS[a], a)
  assert.equal(WITHDRAWN_LABEL, 'Closed: contact withdrawn')
})

test('consent report: counts per staff, numbers that belong to an account left out', () => {
  const rows = [
    { postedBy: 's1', number: '0399 1234567' },
    { postedBy: 's1', number: '0398 7654321' },
    { postedBy: 's2', number: '0397 1111111' },
    { postedBy: null, number: '0396 2222222' },
    { postedBy: 's2', number: 'not a number' },
  ]
  const out = consentCounts(rows, new Set(['923987654321']), (id) => (id === 's1' ? 'Aqsa' : 'Nabeel'))
  assert.deepEqual(out, [
    { staff: 'Aqsa', count: 1 },
    { staff: 'Nabeel', count: 1 },
    { staff: 'Unknown poster', count: 1 },
  ])
})
