/**
 * scripts/test-levels.ts
 *
 *   npm run test:levels
 *
 * The card-title Level segment (owner, 11 Sep 2026). Level is a multi-select now
 * (migration 79 split the lumped rows), so a job can carry "Grade 1".."Grade 5";
 * a contiguous run must read as "Grade 1–5", not a five-way pipe list. Pure, so
 * the collapse is unit-testable; the taxonomy split itself (subjects resolving
 * under each new level, legacy rows hidden but still valid) is verified live.
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'

import { collapseLevels } from '../lib/levelDisplay'

const DASH = '–'

test('a contiguous grade run collapses to a range', () => {
  assert.equal(collapseLevels(['Grade 1', 'Grade 2', 'Grade 3', 'Grade 4', 'Grade 5']), `Grade 1${DASH}5`)
  assert.equal(collapseLevels(['Grade 6', 'Grade 7', 'Grade 8']), `Grade 6${DASH}8`)
})

test('a same-suffix grade run collapses with its suffix (Arts / Science)', () => {
  assert.equal(collapseLevels(['Grade 9 Arts', 'Grade 10 Arts']), `Grade 9${DASH}10 Arts`)
  assert.equal(collapseLevels(['Grade 9 Science', 'Grade 10 Science']), `Grade 9${DASH}10 Science`)
})

test("the 2026 dataset's real grade names collapse (Grade 9 - Arts, Grade 6 to 8)", () => {
  // Migration 80's Matriculation grades carry a " - Arts"/" - Science" suffix.
  assert.equal(collapseLevels(['Grade 9 - Arts', 'Grade 10 - Arts']), `Grade 9${DASH}10 - Arts`)
  assert.equal(
    collapseLevels(['Grade 6', 'Grade 7', 'Grade 8']),
    `Grade 6${DASH}8`,
  )
  // Arts and Science are different suffixes → two runs, not one.
  assert.equal(
    collapseLevels(['Grade 9 - Arts', 'Grade 10 - Arts', 'Grade 9 - Science', 'Grade 10 - Science']),
    `Grade 9${DASH}10 - Arts, Grade 9${DASH}10 - Science`,
  )
})

test('a single grade is left as written', () => {
  assert.equal(collapseLevels(['Grade 4']), 'Grade 4')
})

test('non-contiguous grades are NOT collapsed', () => {
  assert.equal(collapseLevels(['Grade 1', 'Grade 3']), 'Grade 1, Grade 3')
  // A gap splits one run into two ranges.
  assert.equal(collapseLevels(['Grade 1', 'Grade 2', 'Grade 4', 'Grade 5']), `Grade 1${DASH}2, Grade 4${DASH}5`)
})

test('different suffixes do not merge across the boundary', () => {
  // Grade 10 Arts then Grade 9 Science: different suffix AND not +1 → two items.
  assert.equal(
    collapseLevels(['Grade 9 Arts', 'Grade 10 Arts', 'Grade 9 Science', 'Grade 10 Science']),
    `Grade 9${DASH}10 Arts, Grade 9${DASH}10 Science`,
  )
})

test('non-grade levels are kept verbatim and joined with commas', () => {
  assert.equal(collapseLevels(['AS Level', 'A Level']), 'AS Level, A Level')
  assert.equal(collapseLevels(['PYP', 'MYP', 'Diploma']), 'PYP, MYP, Diploma')
  assert.equal(collapseLevels(['Pre-Nursery', 'Play Group', 'Prep', 'KG-I']), 'Pre-Nursery, Play Group, Prep, KG-I')
})

test('grade runs and other levels mix cleanly', () => {
  assert.equal(collapseLevels(['Grade 1', 'Grade 2', 'Pre-Nursery']), `Grade 1${DASH}2, Pre-Nursery`)
})

test('empty / blank input is an empty string', () => {
  assert.equal(collapseLevels([]), '')
  assert.equal(collapseLevels([null, '', undefined, '  ']), '')
  // A legacy lumped level (single string) round-trips unchanged.
  assert.equal(collapseLevels(['Grade 1 to 5']), 'Grade 1 to 5')
})

test('conjunction mode joins the last two with " and " for the card-title phrase', () => {
  // Two non-contiguous grades read as prose in the title, comma in the body.
  assert.equal(collapseLevels(['Grade 2', 'Grade 5'], { conjunction: true }), 'Grade 2 and Grade 5')
  assert.equal(collapseLevels(['Grade 2', 'Grade 5']), 'Grade 2, Grade 5')
  // A collapsed range plus two more: comma-separate the earlier ones, "and" the last.
  assert.equal(
    collapseLevels(['Grade 1', 'Grade 2', 'Grade 3', 'Grade 4', 'Grade 5', 'Grade 8', 'O Levels'], { conjunction: true }),
    `Grade 1${DASH}5, Grade 8 and O Levels`,
  )
  // A single collapsed run is one part — no dangling "and".
  assert.equal(collapseLevels(['Grade 1', 'Grade 2', 'Grade 3'], { conjunction: true }), `Grade 1${DASH}3`)
  // A single grade and empty are unaffected by the flag.
  assert.equal(collapseLevels(['Grade 4'], { conjunction: true }), 'Grade 4')
  assert.equal(collapseLevels([], { conjunction: true }), '')
})
