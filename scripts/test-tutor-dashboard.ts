/**
 * scripts/test-tutor-dashboard.ts  —  npm run test:tutordash
 *
 * Pure tests for PR106-B: the quota counter and fee-card state (lib/tutorDashboard),
 * the next-plan apply offer (lib/upgradePath), the pay-return view decision
 * (lib/payments/returnView), and the Settings paused-degree preservation
 * (lib/degrees). Nothing here touches the database.
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'

import { quotaCounter, verificationFeeCardState } from '../lib/tutorDashboard'
import { tutorApplyOffer } from '../lib/upgradePath'
import { payReturnView, payWaitingIsManual } from '../lib/payments/returnView'
import { parseCredential, serializeCredential, degreeLabels, activeCredentials } from '../lib/degrees'

// ------------------------------------------------- quota counter (§4–§5) ---

test('quota counter: Basic and Premium show the real number; Featured shows Unlimited only', () => {
  const basic = quotaCounter({ plan: 'basic', used: 7, quota: 10 })
  assert.equal(basic.text, '7 of 10 used this month')
  assert.equal(basic.unlimited, false)

  const premium = quotaCounter({ plan: 'premium', used: 42, quota: 100 })
  assert.equal(premium.text, '42 of 100 used this month')
  assert.equal(premium.unlimited, false)

  const featured = quotaCounter({ plan: 'featured', used: 130, quota: 150 })
  assert.equal(featured.text, 'Unlimited', 'Featured never shows the real number')
  assert.equal(featured.unlimited, true)
  assert.equal(featured.showGetMore, false, 'Featured never shows a Get-more link')
})

test('quota counter: the Get-more link appears at ~80%+ for Basic/Premium only', () => {
  assert.equal(quotaCounter({ plan: 'basic', used: 7, quota: 10 }).showGetMore, false) // 70% — below the threshold
  assert.equal(quotaCounter({ plan: 'basic', used: 8, quota: 10 }).showGetMore, true) // 80%
  assert.equal(quotaCounter({ plan: 'basic', used: 10, quota: 10 }).showGetMore, true) // at the limit
  assert.equal(quotaCounter({ plan: 'premium', used: 80, quota: 100 }).showGetMore, true)
  assert.equal(quotaCounter({ plan: 'featured', used: 150, quota: 150 }).showGetMore, false)
})

// --------------------------------------------- fee card states (§2) --------

test('fee card: unpaid shows all lines not-yet-active and the Pay button', () => {
  const s = verificationFeeCardState({ feePaid: false, verifiedOk: false, findable: false })
  assert.equal(s.paid, false)
  assert.deepEqual(s.lines.map((l) => l.done), [false, false, false])
})

test('fee card: fee paid but approvals pending — only the Basic line is active', () => {
  const s = verificationFeeCardState({ feePaid: true, verifiedOk: false, findable: false })
  assert.equal(s.paid, true)
  assert.deepEqual(
    s.lines.map((l) => [l.key, l.done]),
    [['badge', false], ['google', false], ['basic', true]],
  )
})

test('fee card: fully approved and findable — all three lines active', () => {
  const s = verificationFeeCardState({ feePaid: true, verifiedOk: true, findable: true })
  assert.deepEqual(s.lines.map((l) => l.done), [true, true, true])
})

// ------------------------------------------ next-plan apply offer (§6) -----

test('apply offer at the limit: Basic→Premium, Premium→Featured, Featured→none', () => {
  assert.equal(tutorApplyOffer('basic', false), 'premium')
  assert.equal(tutorApplyOffer('premium', false), 'featured')
  assert.equal(tutorApplyOffer('featured', false), null, 'Featured gets no offer — only the reset date')
})

// ------------------------------------------ pay return view (§9) -----------

test('pay return view: success / failure / cancel-or-pending / bank transfer', () => {
  assert.equal(payReturnView('approved'), 'approved', 'success → active')
  assert.equal(payReturnView('rejected'), 'notpaid', 'failure → try again')
  assert.equal(payReturnView('pending'), 'waiting', 'cancel/abandon leaves the order pending → waiting')
  assert.equal(payReturnView(null), 'unknown')
  // Bank transfer is a pending order whose waiting copy differs.
  assert.equal(payReturnView('pending'), 'waiting')
  assert.equal(payWaitingIsManual('manual'), true)
  assert.equal(payWaitingIsManual('paypro'), false)
})

// ------------------------------- Settings keeps paused degrees (§11) -------

test('Settings save keeps paused degrees paused and never resurrects them', () => {
  // What the onboarding editor stored: one active, one paused (removed) degree.
  const stored = [
    serializeCredential({ title: 'BSc Physics', docId: 'd1' }),
    serializeCredential({ title: 'Old diploma', docId: 'd2', paused: true }),
  ]
  // Settings loads only the ACTIVE ones into the editor, keeps the paused aside.
  const editable = stored.filter((d) => !parseCredential(d).paused)
  const paused = stored.filter((d) => parseCredential(d).paused)
  assert.equal(editable.length, 1)
  assert.equal(parseCredential(editable[0]).title, 'BSc Physics')

  // A Settings save writes the (unchanged) active entry + the preserved paused one.
  const active = editable.map((d) => {
    const c = parseCredential(d)
    return serializeCredential({ title: c.title, docId: c.docId })
  })
  const saved = [
    ...active,
    ...paused.map((d) => {
      const c = parseCredential(d)
      return serializeCredential({ title: c.title, docId: c.docId, paused: true })
    }),
  ]
  // The paused degree is still there, still paused, still hidden from readers.
  assert.equal(saved.length, 2)
  assert.equal(parseCredential(saved[1]).paused, true)
  assert.deepEqual(degreeLabels(saved), ['BSc Physics'], 'readers still show only the active degree')
  assert.deepEqual(activeCredentials(saved).map((c) => c.title), ['BSc Physics'])
  assert.equal(parseCredential(saved[0]).docId, 'd1', 'the active degree keeps its certificate link')
})
