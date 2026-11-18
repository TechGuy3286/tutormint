/**
 * scripts/test-forward-teaser.ts — PR-07 (owner, 18 Nov 2026): "Your
 * application for <title, area> was sent to the parent". INVENTED data only.
 *   - fires once per application (the first-insert rule), on real forwards only;
 *   - never for View as, a test/seed/hidden poster, a withdrawn application or
 *     a tutor who may not get teasers (unpaid, test, staff, paused…);
 *   - joins that day's WhatsApp updates item, under the same caps and opt-out.
 *
 *   npm run test:forwardteaser
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

import {
  APPLICATION_FORWARDED_KIND,
  applicationForwardedText,
  forwardAlertGoes,
  pendingWaItems,
  teaserBlock,
  TEASER_KINDS,
  waMessage,
  waRowState,
  WA_WEEKLY_CAP,
  type WaItem,
  type WaSend,
} from '../lib/tutorTeasersCore'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const read = (p: string) => readFileSync(join(ROOT, p), 'utf8')
const DAY = 86_400_000
// Wednesday 18 Nov 2026, 10:00 PKT.
const NOW = Date.parse('2026-11-18T05:00:00Z')
const iso = (ms: number) => new Date(ms).toISOString()

const fwd = (id: string, at = NOW - 3_600_000): WaItem => ({ kind: 'application_forwarded', applicationId: id, at: iso(at), jobTitle: 'Invented Maths Tutor', area: 'Gulberg', city: 'Lahore' })
const opened = (id: string, at = NOW - 3_600_000): WaItem => ({ kind: 'application_opened', applicationId: id, at: iso(at), jobTitle: 'Invented Maths Tutor', area: 'Gulberg', city: 'Lahore' })
const send = (over: Partial<WaSend> = {}): WaSend => ({ id: 's1', createdAt: iso(NOW - DAY), undoneAt: null, kinds: [], applicationIds: [], forwardedIds: [], staffId: 'staff-a', staffName: 'Staff A', ...over })

test('the alert text names the tuition and its area — no parent detail', () => {
  const t = applicationForwardedText({ title: 'Invented Maths Tutor', area: 'Gulberg', city: 'Lahore' })
  assert.equal(t.title, 'Your application for Invented Maths Tutor, Gulberg was sent to the parent')
  assert.equal(t.href, '/tutor/dashboard/applications')
  assert.equal(applicationForwardedText({ title: null, area: '12 Street 4', city: 'Lahore' }).title, 'Your application for a tuition, Lahore was sent to the parent', 'an address-looking area is not shown')
  assert.ok(!(TEASER_KINDS as readonly string[]).includes(APPLICATION_FORWARDED_KIND), 'instant: never counted in the weekly teaser cap')
})

test('real events only: never View as, test poster, withdrawn or an ineligible tutor', () => {
  const base = { viewAs: false, withdrawn: false, tutorEligible: true, posterTest: false }
  assert.equal(forwardAlertGoes(base), true)
  assert.equal(forwardAlertGoes({ ...base, viewAs: true }), false)
  assert.equal(forwardAlertGoes({ ...base, posterTest: true }), false)
  assert.equal(forwardAlertGoes({ ...base, withdrawn: true }), false)
  assert.equal(forwardAlertGoes({ ...base, tutorEligible: false }), false)
  // Test accounts are not eligible tutors (the PR-06 rule).
  const paid = iso(NOW - 10 * DAY)
  assert.equal(teaserBlock({ role: 'tutor', feePaidAt: paid, isTestName: true }, NOW), 'test')
  assert.equal(teaserBlock({ role: 'tutor', feePaidAt: paid, isSeed: true }, NOW), 'test')
  assert.equal(teaserBlock({ role: 'tutor', feePaidAt: null }, NOW), 'not_paid')
  assert.equal(teaserBlock({ role: 'tutor', feePaidAt: paid }, NOW), null)
})

test('once per application: the first insert decides; the forward paths call it after the stage moved', () => {
  const lib = read('lib/tutorTeasers.ts')
  const fn = lib.slice(lib.indexOf('export async function alertApplicationsForwarded'))
  assert.match(fn, /from\('application_forward_alerts'\)[^]*onConflict: 'application_id', ignoreDuplicates: true/)
  assert.match(fn, /fresh\.has\(a\.id as string\)/, 'only applications inserted now are alerted')
  assert.match(fn, /getViewAsContext\(\)/, 'View as is checked')
  assert.ok(fn.indexOf('getViewAsContext') < fn.indexOf("from('application_forward_alerts')"), 'View as returns before anything is written')
  // Forward to parents and the Applied message, only for applications that moved to Forwarded.
  const tracking = read('lib/applicationTracking.ts')
  assert.match(tracking, /moved\.push\(a\.id\)[^]*await alertApplicationsForwarded\(moved\)/)
  const followUps = read('lib/applicationFollowUps.ts')
  assert.match(followUps, /if \(!moved\) throw new Error\('stage did not move'\)\s*\n\s*\/\/[^\n]*\n\s*await alertApplicationsForwarded\(\[app\.id\]\)/)
  assert.match(followUps, /await undoForwardAlert\(fu\.application_id as string\)/, 'the Applied message Undo takes it out of the WhatsApp queue')
  // The table enforces it.
  assert.match(read('supabase/migrations/236_cnic_address_and_forward_alerts.sql'), /application_id uuid primary key references public\.applications/)
})

test('WhatsApp queue: a forward joins the day’s item once; an open of the same application is still news', () => {
  const items = [fwd('app-1'), opened('app-1')]
  assert.equal(pendingWaItems(items, [], NOW).length, 2)
  const afterForwardSent = [send({ createdAt: iso(NOW - 2 * 3_600_000), kinds: ['application_forwarded'], forwardedIds: ['app-1'] })]
  assert.deepEqual(pendingWaItems(items, afterForwardSent, NOW).map((i) => i.kind), ['application_opened'])
  // An undone send gives it back.
  assert.equal(pendingWaItems([fwd('app-1')], [send({ forwardedIds: ['app-1'], undoneAt: iso(NOW - 60_000) })], NOW).length, 1)
  // Older than yesterday (Pakistan): not sent.
  assert.equal(pendingWaItems([fwd('app-2', NOW - 3 * DAY)], [], NOW).length, 0)
})

test('the same caps and opt-out as PR-06', () => {
  const pending = [fwd('app-1')]
  const p = { eligible: true, optedIn: true, hasNumber: true, pending, sends: [] as WaSend[] }
  assert.equal(waRowState(p, NOW), 'to_send')
  assert.equal(waRowState({ ...p, optedIn: false }, NOW), 'hidden', 'opted out')
  assert.equal(waRowState({ ...p, eligible: false }, NOW), 'hidden', 'test / unpaid / paused')
  assert.equal(waRowState({ ...p, hasNumber: false }, NOW), 'hidden')
  const twoThisWeek = Array.from({ length: WA_WEEKLY_CAP }, (_, i) => send({ id: `s${i}`, createdAt: iso(NOW - (i + 1) * 3_600_000 - DAY) }))
  assert.equal(waRowState({ ...p, sends: twoThisWeek }, NOW), 'hidden', 'two this week already')
  assert.equal(waRowState({ ...p, sends: [send({ createdAt: iso(NOW - 60_000) })] }, NOW), 'sent_today')
})

test('the WhatsApp message keeps the wording rules with every item present', () => {
  const msg = waMessage({
    firstName: 'Invented',
    items: [fwd('a'), opened('b'), { kind: 'weekly_summary', numbers: { views: 3, applications: 2, tuitions: 5 } }],
    link: 'https://www.tutormint.org/tutor/dashboard/applications',
    supportWhatsapp: '0300 0000000',
  })
  const lines = msg.split('\n')
  const linkAt = lines.indexOf('https://www.tutormint.org/tutor/dashboard/applications')
  assert.ok(linkAt > 0 && linkAt <= 3, 'at most three lines before the link')
  assert.equal(linkAt, lines.length - 2, 'the link is the last-but-one line')
  assert.match(lines[0], /^Assalam o Alaikum Invented, your application for Invented Maths Tutor, Gulberg was sent to the parent\./)
  assert.match(msg, /A parent opened your application/)
  assert.doesNotMatch(msg, /Rs|PKR|\d{3,}\s*rupees|best|largest|No\.?\s*1/i)
  // Only a forward.
  const one = waMessage({ firstName: 'Invented', items: [fwd('a')], link: 'L', supportWhatsapp: 'S' })
  assert.equal(one.split('\n')[0], 'Assalam o Alaikum Invented, your application for Invented Maths Tutor, Gulberg was sent to the parent.')
  assert.equal(waMessage({ firstName: 'X', items: [fwd('a'), fwd('b')], link: 'L', supportWhatsapp: 'S' }).split('\n')[0], 'Assalam o Alaikum X, 2 of your applications were sent to the parents.')
})

test('the queue reads only alerted, not undone forwards and records them apart on Send', () => {
  const wa = read('lib/waUpdates.ts')
  assert.match(wa, /from\('application_forward_alerts'\)[^]*\.eq\('notified', true\)[^]*\.is\('undone_at', null\)/)
  assert.match(wa, /forwarded_application_ids: row\.items\.flatMap/)
})
