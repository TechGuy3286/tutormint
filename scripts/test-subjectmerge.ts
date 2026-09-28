import { test } from 'node:test'
import assert from 'node:assert/strict'

import { mergeSubjectSelections, deriveSelections, type SubjectMasterLite } from '../lib/subjectMerge'

// A small taxonomy: level A ("category A") has grades G1+G2, each with Physics
// and Chemistry; level B has one grade with Maths.
//   A/Physics → ids 1 (G1), 2 (G2)
//   A/Chem    → ids 3 (G1), 4 (G2)
//   B/Maths   → id 5
const MASTERS: SubjectMasterLite[] = [
  { id: 1, category: 'A', subject: 'Physics' },
  { id: 2, category: 'A', subject: 'Physics' },
  { id: 3, category: 'A', subject: 'Chemistry' },
  { id: 4, category: 'A', subject: 'Chemistry' },
  { id: 5, category: 'B', subject: 'Maths' },
]
const eq = (a: number[], b: number[]) => assert.deepEqual([...a].sort((x, y) => x - y), [...b].sort((x, y) => x - y))

test('no change → identical set (full coverage)', () => {
  const existing = [1, 2, 3, 4]
  const sel = deriveSelections(existing, MASTERS) // { A: ['Chemistry','Physics'] }
  eq(mergeSubjectSelections(existing, MASTERS, sel), [1, 2, 3, 4])
})

test('no change → identical set (partial coverage)', () => {
  const existing = [1, 3] // Physics G1 only, Chemistry G1 only
  const sel = deriveSelections(existing, MASTERS) // { A: ['Chemistry','Physics'] }
  eq(mergeSubjectSelections(existing, MASTERS, sel), [1, 3])
})

test('add subject → added for every grade in the level', () => {
  const existing = [1, 2] // Physics both grades
  const sel = { A: ['Physics', 'Chemistry'] }
  eq(mergeSubjectSelections(existing, MASTERS, sel), [1, 2, 3, 4])
})

test('remove subject → removed from every grade', () => {
  const existing = [1, 2, 3, 4]
  const sel = { A: ['Physics'] } // Chemistry unpicked
  eq(mergeSubjectSelections(existing, MASTERS, sel), [1, 2])
})

test('untouched partial-grade subject stays partial (not expanded)', () => {
  const existing = [1, 3] // Physics G1 only, Chemistry G1 only
  const sel = { A: ['Physics', 'Chemistry'] } // both still selected, untouched
  eq(mergeSubjectSelections(existing, MASTERS, sel), [1, 3])
})

test('untouched partial subject stays partial while a NEW subject expands', () => {
  const existing = [1] // Physics G1 only
  const sel = { A: ['Physics', 'Chemistry'] } // Chemistry newly picked
  eq(mergeSubjectSelections(existing, MASTERS, sel), [1, 3, 4]) // Physics stays [1], Chemistry all grades
})

test('new level → its picked subjects added for all its grades', () => {
  const existing = [1, 2]
  const sel = { A: ['Physics'], B: ['Maths'] }
  eq(mergeSubjectSelections(existing, MASTERS, sel), [1, 2, 5])
})

test('removed level (empty selection) → all its rows removed', () => {
  const existing = [1, 2, 5]
  const sel = { A: ['Physics'], B: [] } // B removed
  eq(mergeSubjectSelections(existing, MASTERS, sel), [1, 2])
})

test('a level not in selections is left exactly as-is', () => {
  const existing = [1, 2, 5]
  const sel = { A: ['Physics', 'Chemistry'] } // B untouched (not passed)
  eq(mergeSubjectSelections(existing, MASTERS, sel), [1, 2, 3, 4, 5])
})

test('deriveSelections maps existing ids to subjects per level', () => {
  assert.deepEqual(deriveSelections([1, 3, 5], MASTERS), { A: ['Chemistry', 'Physics'], B: ['Maths'] })
  assert.deepEqual(deriveSelections([], MASTERS), {})
})
