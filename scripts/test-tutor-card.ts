/**
 * scripts/test-tutor-card.ts — npm run test:tutorcard
 * View Profile is a tile in the card's action grid (owner, 9 Oct 2026):
 * Message | Demo, Shortlist | View Profile; navy outline like Shortlist's red
 * one; no standalone button above the grid. Source scans; no browser.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const card = readFileSync('components/TutorCard.tsx', 'utf8')

test('View Profile is one tile in the grid, after Shortlist, outlined in navy', () => {
  assert.match(card, /key: 'profile',\s*label: 'View Profile'/)
  assert.match(card, /className: 'border border-tm-navy text-tm-navy hover:bg-tm-tint-navy'/)
  assert.match(card, /className: 'border border-tm-red text-tm-red hover:bg-tm-tint-red'/)
  const shortlist = card.indexOf("key: 'shortlist'")
  const tile = card.indexOf('                  viewProfile,')
  const hire = card.indexOf("key: 'hire'")
  assert.ok(shortlist > 0 && tile > shortlist && hire > tile, 'order: … Shortlist, View Profile, Hire')
  // A tutor viewing another tutor gets View Profile alone.
  assert.match(card, /otherTutorViewer\s*\?\s*\[viewProfile\]/)
})

test('the old standalone View Profile button is gone', () => {
  assert.doesNotMatch(card, /mb-2 flex justify-end/)
  assert.equal((card.match(/View Profile/g) ?? []).length >= 1, true)
  assert.doesNotMatch(card, />\s*View Profile\s*</)
})

test('the grid keeps a leftover tile one column wide; only a lone action spans full width', () => {
  const ca = readFileSync('components/CardActions.tsx', 'utf8')
  assert.match(ca, /actions\.length === 1 \? 'grid-cols-1' : 'grid-cols-2'/)
  assert.doesNotMatch(ca, /col-span-2/)
})
