/**
 * scripts/test-parent-follow-ups.ts — Follow-ups → Parents (owner, 26 Oct 2026):
 * situations, To do / Followed up, no double messages, the templates.
 * Invented data only.
 *   npm run test:parentfollowups
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

import {
  fillParentFollowUp,
  PARENT_DEFAULTS,
  PARENT_TEMPLATES,
  parentChipMatch,
  parentProgressKey,
  parentSituation,
  parentTabState,
  type ParentFacts,
  type ParentTuition,
} from '../lib/parentFollowUpCore'
import { templateSaveCheck } from '../lib/templateRules'
import { templateWarnings } from '../lib/applicationTemplatesCore'

const DAY = 86_400_000
const NOW = Date.parse('2026-10-26T12:00:00Z')
const ago = (d: number) => new Date(NOW - d * DAY).toISOString()

const tuition = (over: Partial<ParentTuition> = {}): ParentTuition => ({
  id: 'j1',
  title: 'Home Tutor Required | Grade 5 | Lahore',
  status: 'open',
  createdAt: ago(5),
  publicPath: '/tuitions/lahore/home-tutor-required-1a2b3c',
  applications: 0,
  waitingForward: 0,
  hiredAt: null,
  hiredTutorName: null,
  ...over,
})
const facts = (over: Partial<ParentFacts> = {}): ParentFacts => ({
  joinedAt: ago(10),
  emailSignup: false,
  emailConfirmed: true,
  tuitions: [],
  hiredThanksAt: null,
  ...over,
})

test('one situation per parent, in order', () => {
  assert.equal(parentSituation(facts({ joinedAt: ago(0.5) }), NOW), null, 'signed up under a day ago: not yet')
  assert.equal(parentSituation(facts(), NOW)?.reason, 'no_tuition')
  assert.equal(parentSituation(facts({ emailSignup: true, emailConfirmed: false }), NOW)?.reason, 'email_unconfirmed')
  assert.equal(parentSituation(facts({ tuitions: [tuition({ createdAt: ago(1) })] }), NOW), null, 'posted a day ago: not yet')
  assert.equal(parentSituation(facts({ tuitions: [tuition()] }), NOW)?.reason, 'no_applicants')
  assert.equal(parentSituation(facts({ tuitions: [tuition({ applications: 2 })] }), NOW), null)
  assert.equal(parentSituation(facts({ tuitions: [tuition({ applications: 2, waitingForward: 1 })] }), NOW)?.reason, 'waiting_forward')
  assert.equal(parentSituation(facts({ tuitions: [tuition({ status: 'paused' })] }), NOW)?.reason, 'expired')
  const hired = facts({ tuitions: [tuition({ status: 'hired', applications: 1, hiredAt: ago(2), hiredTutorName: 'Ali Raza' })] })
  assert.equal(parentSituation(hired, NOW)?.reason, 'hired')
  assert.equal(parentSituation({ ...hired, hiredThanksAt: ago(1) }, NOW), null, 'the thanks is sent once per hire')
})

test('"Tutors applied, not yet forwarded" is Waiting on us, with a link to Applications', () => {
  const f = facts({ tuitions: [tuition({ applications: 1, waitingForward: 1 })] })
  const s = parentSituation(f, NOW)!
  const st = parentTabState(f, s, [], [], NOW, '/admin/applications?staff=all&q=TM-1')
  assert.deepEqual(st.action, { label: 'Tutors to forward', href: '/admin/applications?staff=all&q=TM-1' })
  assert.equal(st.overdue, false, 'never in the badge')
})

test('To do / Followed up: 3 days, 3 messages, progress resets the count but not the wait', () => {
  const f = facts()
  const s = parentSituation(f, NOW)!
  const p = parentProgressKey(f, s)
  assert.equal(parentTabState(f, s, [], [], NOW, '').tab, 'todo')
  assert.equal(parentTabState(f, s, [], [], NOW, '').overdue, true, 'never contacted, joined 10 days ago')
  const one = [{ at: ago(1), progress: p }]
  assert.equal(parentTabState(f, s, one, [], NOW, '').tab, 'sent')
  assert.equal(parentTabState(f, s, [{ at: ago(3), progress: p }], [], NOW, '').tab, 'todo', 'due again 3 days after')
  const three = [{ at: ago(10), progress: p }, { at: ago(7), progress: p }, { at: ago(4), progress: p }]
  assert.equal(parentTabState(f, s, three, [], NOW, '').section, 'no_reply')
  // Progress (a tuition posted) starts the count again, but the 3-day wait holds.
  const f2 = facts({ tuitions: [tuition({ createdAt: ago(3) })] })
  const s2 = parentSituation(f2, NOW)!
  const recent = [...three.slice(0, 2), { at: ago(1), progress: p }]
  const st = parentTabState(f2, s2, recent, [], NOW, '')
  assert.equal(st.tab, 'sent')
  assert.equal(st.unanswered, 0)
})

test('no double message: an Applications message in the last 3 days means not due', () => {
  const f = facts({ tuitions: [tuition()] })
  const s = parentSituation(f, NOW)!
  assert.equal(parentTabState(f, s, [], [ago(1)], NOW, '').tab, 'sent')
  assert.equal(parentTabState(f, s, [], [ago(5)], NOW, '').tab, 'todo')
  // …and it never counts towards the 3 messages.
  assert.equal(parentTabState(f, s, [], [ago(1), ago(1.5), ago(2)], NOW, '').section, 'sent')
})

test('the badge counts overdue To do only', () => {
  const src = readFileSync('lib/parentFollowUps.ts', 'utf8')
  assert.match(src, /fuBadgeCount\(rows\.filter\(\(r\) => !r\.notInterested\)\.map\(\(r\) => r\.state\)\)/)
  assert.match(readFileSync('app/admin/layout.tsx', 'utf8'), /'\/admin\/follow-ups': followUps \+ parentFollowUps/)
})

test('five short templates, seeded, ending with {support_whatsapp}, no prices', () => {
  assert.equal(PARENT_TEMPLATES.length, 5)
  for (const t of PARENT_TEMPLATES) {
    const body = PARENT_DEFAULTS[t.key]
    assert.ok(body.endsWith('{support_whatsapp}'), t.key)
    assert.ok(!/Rs\.?\s?\d|PKR|\d+\s?rupees/i.test(body), `${t.key}: no price`)
    assert.deepEqual(templateWarnings(body), [], `${t.key}: no warning`)
    assert.equal(templateSaveCheck(t.key, body).ok, true)
    assert.ok(body.split(/\s+/).length < 60, `${t.key} is short`)
  }
  assert.match(PARENT_DEFAULTS.pf_expired, /Still looking\? We can repost it/)
  assert.match(PARENT_DEFAULTS.pf_hired, /short review/)
  const sql = readFileSync('supabase/migrations/201_status_merge_parents_viewas.sql', 'utf8')
  for (const t of PARENT_TEMPLATES) assert.ok(sql.includes(`(E'${t.key}'`), `${t.key} seeded`)
  const msg = fillParentFollowUp(PARENT_DEFAULTS.pf_no_applicants, {
    firstName: 'Sana',
    tuitionTitle: 'Grade 5 Maths',
    tuitionLink: 'https://www.tutormint.org/tuitions/lahore/x-1a2b3c',
    postLink: 'https://www.tutormint.org/parent/dashboard/post-job',
    supportWhatsapp: '0300 0000000',
  })
  assert.match(msg, /^Assalam o Alaikum Sana, your tuition "Grade 5 Maths"/)
  assert.ok(msg.endsWith('0300 0000000'))
  assert.doesNotMatch(msg, /\{[a-z_]+\}/)
})

test('the existing chips stay', () => {
  assert.equal(parentChipMatch('posted', { posted: true, verification: 'not_submitted' }), true)
  assert.equal(parentChipMatch('not_posted', { posted: true, verification: 'not_submitted' }), false)
  assert.equal(parentChipMatch('waiting', { posted: false, verification: 'waiting' }), true)
  assert.equal(parentChipMatch('verified', { posted: false, verification: 'waiting' }), false)
  const page = readFileSync('app/admin/follow-ups/page.tsx', 'utf8')
  assert.match(page, /PARENT_CHIP_LABEL/)
  assert.match(page, /FU_TAB_LABEL\[t\]/)
})
