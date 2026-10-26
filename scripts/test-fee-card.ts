/**
 * scripts/test-fee-card.ts — /pay/choose fee card (owner, 27 Oct 2026): the
 * heading is exactly تصدیق کروانا کیوں ضروری ہے؟ in the brand green; in that
 * card the Urdu text comes first and the English under it; the plan card and
 * the rest of the page are unchanged.   npm run test:feecard
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const PAGE = readFileSync('app/(site)/pay/choose/page.tsx', 'utf8')
const HEADING = 'تصدیق کروانا کیوں ضروری ہے؟'

test('the heading is exactly the owner’s Urdu text', () => {
  assert.ok(PAGE.includes(`export const FEE_CARD_TITLE = '${HEADING}'`))
  assert.ok(!PAGE.includes('One-Time Verification Fee'))
})

test('the heading is in the brand green, right-to-left, Urdu', () => {
  const at = PAGE.indexOf('data-fee-card-title')
  const tag = PAGE.slice(PAGE.lastIndexOf('<p', at), at)
  assert.match(tag, /lang="ur"/)
  assert.match(tag, /dir="rtl"/)
  assert.match(tag, /text-tm-green-deep/)
  assert.ok(PAGE.slice(at, at + 80).includes('{FEE_CARD_TITLE}'))
})

test('in the fee card the Urdu text comes first, the English under it', () => {
  const block = PAGE.slice(PAGE.indexOf('{unlocks && isFee && ('), PAGE.indexOf('{unlocks && !isFee && ('))
  assert.ok(block.indexOf('{unlocks.ur}') > 0)
  assert.ok(block.indexOf('{unlocks.ur}') < block.indexOf('{unlocks.en}'))
})

test('the plan card is unchanged: English first, then Urdu, the price line kept', () => {
  const block = PAGE.slice(PAGE.indexOf('{unlocks && !isFee && ('))
  assert.ok(block.indexOf('{unlocks.en}') < block.indexOf('{unlocks.ur}'))
  assert.ok(PAGE.includes('{packageName} — {priceLine(price)}'))
  assert.ok(PAGE.includes('Runs for 30 days. Non-refundable.'))
})

test('the heading pair is registered on the contrast gate (large text)', () => {
  assert.ok(readFileSync('scripts/contrast-check.ts', 'utf8').includes("where: 'pay/choose fee card heading (Urdu, text-xl font-black)', large: true"))
})
