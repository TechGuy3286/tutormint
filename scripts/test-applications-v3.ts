/**
 * scripts/test-applications-v3.ts — npm run test:applicationsv3
 * Owner, 22 Oct 2026 — Applications v3:
 *   - the recipient and message for every stage; the disabled button with no number
 *   - the follow-up record and Undo
 *   - the due rules (1 day, 3 days, once for closed stages, reset on stage change)
 *   - To do → Sent → To do on the due date
 *   - the badge counts overdue To do only; Older is never overdue
 *   - search across tabs; old Forward tab links redirect
 *   - the forward panel moves the ticked tutors to Forwarded and Sent
 *   - the By-tutor message lists all active applications and never satisfies a parent follow-up
 *   - no price or superlative in any message; no phone or email in logs or timelines
 * Pure rules + source scans. No browser, no network.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

import {
  ACTIVE_STAGES,
  buttonLabel,
  clean,
  FORBIDDEN_WORDS,
  STAGE_MESSAGE,
  STAGE_RECIPIENT,
  stageMessage,
  SUPPORT_LINE,
  tutorUpdateMessage,
} from '../lib/applicationMessagesCore'
import {
  dueState,
  groupRows,
  lastFollowUp,
  sectionOf,
  sentLine,
  tabCounts,
  todoBadgeCount,
  type FollowUpRecord,
} from '../lib/applicationFollowUpCore'
import { legacyApplicationsHref, searchMatches, STAGES, TUTOR_STAGE_TEXT, type BoardItem, type Stage } from '../lib/applicationStageCore'
import { finishWaText } from '../lib/waLinkCore'

const code = (p: string) => readFileSync(p, 'utf8')
const DAY = 24 * 60 * 60 * 1000
const HOUR = 60 * 60 * 1000
const NOW = Date.parse('2026-10-22T12:00:00Z')
const ago = (ms: number) => new Date(NOW - ms).toISOString()

const OWNER = { id: 'owner', adminRole: 'owner' }
const AQSA = { id: 'aqsa', adminRole: 'admin' }

function item(p: Partial<BoardItem> = {}): BoardItem {
  return { id: 'a1', stage: 'applied', stageChangedAt: ago(2 * HOUR), ownerId: 'aqsa', createdAt: ago(2 * HOUR), workedAt: null, jobCreatedAt: ago(5 * DAY), ...p }
}
function fu(p: Partial<FollowUpRecord> = {}): FollowUpRecord {
  return { id: 'f1', applicationId: 'a1', stage: 'applied', kind: 'follow_up', recipient: 'parent', messageKey: 'share_profile', staffName: 'Aqsa', at: ago(1 * HOUR), ...p }
}
const msgInput = (stage: Stage) => ({
  stage,
  ref: 'TM-1303',
  title: 'Online Tutor Required | Grade 5',
  parentName: 'Sara Khan',
  tutorName: 'Rida Saeed',
  tutorProfilePath: '/tutor/rida-saeed-tutor',
  tutorCity: 'Lahore',
})

// ------------------------------------------------------------ messages ----

test('every stage has its recipient and message', () => {
  assert.deepEqual(
    STAGES.map((s) => STAGE_RECIPIENT[s]),
    ['parent', 'parent', 'parent', 'parent', 'tutor', 'tutor', 'tutor'],
  )
  const m = Object.fromEntries(STAGES.map((s) => [s, stageMessage(msgInput(s))]))
  assert.match(m.applied, /Assalam o Alaikum Sara/)
  assert.match(m.applied, /\nhttps:\/\/www\.tutormint\.org\/tutor\/rida-saeed-tutor\n/)
  assert.match(m.forwarded, /Did you get a chance to contact them\?/)
  assert.match(m.contacted, /arrange a demo lesson or an interview/)
  assert.match(m.demo, /How did the demo or interview with Rida Saeed go\? Would you like to go ahead/)
  assert.match(m.hired, /congratulations/i)
  assert.match(m.hired, /success story/)
  assert.match(m.not_selected, /https:\/\/www\.tutormint\.org\/browse\/tuitions\?city=Lahore/)
  assert.match(m.no_response, /open ones in your city/)
  for (const s of STAGES) {
    const text = m[s]
    assert.ok(text.includes('TM-1303') && text.includes('Online Tutor Required'), `${s}: TM number and title`)
    assert.ok(text.trim().endsWith(SUPPORT_LINE), `${s}: ends with the support line`)
    assert.match(SUPPORT_LINE, /0321 5872222/)
    // finishWaText (the wa.me builder) keeps it as written.
    assert.equal(finishWaText(text), text.trim(), `${s}: link already on its own line`)
  }
  assert.equal(STAGE_MESSAGE.applied, 'share_profile')
  assert.equal(STAGE_MESSAGE.hired, 'hired_story')
})

test('the button says who it goes to, and is disabled with no number', () => {
  assert.equal(buttonLabel('parent', true), 'WhatsApp parent')
  assert.equal(buttonLabel('tutor', true), 'WhatsApp tutor')
  assert.equal(buttonLabel('parent', false), 'No parent number')
  assert.equal(buttonLabel('tutor', false), 'No tutor number')
  const ui = code('app/admin/applications/ApplicationsClient.tsx')
  assert.ok(ui.includes("const hasNumber = recipient === 'parent' ? r.hasParentNumber : !!r.tutorPhone"))
  assert.ok(ui.includes('disabled={!hasNumber'))
  // The server refuses too.
  const lib = code('lib/applicationFollowUps.ts')
  assert.ok(lib.includes("'No parent number on this tuition.'") && lib.includes("'No tutor number on file.'"))
})

test('no message carries a price, a fee or a superlative', () => {
  const texts = [
    ...STAGES.map((s) => stageMessage(msgInput(s))),
    tutorUpdateMessage('Rida Saeed', ACTIVE_STAGES.map((s, i) => ({ ref: `TM-${100 + i}`, title: 'Home Tutor Required', stage: s }))),
  ]
  for (const t of texts) assert.doesNotMatch(t, FORBIDDEN_WORDS, t)
  assert.doesNotMatch(code('lib/applicationMessagesCore.ts').split('/** For the tests')[0], /Rs\.?\s?\d|PKR|\b\d{3,}\s*rupees/i)
})

test('names and titles typed by people cannot carry a number or an email into a message', () => {
  assert.equal(clean('Rida 0321-5872222 Saeed'), 'Rida Saeed')
  assert.equal(clean('Ali ali@example.com'), 'Ali')
  const m = stageMessage({ ...msgInput('forwarded'), tutorName: 'Rida 03001234567', title: 'Call 0300 1234567 now' })
  assert.doesNotMatch(m.replace(SUPPORT_LINE, ''), /\d{7,}|\d{4} \d{7}/)
})

// ----------------------------------------------------- record and undo ----

test('a tap records the follow-up (stage, recipient type, message, staff, time) and offers a 10-second Undo', () => {
  const lib = code('lib/applicationFollowUps.ts')
  assert.match(lib, /from\('application_follow_ups'\)\s*\.insert\(/)
  for (const col of ['application_id', 'stage', 'kind', 'recipient', 'message_key', 'staff_id', 'staff_name']) assert.ok(lib.includes(`${col}:`), col)
  // Undo stamps undone_at on the staff member's own rows; nothing is deleted.
  assert.match(lib, /update\(\{ undone_at: new Date\(\)\.toISOString\(\), undone_by: actor\.id \}\)/)
  assert.match(lib, /\.eq\('staff_id', actor\.id\)/)
  assert.doesNotMatch(lib, /\.delete\(/)
  // Every reader ignores an undone row.
  assert.match(lib, /\.is\('undone_at', null\)/)
  const ui = code('app/admin/applications/ApplicationsClient.tsx')
  assert.ok(ui.includes('const UNDO_MS = 10_000'))
  assert.ok(ui.includes("{ label: 'Undo', onClick: () => void undo(ids), ms: UNDO_MS }"))
  assert.match(code('components/ui/Toast.tsx'), /action\.ms \?\? DURATION\[kind\] \* 2/)
  const sql = code('supabase/migrations/194_application_follow_ups.sql')
  assert.match(sql, /create policy application_follow_ups_admin_read on public\.application_follow_ups\s*for select using \(public\.is_admin\(\)\)/)
})

test('logs, audit rows and timelines carry the recipient type only — never a phone or an email', () => {
  const lib = code('lib/applicationFollowUps.ts')
  // Nothing is written to the console at all.
  assert.doesNotMatch(lib, /console\./)
  // Audit detail and timeline meta: ids, stage, recipient, kind, message key.
  // (actorEmail on an audit row is the acting STAFF member's own, as on every audit row.)
  const payloads = [...lib.matchAll(/(?:detail|meta): \{[^}]*\}/g)].map((m) => m[0])
  assert.ok(payloads.length >= 4)
  for (const body of payloads) assert.doesNotMatch(body, /raw|msisdn|phone|whatsapp|email|href/i, body)
  // The table has no number column.
  const sql = code('supabase/migrations/194_application_follow_ups.sql')
  const table = sql.slice(sql.indexOf('create table'), sql.indexOf(');', sql.indexOf('create table')))
  assert.doesNotMatch(table, /phone|msisdn|whatsapp|email/i)
  // The timeline sentence names the recipient type.
  assert.match(code('lib/timelineText.ts'), /Staff sent a WhatsApp message to the parent about an application/)
})

// ------------------------------------------------------------ due rules ----

test('Applied: due now; Forward overdue after 1 day; after a follow-up, due again 1 day later', () => {
  let d = dueState(item(), [], NOW)
  assert.equal(d.tab, 'todo')
  assert.equal(d.overdue, null)
  d = dueState(item({ stageChangedAt: ago(25 * HOUR) }), [], NOW)
  assert.equal(d.overdue, 'forward_overdue')
  d = dueState(item({ stageChangedAt: ago(25 * HOUR) }), [fu({ at: ago(1 * HOUR) })], NOW)
  assert.equal(d.tab, 'sent')
  assert.equal(d.dueAt, new Date(NOW - HOUR + DAY).toISOString())
  d = dueState(item({ stageChangedAt: ago(3 * DAY) }), [fu({ at: ago(25 * HOUR) })], NOW)
  assert.equal(d.tab, 'todo')
  assert.equal(d.overdue, 'forward_overdue')
})

test('Forwarded / Contacted / Demo: due 3 days after the last follow-up or stage change', () => {
  for (const stage of ['forwarded', 'contacted', 'demo'] as Stage[]) {
    let d = dueState(item({ stage, stageChangedAt: ago(2 * DAY) }), [], NOW)
    assert.equal(d.tab, 'sent', stage)
    assert.equal(d.dueAt, new Date(NOW + DAY).toISOString())
    d = dueState(item({ stage, stageChangedAt: ago(4 * DAY) }), [], NOW)
    assert.equal(d.tab, 'todo')
    assert.equal(d.overdue, 'check_in')
    d = dueState(item({ stage, stageChangedAt: ago(10 * DAY) }), [fu({ stage, at: ago(1 * DAY) })], NOW)
    assert.equal(d.tab, 'sent')
    assert.equal(d.dueAt, new Date(NOW + 2 * DAY).toISOString())
  }
})

test('Hired / Not selected / No response: due once, then Sent for good ("Done")', () => {
  for (const stage of ['hired', 'not_selected', 'no_response'] as Stage[]) {
    let d = dueState(item({ stage, stageChangedAt: ago(1 * HOUR) }), [], NOW)
    assert.equal(d.tab, 'todo')
    assert.equal(d.overdue, null)
    d = dueState(item({ stage, stageChangedAt: ago(1 * HOUR) }), [fu({ stage, recipient: 'tutor', at: ago(10 * 60_000) })], NOW + 400 * DAY)
    assert.equal(d.tab, 'sent')
    assert.equal(d.done, true)
    assert.equal(d.dueAt, null)
  }
  assert.equal(sentLine({ messageLabel: 'Congratulations', recipientLabel: 'Tutor', staffName: 'Aqsa', ago: '2 days ago', nextDue: null }), 'Congratulations sent to Tutor by Aqsa, 2 days ago · Done')
  assert.equal(
    sentLine({ messageLabel: 'Contact check', recipientLabel: 'Parent', staffName: 'Aqsa', ago: '1 hour ago', nextDue: '25 Oct 2026' }),
    'Contact check sent to Parent by Aqsa, 1 hour ago · next due 25 Oct 2026',
  )
})

test('a stage change resets the timer: a follow-up made at the old stage does not count', () => {
  const recs = [fu({ stage: 'applied', at: ago(2 * HOUR) })]
  const moved = item({ stage: 'forwarded', stageChangedAt: ago(1 * HOUR) })
  assert.equal(lastFollowUp(moved, recs), null)
  // A follow-up at the new stage made BEFORE the change does not count either.
  assert.equal(lastFollowUp(moved, [fu({ stage: 'forwarded', at: ago(2 * HOUR) })]), null)
  const d = dueState(moved, recs, NOW)
  assert.equal(d.dueAt, new Date(NOW - HOUR + 3 * DAY).toISOString())
})

test('To do → Sent → To do on the due date', () => {
  const it = item({ stage: 'contacted', stageChangedAt: ago(5 * DAY) })
  assert.equal(dueState(it, [], NOW).tab, 'todo')
  const recs = [fu({ stage: 'contacted', at: new Date(NOW).toISOString() })]
  assert.equal(dueState(it, recs, NOW + HOUR).tab, 'sent')
  assert.equal(dueState(it, recs, NOW + 3 * DAY - 1).tab, 'sent')
  assert.equal(dueState(it, recs, NOW + 3 * DAY).tab, 'todo')
})

test('the badge counts overdue To do items only — own, or all for the Owner; Older never counts', () => {
  const rows = [
    { ...item({ id: 'x', stageChangedAt: ago(2 * DAY) }) },
    { ...item({ id: 'y', ownerId: 'khizra', stageChangedAt: ago(2 * DAY) }) },
    { ...item({ id: 'due-not-overdue', stageChangedAt: ago(1 * HOUR) }) },
    { ...item({ id: 'sent', stage: 'forwarded', stageChangedAt: ago(1 * DAY) }) },
    { ...item({ id: 'older', stageChangedAt: ago(40 * DAY), jobCreatedAt: ago(40 * DAY) }) },
  ].map((r) => ({ ...r, due: dueState(r, [], NOW) }))
  assert.equal(todoBadgeCount(rows, AQSA), 1)
  assert.equal(todoBadgeCount(rows, OWNER), 2)
  const old = rows.find((r) => r.id === 'older')!
  assert.equal(old.due.overdue, null)
  assert.equal(sectionOf(old.due), 'older')
  assert.deepEqual(tabCounts(rows), { todo: 3, sent: 1, older: 1 })
  // The layout badge uses it.
  assert.match(code('lib/applicationTracking.ts'), /return todoBadgeCount\(/)
})

test('grouping: To do overdue first (oldest due first); Sent soonest due first, Done last', () => {
  const rows = [
    item({ id: 'fresh', stageChangedAt: ago(1 * HOUR) }),
    item({ id: 'late', stageChangedAt: ago(3 * DAY) }),
    item({ id: 'later', stageChangedAt: ago(2 * DAY) }),
  ].map((r, i) => ({ ...r, jobId: `j${i}`, due: dueState(r, [], NOW) }))
  assert.deepEqual(groupRows(rows, (r) => r.jobId, 'todo').map((g) => g.key), ['j1', 'j2', 'j0'])
  const sent = [
    { ...item({ id: 'done', stage: 'hired' }), jobId: 'jd' },
    { ...item({ id: 'soon', stage: 'forwarded', stageChangedAt: ago(2 * DAY) }), jobId: 'js' },
    { ...item({ id: 'later', stage: 'forwarded', stageChangedAt: ago(1 * HOUR) }), jobId: 'jl' },
  ].map((r) => ({ ...r, due: dueState(r, r.id === 'done' ? [fu({ applicationId: 'done', stage: 'hired', recipient: 'tutor' })] : [], NOW) }))
  assert.deepEqual(groupRows(sent, (r) => r.jobId, 'sent').map((g) => g.key), ['js', 'jl', 'jd'])
})

// ------------------------------------------------------ search and links ----

test('search covers both tabs and Older, and each result says which tab it is in', () => {
  assert.ok(searchMatches({ tutorName: 'Rida Saeed', jobRef: 'TM-1303', jobTitle: 'Online Tutor', jobCity: 'Karachi' }, '1303'))
  const ui = code('app/admin/applications/ApplicationsClient.tsx')
  assert.ok(ui.includes('const listed = searching ? all.filter((r) => hits.has(r.id))'))
  assert.ok(ui.includes('{searching && <span className={`rounded-full px-1.5 py-0.5 text-[10px] font-black ${SECTION_CHIP[r.section]}`}>{SECTION_LABEL[r.section]}</span>}'))
})

test('old Forward to parents links land on the Applications page', () => {
  assert.equal(legacyApplicationsHref({ view: 'forward' }), '/admin/applications')
  assert.equal(legacyApplicationsHref({ view: 'forward', fwd: 'outcome', staff: 'all' }), '/admin/applications?staff=all')
  assert.equal(legacyApplicationsHref({ tab: 'applications', view: 'forward' }), '/admin/applications')
  const page = code('app/admin/applications/page.tsx')
  assert.ok(page.includes("if (sp.view === 'forward' || sp.fwd) permanentRedirect(legacyApplicationsHref(sp))"))
  assert.doesNotMatch(page, /Forward to parents <span/)
  assert.match(code('app/admin/jobs/applicants/page.tsx'), /permanentRedirect\(legacyApplicationsHref\(/)
})

// ------------------------------------------------------- forward panel ----

test('the forward panel keeps every old feature and moves the ticked tutors to Forwarded and Sent', () => {
  const ui = code('app/admin/applications/ForwardToParents.tsx')
  for (const feature of [
    'WhatsApp parent',
    'Call parent',
    'Mark as forwarded',
    'Save outcome',
    'What did the parent say?',
    'Add parent number',
    'already sent',
    'Public profile',
    'Admin page',
    'New applicant',
    'Check with parent',
    '<Avatar name={tutor.name} src={tutor.avatarUrl} gender={tutor.gender}',
    '<BadgeRow badges={tutor.badges}',
    'type="checkbox"',
  ]) {
    assert.ok(ui.includes(feature), feature)
  }
  // Opened from each tuition group.
  assert.ok(code('app/admin/applications/ApplicationsClient.tsx').includes('onClick={() => setPanel({ jobId, title })}'))
  // Hidden photo → grey silhouette.
  assert.match(code('lib/applicantForwards.ts'), /tp\?\.show_avatar === false \? null/)
  // Mark as forwarded: Applied → Forwarded, then a parent follow-up on each.
  const fwd = code('lib/applicantForwards.ts')
  const i = fwd.indexOf('await advanceForwarded(args.actor, args.jobId, tutorIds)')
  const j = fwd.indexOf('await recordForwardFollowUps(args.actor, args.jobId, tutorIds)')
  assert.ok(i > 0 && j > i)
  assert.match(code('lib/applicationFollowUps.ts'), /'follow_up', 'parent', \(\) => 'forward'\)/)
  // So, by the rules, a just-forwarded application is in Sent.
  const forwarded = item({ stage: 'forwarded', stageChangedAt: ago(1000) })
  assert.equal(dueState(forwarded, [fu({ stage: 'forwarded', messageKey: 'forward', at: ago(500) })], NOW).tab, 'sent')
})

// --------------------------------------------------------- By tutor ----

test('By tutor: one message listing every active application, and it is not a parent follow-up', () => {
  const items = [
    { ref: 'TM-1', title: 'Home Tutor Required', stage: 'applied' as Stage },
    { ref: 'TM-2', title: 'Online Tutor Required', stage: 'demo' as Stage },
  ]
  const m = tutorUpdateMessage('Rida Saeed', items)
  assert.ok(m.includes(`• TM-1 — Home Tutor Required: ${TUTOR_STAGE_TEXT.applied}`))
  assert.ok(m.includes(`• TM-2 — Online Tutor Required: ${TUTOR_STAGE_TEXT.demo}`))
  assert.ok(m.includes('https://www.tutormint.org/tutor/dashboard'))
  assert.ok(m.trim().endsWith(SUPPORT_LINE))
  assert.deepEqual([...ACTIVE_STAGES], ['applied', 'forwarded', 'contacted', 'demo'])
  // A tutor update never satisfies the due rule.
  const it = item({ stage: 'contacted', stageChangedAt: ago(5 * DAY) })
  const d = dueState(it, [fu({ stage: 'contacted', kind: 'tutor_update', recipient: 'tutor', messageKey: 'tutor_update', at: ago(HOUR) })], NOW)
  assert.equal(d.tab, 'todo')
  assert.equal(d.overdue, 'check_in')
  // The server lists ACTIVE applications only and records 'tutor_update'.
  const lib = code('lib/applicationFollowUps.ts')
  assert.ok(lib.includes('ACTIVE_STAGES.includes(a.stage as Stage)'))
  assert.ok(lib.includes("'tutor_update',\n      'tutor',"))
  // Both views and tabs share the Staff filter and search.
  const ui = code('app/admin/applications/ApplicationsClient.tsx')
  assert.ok(ui.includes("const keyOf = (r: Row) => (view === 'tutor' ? r.tutorId : r.jobId)"))
  assert.ok(ui.includes('Tutor updated {ago(updated.at, nowMs)}'))
})
