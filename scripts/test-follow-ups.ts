/**
 * scripts/test-follow-ups.ts — npm run test:followups
 *
 * One-tap follow-up for stuck sign-ups (owner, 9 Oct 2026): the prefilled
 * WhatsApp text, the two tabs, Undo, the 7-day return with "Followed up once",
 * paying/finishing leaving both tabs, counts equal to cards, and Partner
 * refusal. Pure rules + source scans. No browser/DB/network.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

import {
  FOLLOW_UP_HOLD_DAYS,
  STUCK_TEMPLATE_KEY,
  followUpLine,
  followUpState,
  followUpText,
  followUpWaLink,
  splitFollowUpTabs,
  unfilledPlaceholders,
  type FollowUpRecord,
} from '../lib/followUpCore'
import { unpaidRowMatches, type UnpaidFilter } from '../lib/staffOutreachCore'
import { isReadOnlyRole } from '../lib/adminAccessCore'
import { isReadMethod } from '../lib/requestMethod'

const read = (p: string) => readFileSync(p, 'utf8')
const DAY = 86_400_000
const NOW = Date.parse('2026-10-09T12:00:00Z')

const rec = (id: string, member: string, daysAgo: number, extra: Partial<FollowUpRecord> = {}): FollowUpRecord => ({
  id,
  member_id: member,
  channel: 'whatsapp',
  template_key: STUCK_TEMPLATE_KEY,
  created_at: new Date(NOW - daysAgo * DAY).toISOString(),
  staff_name: 'Aqsa Mughal',
  staff_email: 'aqsa@example.com',
  undone_at: null,
  ...extra,
})

// The stored template, as seeded (migration 58) — used as is.
const seeded = read('supabase/migrations/58_part4_auth_trust.sql')
const TEMPLATE = (seeded.match(/'profile_completion_nudge',[^']*'[^']*',[^']*'[^']*',\s*'((?:[^']|'')*)'/)?.[1] ?? '').replace(/''/g, "'")

test('the prefilled text fills every placeholder and carries the continue link', () => {
  assert.ok(TEMPLATE.includes('{name}'), 'the seeded template uses {name}')
  const link = 'https://www.tutormint.org/tutor/onboarding'
  const text = followUpText(TEMPLATE, { name: 'Laiba', step: 'Subjects', link })
  assert.deepEqual(unfilledPlaceholders(text), [])
  assert.ok(text.startsWith('Hi Laiba,'))
  assert.ok(text.endsWith(`\n\n${link}`))
  // The template wording is used as is.
  assert.ok(text.includes(TEMPLATE.replace('{name}', 'Laiba').trim()))
  // A template with its own {link} gets it in place, not appended.
  assert.equal(followUpText('Hi {name}, continue: {link}', { name: 'A', step: null, link }), `Hi A, continue: ${link}`)
  const wa = followUpWaLink('923001234567', text)
  assert.ok(wa.startsWith('https://wa.me/923001234567?text='))
  assert.equal(decodeURIComponent(wa.split('?text=')[1]), text)
})

test('recording a follow-up moves the card to Follow-up sent, with the line', () => {
  const rows = [{ id: 'a' }, { id: 'b' }]
  const before = new Map([['a', followUpState([], NOW)], ['b', followUpState([], NOW)]])
  assert.deepEqual(splitFollowUpTabs(rows, before).stuck.map((r) => r.id), ['a', 'b'])
  const after = new Map([['a', followUpState([rec('f1', 'a', 2)], NOW)], ['b', followUpState([], NOW)]])
  const tabs = splitFollowUpTabs(rows, after)
  assert.deepEqual(tabs.stuck.map((r) => r.id), ['b'])
  assert.deepEqual(tabs.sent.map((r) => r.id), ['a'])
  assert.equal(followUpLine(after.get('a')!, NOW), 'Follow-up sent 2 days ago by Aqsa')
  // The WhatsApp button records as it opens the chat, and the card leaves.
  const ui = read('components/admin/FollowUpActions.tsx')
  assert.match(ui, /onClick=\{\(\) => void record\('whatsapp'\)\}/)
  assert.match(ui, /'Moved to Follow-up sent', \{ label: 'Undo'/)
  assert.match(read('components/admin/OverviewCardGrid.tsx'), /moved\.has\(it\.memberId\) && it\.followUp\?\.tab === 'stuck'/)
})

test('Undo brings the card back (the record is kept, stamped undone)', () => {
  const undone = followUpState([rec('f1', 'a', 0, { undone_at: new Date(NOW).toISOString() })], NOW)
  assert.equal(undone.count, 0)
  assert.equal(undone.sent, false)
  assert.equal(undone.tag, null)
  const lib = read('lib/followUps.ts')
  assert.match(lib, /update\(\{ undone_at: new Date\(\)\.toISOString\(\), undone_by: actor\.id \}\)/)
  assert.doesNotMatch(lib, /\.delete\(\)/)
})

test('still stuck 7 days after the last follow-up → back on Stuck, tagged', () => {
  const once = followUpState([rec('f1', 'a', FOLLOW_UP_HOLD_DAYS + 1)], NOW)
  assert.equal(once.sent, false)
  assert.equal(once.tag, 'Followed up once')
  const twice = followUpState([rec('f1', 'a', 20), rec('f2', 'a', 8)], NOW)
  assert.equal(twice.tag, 'Followed up twice')
  const thrice = followUpState([rec('f1', 'a', 30), rec('f2', 'a', 20), rec('f3', 'a', 9)], NOW)
  assert.equal(thrice.tag, 'Followed up 3 times')
  // Within 7 days of the LAST one it stays in Follow-up sent, whatever came before.
  assert.equal(followUpState([rec('f1', 'a', 20), rec('f2', 'a', 1)], NOW).sent, true)
})

test('paying or finishing onboarding removes the member from both tabs', () => {
  // The tabs split the list loader's own rows; a paid / finished member is not
  // in the loader, so neither tab has them.
  const states = new Map([['paid', followUpState([rec('f', 'paid', 1)], NOW)]])
  const tabs = splitFollowUpTabs([{ id: 'other' }], states)
  assert.equal([...tabs.stuck, ...tabs.sent].some((r) => r.id === 'paid'), false)
  const src = read('lib/staffOutreach.ts')
  assert.match(src, /if \(!t \|\| t\.verified_fee_paid_at\) continue/)
  const ov = read('lib/overviewItems.ts')
  assert.match(ov, /all\.filter\(\(r\) => r\.stoppedAt && r\.stoppedAt !== PAYMENT_STEP_LABEL\)/)
})

test('counts equal the cards', () => {
  const ov = read('lib/overviewItems.ts')
  // The Overview number, the Stuck tab and its count are the same array.
  assert.match(ov, /case 'todo-stuck': \{\s*const t = await stuckTabs\(\)\s*return \{\s*key,\s*rows: t\.stuck,/)
  assert.match(ov, /return \{ stuck: t\.stuck\.length, sent: t\.sent\.length \}/)
  // Unpaid signups: a followed-up row is in "Follow-up sent" and in no other tab.
  const filters: UnpaidFilter[] = ['all', 'payment', 'onboarding', 'uncontacted']
  const row = { stoppedAt: 'Subjects', lastContactAt: null, followUpSent: true }
  assert.equal(unpaidRowMatches(row, 'followed'), true)
  for (const f of filters) assert.equal(unpaidRowMatches(row, f), false, f)
  assert.equal(unpaidRowMatches({ ...row, followUpSent: false }, 'onboarding'), true)
  assert.equal(unpaidRowMatches({ ...row, followUpSent: false }, 'followed'), false)
})

test('a Partner cannot record a follow-up — UI and API', () => {
  assert.equal(isReadOnlyRole('partner'), true)
  assert.equal(isReadMethod('POST'), false)
  const route = read('app/api/admin/follow-ups/route.ts')
  assert.match(route, /export async function POST/)
  assert.match(route, /await checkAdminRole\(/)
  assert.doesNotMatch(route, /export async function GET/)
  const ui = read('components/admin/FollowUpActions.tsx')
  assert.equal((ui.match(/if \(readOnly\) return null/g) ?? []).length, 2)
})
