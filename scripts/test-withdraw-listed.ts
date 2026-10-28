/**
 * scripts/test-withdraw-listed.ts — Trust → Withdraw a contact (owner, 28 Oct
 * 2026): a searched number already on the Do not use list shows no action
 * buttons, says when and by whom it was withdrawn, and keeps "Remove from Do not
 * use list". A number not on the list keeps both actions.
 *   npm run test:withdrawlisted
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { withdrawActionsView } from '@/lib/withdrawListedCore'

const CLIENT = readFileSync('app/admin/withdraw-contact/WithdrawContactClient.tsx', 'utf8')
const LIB = readFileSync('lib/contactWithdraw.ts', 'utf8')

test('listed → no action buttons, the banner names the date (Pakistan time) and who', () => {
  // 27 Oct 2026 21:30 UTC is 28 Oct in Pakistan.
  const v = withdrawActionsView({ id: 'x1', addedAt: '2026-10-27T21:30:00Z', addedByName: 'Alee Sabeer' })
  assert.equal(v.showActions, false)
  assert.equal(v.banner, 'Already withdrawn on 28 Oct 2026 by Alee Sabeer')
  assert.equal(!v.showActions && v.removeId, 'x1')
})

test('listed with no name on the row → "by the Owner"', () => {
  const v = withdrawActionsView({ id: 'x2', addedAt: '2026-10-20T08:00:00Z', addedByName: null })
  assert.equal(v.banner, 'Already withdrawn on 20 Oct 2026 by the Owner')
})

test('not listed → both actions shown, no banner', () => {
  for (const entry of [null, undefined]) {
    const v = withdrawActionsView(entry)
    assert.equal(v.showActions, true)
    assert.equal(v.banner, null)
  }
})

test('the page hides both buttons behind the rule and keeps Remove from Do not use list', () => {
  assert.ok(CLIENT.includes('withdrawActionsView(result?.listedEntry)'))
  assert.ok(CLIENT.includes('{!nothing && view.showActions && ('))
  const actions = CLIENT.indexOf('data-withdraw-actions')
  const gate = CLIENT.indexOf('view.showActions && (')
  assert.ok(gate > 0 && gate < actions, 'the action buttons sit inside the showActions gate')
  assert.ok(CLIENT.indexOf('Pause all their tuitions\n') > gate)
  assert.ok(CLIENT.includes('Remove from Do not use list'))
})

test('the search response carries when and by whom — never the number', () => {
  assert.ok(LIB.includes('listedEntry: ListedEntry | null'))
  assert.match(LIB, /\.from\('do_not_use_numbers'\)\s*\.select\('id, added_at, added_by_name'\)/)
})
