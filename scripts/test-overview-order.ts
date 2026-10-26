/**
 * scripts/test-overview-order.ts — the admin Overview's fixed section order
 * (owner, 26 Oct 2026). Fails if the constant changes, if the page stops
 * drawing through it, or if a role that sees fewer sections gets them out of
 * order.
 *   npm run test:overvieworder
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

import { OVERVIEW_SECTION_ORDER, orderOverviewSections } from '../lib/overviewOrderCore'

test('the six sections, in the owner’s order', () => {
  assert.deepEqual([...OVERVIEW_SECTION_ORDER], ['cards', 'todo', 'team', 'signupToPayment', 'dailyFunnel', 'sources'])
})

test('the fixed six come first, everything else below them', () => {
  const given = [{ key: 'myLink' }, { key: 'sources' }, { key: 'team' }, { key: 'cards' }, { key: 'extra' }, { key: 'todo' }, { key: 'dailyFunnel' }, { key: 'signupToPayment' }]
  assert.deepEqual(
    orderOverviewSections(given).map((s) => s.key),
    ['cards', 'todo', 'team', 'signupToPayment', 'dailyFunnel', 'sources', 'myLink', 'extra'],
  )
})

test('a role that sees fewer sections gets them in the same order', () => {
  const staff = [{ key: 'myLink' }, { key: 'todo' }, { key: 'cards' }]
  assert.deepEqual(orderOverviewSections(staff).map((s) => s.key), ['cards', 'todo', 'myLink'])
})

test('the Overview page draws its sections through the one constant', () => {
  const src = readFileSync('app/admin/page.tsx', 'utf8')
  assert.match(src, /orderOverviewSections\(sections\)/)
  for (const key of OVERVIEW_SECTION_ORDER) assert.match(src, new RegExp(`key: '${key}'`), `section ${key} is on the page`)
})
