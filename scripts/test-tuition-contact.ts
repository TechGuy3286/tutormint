/**
 * scripts/test-tuition-contact.ts — npm run test:tuitioncontact
 * Owner, 12 Oct 2026:
 *   A. Overview card "Signed up today, not paid" — its number equals the Today
 *      list, excludes staff/test/paid, and uses the Pakistan-time day.
 *   B. A tuition must always have the parent's contact number — every accepted
 *      format normalises, invalid numbers are refused (form, API, bulk rows), a
 *      parent-posted tuition uses the verified mobile, the clean-up pauses only
 *      live no-contact tuitions and is safe to run twice, Resume requires a
 *      number, and the Partner cannot post, edit or resume.
 * Pure rules plus source scans; nothing touches a database.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { isReadOnlyRole, roleSatisfies, SCREEN_ACCESS } from '../lib/adminAccessCore'
import { OVERVIEW_ITEMS, OVERVIEW_ITEM_KEYS, SIGNUPS_TODAY_HREF } from '../lib/overviewItemsCore'
import { tutorInScope } from '../lib/staffOutreachCore'
import { isTestName, parseUnpaidFilter, pkDayStart, signedUpIn, signupCounts, unpaidRowMatches } from '../lib/staffOutreachCore'
import {
  CONTACT_NUMBER_MESSAGE,
  NO_CONTACT_ACTOR,
  NO_CONTACT_REASON,
  NO_CONTACT_SOURCE,
  parseContactNumber,
  resumeContactProblem,
  splitByContactNumber,
  tuitionContactNumber,
  tuitionsToPause,
  type CleanupJob,
} from '../lib/tuitionContactCore'

const root = join(__dirname, '..')
const read = (...p: string[]) => readFileSync(join(root, ...p), 'utf8').replace(/\r\n/g, '\n')

// 12 Oct 2026, 10:00 in Pakistan (05:00 UTC).
const NOW = Date.parse('2026-10-12T05:00:00Z')

test('A. the Pakistan-time day: today starts at 00:00 PKT, which is 19:00 UTC the evening before', () => {
  assert.equal(new Date(pkDayStart(NOW)).toISOString(), '2026-10-11T19:00:00.000Z')
  // 00:30 PKT on the 12th is still "today"; 23:30 PKT on the 11th is "yesterday".
  assert.equal(signedUpIn('2026-10-11T19:30:00Z', 'today', NOW), true)
  assert.equal(signedUpIn('2026-10-11T18:30:00Z', 'today', NOW), false)
  assert.equal(signedUpIn('2026-10-11T18:30:00Z', 'yesterday', NOW), true)
  assert.equal(signedUpIn('2026-10-10T19:00:00Z', 'yesterday', NOW), true, '00:00 PKT on the 11th')
  assert.equal(signedUpIn('2026-10-10T18:59:59Z', 'yesterday', NOW), false)
  // Late evening in Pakistan is the same Pakistan day although UTC has not turned.
  const late = Date.parse('2026-10-12T18:30:00Z') // 23:30 PKT on the 12th
  assert.equal(new Date(pkDayStart(late)).toISOString(), '2026-10-11T19:00:00.000Z')
  // 00:10 PKT on the 13th: a sign-up at 23:50 PKT on the 12th is now "yesterday".
  const next = Date.parse('2026-10-12T19:10:00Z')
  assert.equal(signedUpIn('2026-10-12T18:50:00Z', 'today', next), false)
  assert.equal(signedUpIn('2026-10-12T18:50:00Z', 'yesterday', next), true)
  // Last 7 days includes today; nothing from the future or unreadable counts.
  assert.equal(signedUpIn('2026-10-05T06:00:00Z', 'week', NOW), true)
  assert.equal(signedUpIn('2026-10-05T04:00:00Z', 'week', NOW), false)
  assert.equal(signedUpIn('2026-10-12T06:00:00Z', 'today', NOW), false)
  assert.equal(signedUpIn(null, 'today', NOW), false)
})

test('A. the card number equals the rows of the Today filter, followed up or not', () => {
  const rows = [
    { id: 'a', joinedAt: '2026-10-12T02:00:00Z', stoppedAt: 'Gender', lastContactAt: null, followUpSent: false },
    { id: 'b', joinedAt: '2026-10-11T20:00:00Z', stoppedAt: null, lastContactAt: '2026-10-12T03:00:00Z', followUpSent: true },
    { id: 'c', joinedAt: '2026-10-11T10:00:00Z', stoppedAt: 'Gender', lastContactAt: null, followUpSent: false },
    { id: 'd', joinedAt: '2026-10-07T10:00:00Z', stoppedAt: 'Gender', lastContactAt: null, followUpSent: false },
    { id: 'e', joinedAt: '2026-09-20T10:00:00Z', stoppedAt: 'Gender', lastContactAt: null, followUpSent: false },
  ]
  const counts = signupCounts(rows, NOW)
  assert.deepEqual(counts, { today: 2, yesterday: 1, week: 4 })
  const list = (f: string) => rows.filter((r) => unpaidRowMatches(r, parseUnpaidFilter(f), NOW)).map((r) => r.id)
  assert.deepEqual(list('today'), ['a', 'b'], 'a followed-up tutor still counts in Today')
  assert.equal(list('today').length, counts.today)
  assert.equal(list('yesterday').length, counts.yesterday)
  assert.equal(list('week').length, counts.week)
  // The other tabs keep their rule: a followed-up tutor is only under Follow-up sent.
  assert.deepEqual(list('all'), ['a', 'c', 'd', 'e'])
  assert.deepEqual(list('followed'), ['b'])
  assert.equal(parseUnpaidFilter('nonsense'), 'all')

  // One loader, one rule: the Overview item filters the SAME list with signedUpIn.
  const items = read('lib', 'overviewItems.ts')
  assert.ok(items.includes("case 'signups-today'") && items.includes("const all = await unpaid()") && items.includes("signedUpIn(r.joinedAt, 'today', nowMs)"))
  assert.ok(items.includes('const unpaid = cache(async () => (await loadUnpaidSignups(new Date())).filter((r) => !r.feePaid))'))
  assert.ok(items.includes('`${counts.yesterday} yesterday · ${counts.week} in the last 7 days`'))
  // Unpaid signups is the Tutors tab of People → Follow-ups (owner, 15 Oct 2026).
  const page = read('app', 'admin', 'follow-ups', 'page.tsx')
  // One merged list (owner, 20 Oct 2026): the sign-up day filter is the same signedUpIn rule.
  assert.ok(page.includes('loadTutorFollowUps(scope)') && page.includes('!r.feePaid && signedUpIn(r.joinedAt, window, now)'))
  for (const label of ["label: 'Today'", "label: 'Yesterday'", "label: 'Last 7 days'"]) assert.ok(page.includes(label), label)
  assert.ok(page.includes('UnpaidSignupRow'), 'the existing WhatsApp / Call / Follow-up sent rows — no new list')
})

test('A. staff, test, paused, banned and paid accounts are not in the number', () => {
  const lib = read('lib', 'staffOutreach.ts')
  // The one filter of the list the card reads.
  for (const piece of ['!p.is_suspended', '!p.is_banned', '!p.is_seed', '!p.is_team_account', '!p.admin_role', '!isTestName(p.full_name', '!excluded.has(p.id'])
    assert.ok(lib.includes(piece), piece)
  // Since 21 Oct 2026 the Follow-ups list keeps a paid tutor who has not
  // finished; the CARD counts only fee-unpaid sign-ups (lib/overviewItems).
  assert.ok(lib.includes('feeStamped: !!t.verified_fee_paid_at') && lib.includes('if (!inScope) continue'))
  assert.equal(tutorInScope({ joinedAt: new Date().toISOString(), feeStamped: true, feeApproved: true, onboarded: false }, 'recent', Date.now()), true)
  assert.ok(read('lib', 'overviewItems.ts').includes('.filter((r) => !r.feePaid)'), 'a tutor who paid is left out of the number')
  assert.ok(lib.includes(".eq('role', 'tutor')"))
  assert.equal(isTestName('Test Tutor 6'), true)
  assert.equal(isTestName('New User'), true)
  assert.equal(isTestName('Ayesha Khan'), false)
})

test('A. the sixth card: its own tone, the same visibility rule, and it opens Unpaid signups → Today', () => {
  assert.ok((OVERVIEW_ITEM_KEYS as readonly string[]).includes('signups-today'))
  assert.equal(OVERVIEW_ITEMS['signups-today'].title, 'Signed up today, not paid')
  assert.equal(OVERVIEW_ITEMS['signups-today'].screen, 'unpaidSignups')
  assert.equal(SIGNUPS_TODAY_HREF, '/admin/follow-ups?filter=today')
  const page = read('app', 'admin', 'page.tsx')
  assert.ok(page.includes("const CARD_KEYS: OverviewItemKey[] = ['revenue', 'paid-today', 'tutors', 'parents', 'open-tuitions', 'signups-today']"))
  assert.ok(page.includes("k === 'signups-today' ? SIGNUPS_TODAY_HREF"))
  // A tone no other card uses.
  const styles = page.slice(page.indexOf('const TILE_STYLE'), page.indexOf('const CARD_KEYS'))
  const tones = [...styles.matchAll(/tone: '(\w+)'/g)].map((m) => m[1])
  assert.equal(tones.length, 6)
  assert.equal(new Set(tones).size, 6, tones.join(','))
  assert.ok(page.includes("'signups-today': { tone: 'pink', icon: UserPlus"))
  // Six cards fill the phone's 2-column grid; visibility is the item's own screen key.
  assert.ok(page.includes('grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6'))
  assert.ok(page.includes('roleSatisfies(actor.adminRole, SCREEN_ACCESS[OVERVIEW_ITEMS[key].screen])'))
})

test('B. every accepted number format normalises to one stored format', () => {
  for (const typed of ['0300 1234567', '0300-1234567', '03001234567', '+92 300 1234567', '+923001234567', '923001234567', '92 300 1234567', '00923001234567', ' 0300  123 4567 ', '(0300) 1234567']) {
    assert.deepEqual(parseContactNumber(typed), { ok: true, msisdn: '923001234567' }, typed)
  }
})

test('B. anything else is refused with the plain message — form, API and bulk rows', () => {
  assert.equal(CONTACT_NUMBER_MESSAGE, "Enter the parent's mobile number, e.g. 0300 1234567.")
  for (const bad of ['', '   ', null, undefined, '12345', '0300 123456', '0300 12345678', '042 35761234', '+1 415 555 0100', '0200 1234567', 'call me', 'abc@example.com']) {
    assert.deepEqual(parseContactNumber(bad), { ok: false, error: CONTACT_NUMBER_MESSAGE }, String(bad))
  }
  // The form: required for staff, checked before the round trip.
  const form = read('components', 'forms', 'PostTuitionForm.tsx')
  assert.ok(form.includes('Parent contact number (required)') && form.includes('aria-required="true"'))
  assert.ok(form.includes('if (adminExtras) {\n        const number = parseContactNumber(v.contactPhone)\n        if (!number.ok) throw new Error(number.error)'))
  // The API: Post a tuition AND Edit tuition refuse without it, before anything is written.
  const jobs = read('lib', 'jobs.ts')
  assert.equal((jobs.match(/const number = parseContactNumber\(input\.contactPhone\)\n  if \(!number\.ok\) return \{ ok: false, status: 400, error: number\.error \}/g) ?? []).length, 2, 'createTeamJob and updateTeamJob')
  assert.ok(jobs.indexOf('const number = parseContactNumber(input.contactPhone)') < jobs.indexOf("const teamId = await teamParentId()"), 'refused before any write')
  // Only two paths create a tuition: a parent's post and a staff post.
  assert.equal((jobs.match(/\.from\('jobs'\)\s*\n?\s*\.insert\(/g) ?? []).length, 2)
  // Bulk rows: valid ones pass in the one format, the rest are skipped and named.
  const split = splitByContactNumber([
    { row: 2, contactPhone: '0300-1234567' },
    { row: 3, contactPhone: '' },
    { row: 4, contactPhone: '+92 321 5872222' },
    { row: 5, contactPhone: 'landline 042 111' },
  ])
  assert.deepEqual(split.ok.map((r) => [r.row, r.msisdn]), [[2, '923001234567'], [4, '923215872222']])
  assert.deepEqual(split.skipped, [{ row: 3, reason: CONTACT_NUMBER_MESSAGE }, { row: 5, reason: CONTACT_NUMBER_MESSAGE }])
})

test('B. a parent-posted tuition uses the parent’s verified mobile; a staff-posted one its own number', () => {
  const verified = { isTeam: false, parentPhone: '0300 1234567', parentPhoneVerifiedAt: '2026-10-01T00:00:00Z' }
  assert.equal(tuitionContactNumber(verified), '923001234567')
  assert.equal(tuitionContactNumber({ ...verified, parentPhoneVerifiedAt: null }), null, 'an unverified mobile is not a contact number')
  // A number typed for the tuition is ignored for a parent's own post.
  assert.equal(tuitionContactNumber({ isTeam: false, contactPhone: '0300 1234567', parentPhone: null, parentPhoneVerifiedAt: null }), null)
  assert.equal(tuitionContactNumber({ isTeam: true, contactPhone: '923001234567' }), '923001234567')
  assert.equal(tuitionContactNumber({ isTeam: true, contactPhone: null, contactWhatsapp: '0321 5872222' }), '923215872222')
  assert.equal(tuitionContactNumber({ isTeam: true, contactPhone: 'not a number', contactWhatsapp: '' }), null)
  assert.equal(tuitionContactNumber({ isTeam: true }), null)
  // A parent cannot post at all without a verified mobile (the standing gate).
  const jobs = read('lib', 'jobs.ts')
  assert.ok(jobs.includes('PARENT_MOBILE_GATE_MESSAGE'))
})

const job = (o: Partial<CleanupJob> & { id: string }): CleanupJob => ({ status: 'open', isTeam: true, contactPhone: null, contactWhatsapp: null, ...o })

test('B. the clean-up pauses only live tuitions with no number, and a second run pauses nothing', () => {
  const jobs = [
    job({ id: 'no-number' }),
    job({ id: 'has-number', contactPhone: '923001234567' }),
    job({ id: 'whatsapp-only', contactWhatsapp: '0300 1234567' }),
    job({ id: 'bad-number', contactPhone: '12345' }),
    job({ id: 'paused-no-number', status: 'paused' }),
    job({ id: 'closed-no-number', status: 'closed' }),
    job({ id: 'hired-no-number', status: 'hired' }),
    job({ id: 'parent-verified', isTeam: false, parentPhone: '0300 1234567', parentPhoneVerifiedAt: '2026-10-01T00:00:00Z' }),
    job({ id: 'parent-unverified', isTeam: false, parentPhone: '0300 1234567', parentPhoneVerifiedAt: null }),
  ]
  const first = tuitionsToPause(jobs).map((j) => j.id)
  assert.deepEqual(first, ['no-number', 'bad-number', 'parent-unverified'])
  // Run it again on the result: those three are paused now, so nothing is left.
  const after = jobs.map((j) => (first.includes(j.id) ? { ...j, status: 'paused' } : j))
  assert.deepEqual(tuitionsToPause(after), [])

  assert.deepEqual([NO_CONTACT_SOURCE, NO_CONTACT_REASON, NO_CONTACT_ACTOR], ['no_contact', 'No contact number', 'system: missing contact'])
  const script = read('scripts', 'dataop-pause-no-contact-tuitions.ts')
  assert.ok(script.includes("const apply = process.argv.includes('--apply')") && script.includes('DRY RUN — nothing changed'))
  assert.ok(script.includes("update jobs set status = 'paused', paused_at = $2, pause_source = $3 where id = $1 and status = 'open'"), 'only a live tuition, only the pause columns')
  assert.ok(script.includes('insert into admin_audit_log') && script.includes('NO_CONTACT_ACTOR'), 'one audit entry per tuition')
  assert.ok(!/delete from/i.test(script), 'nothing is deleted')
  assert.ok(script.includes("await c.query('begin')") && script.includes("await c.query('rollback')"))
  assert.ok(read('supabase', 'migrations', '164_no_contact_pause_source.sql').includes("'no_contact'"))
})

test('B. Resume requires a number — every resume path, and the screens ask for it first', () => {
  assert.equal(resumeContactProblem({ isTeam: true, contactPhone: '0300 1234567' }), null)
  assert.match(resumeContactProblem({ isTeam: true }) ?? '', /Add the parent's mobile number first\. Enter the parent's mobile number, e\.g\. 0300 1234567\./)
  assert.ok(resumeContactProblem({ isTeam: false, parentPhone: '0300 1234567', parentPhoneVerifiedAt: null }))

  // Paused tuitions (one or many): a tuition with no number is left paused.
  const paused = read('lib', 'pausedTuitions.ts')
  assert.ok(paused.includes('const noNumber = await jobsWithoutContactNumber(admin, targets)') && paused.includes('if (noNumber.has(id)) continue'))
  assert.ok(paused.includes(".in('pause_source', [...PAUSED_SOURCES])") && paused.includes("export const PAUSED_SOURCES = ['auto', 'backlog', NO_CONTACT_SOURCE]"))
  assert.ok(paused.includes("if (filters.reason === 'no_contact' && r.source !== NO_CONTACT_SOURCE) return false"), 'the "No contact number" filter')
  assert.ok(read('app', 'api', 'admin', 'jobs', 'paused', 'route.ts').includes('if (resumed.length === 0 && needNumber.length > 0)'))
  // The tuition's own admin page, and a parent's own Reopen.
  assert.ok(read('app', 'api', 'admin', 'jobs', 'action', 'route.ts').includes('const problem = facts ? resumeContactProblem(facts)'))
  const jobs = read('lib', 'jobs.ts')
  assert.ok(jobs.includes('if (!facts || resumeContactProblem(facts)) {'))
  // Saving the number resumes with a fresh 7 days on the same row (so the same address).
  const save = read('lib', 'tuitionContact.ts')
  assert.ok(save.includes("update({ status: 'open', resumed_at: now, bumped_at: now, paused_at: null, self_paused_at: null, pause_source: null })"))
  assert.ok(save.includes("action: 'job.contact_number'") && save.includes("action: 'job.resume'"), 'audited')
  assert.ok(save.includes('const parsed = parseContactNumber(args.phone)'), 'the same validation')
  assert.ok(!save.includes('.delete('))
  // The screens.
  const ui = read('app', 'admin', 'jobs', 'paused', 'PausedClient.tsx')
  assert.ok(ui.includes('No contact number') && ui.includes('<AddParentNumber jobId={r.id} resumeOnSave'))
  assert.ok(ui.includes('<th className="p-2">Reason</th>'))
  const fwd = read('app', 'admin', 'follow-ups', 'ForwardToParents.tsx')
  assert.ok(fwd.includes('Add parent number') && fwd.includes('<AddParentNumber jobId={card.jobId} offerResume />'))
  assert.ok(fwd.includes('{!readOnly && !!card.parent.msisdn && ('), 'WhatsApp / Call only when there is a number')
  assert.ok(read('components', 'admin', 'AddParentNumber.tsx').includes('Resume now'))
})

test('B. posting, editing and resuming go through the role check; signed out is refused', () => {
  assert.equal(isReadOnlyRole('partner'), false) // full management since 13 Oct 2026 (was view-only)
  for (const r of ['owner', 'admin', 'operations', 'tuitions_staff'] as const) assert.equal(roleSatisfies(r, SCREEN_ACCESS.jobsPost), true, r)
  const routes: [string[], string][] = [
    [['create', 'route.ts'], 'checkAdminRole('],
    [['[id]', 'route.ts'], 'checkAdminRole('],
    [['paused', 'route.ts'], 'checkAdminRole(...SCREEN_ACCESS.pausedTuitions)'],
    [['action', 'route.ts'], 'checkAdminRole('],
    [['contact-number', 'route.ts'], 'checkAdminRole(...SCREEN_ACCESS.jobsPost)'],
  ]
  for (const [path, gate] of routes) assert.ok(read('app', 'api', 'admin', 'jobs', ...path).includes(gate), path.join('/'))
  // checkAdminRole refuses a Partner's write (403) and a signed-out one (401).
  const auth = read('lib', 'adminAuth.ts')
  assert.ok(auth.includes('!roleMayWrite(actor.adminRole, allowed)) && !opts.self'))
  assert.ok(auth.includes("status: 401, error: 'Admin access required.'"))
  // And the screens show the Partner no button.
  for (const f of [['app', 'admin', 'jobs', 'paused', 'PausedClient.tsx'], ['app', 'admin', 'follow-ups', 'ForwardToParents.tsx']]) {
    assert.ok(read(...f).includes('useAdminReadOnly()'), f.join('/'))
  }
})
