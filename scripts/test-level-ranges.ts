/**
 * scripts/test-level-ranges.ts — npm run test:levelranges
 *
 * The onboarding Subjects step (owner, 13 Oct 2026): level ranges, quick picks,
 * the one search box, the minimum to continue, and saving as they go. Built on
 * the owner's own taxonomy file, so a range that named a grade the taxonomy does
 * not have would fail here. Pure — no network, no database.
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

import { parseTaxonomyCsv } from '../lib/taxonomySeed'
import {
  applyQuickPick,
  canContinue,
  levelRanges,
  pickApplied,
  resolveQuickPicks,
  resolveSelection,
  searchSubjects,
  selectionChips,
  selectionCounts,
  selectionFromIds,
  subjectsOffered,
  toggleGrade,
  toggleRange,
  toggleSubject,
  type Master,
  type RangeSelection,
  type Tree,
} from '../lib/onboarding/levelRanges'
import { TUTOR_SUBJECT_CAP } from '../lib/tutorSubjectCap'

const parsed = parseTaxonomyCsv(readFileSync('supabase/seed/taxonomy-2026.csv', 'utf8'))
const tree: Tree = {}
const masters: Master[] = []
let nextId = 1
for (const level of parsed.levels) {
  tree[level.name] = {}
  for (const grade of level.grades) {
    tree[level.name][grade.name] = grade.subjects
    for (const subject of grade.subjects) masters.push({ id: nextId++, category: level.name, level: grade.name, subject })
  }
}
// The main subjects, as Admin → Settings → Subjects holds them for two levels.
const core: Tree = {
  Primary: Object.fromEntries(Object.keys(tree.Primary).map((g) => [g, ['English', 'Urdu', 'Mathematics']])),
}

const ranges = levelRanges(tree)
const byId = (id: string) => ranges.find((r) => r.id === id)!

test('the eight named ranges, each made of real grades of ONE level', () => {
  const named = ranges.filter((r) => r.named)
  assert.deepEqual(
    named.map((r) => r.label),
    ['Play Group to KG', 'Grade 1–5', 'Grade 6–8', 'Grade 9–10 / Matric', 'Part I & II (FSc, FA, ICS, I.Com)', 'O Level', 'A Level', 'BS / University'],
  )
  assert.deepEqual(byId('primary').grades, ['Grade 1', 'Grade 2', 'Grade 3', 'Grade 4', 'Grade 5'])
  assert.deepEqual(byId('middle').grades, ['Grade 6', 'Grade 7', 'Grade 8'])
  assert.equal(byId('pre').grades.length, 3)
  assert.equal(byId('matric').grades.length, 4, 'Grade 9 and 10, Arts and Science')
  assert.deepEqual(byId('olevel').grades, ['O Levels'])
  assert.deepEqual(byId('alevel').grades, ['AS & A Levels'])
  for (const r of ranges) for (const g of r.grades) assert.ok(tree[r.category]?.[g], `${r.label}: ${g} is a real grade`)
})

test('every grade of the taxonomy is in exactly one range (nothing is unreachable)', () => {
  const seen = new Map<string, number>()
  for (const r of ranges) for (const g of r.grades) seen.set(`${r.category}|${g}`, (seen.get(`${r.category}|${g}`) ?? 0) + 1)
  for (const [category, grades] of Object.entries(tree)) for (const g of Object.keys(grades)) assert.equal(seen.get(`${category}|${g}`), 1, `${category} / ${g}`)
  // What the named ranges leave out is offered under "More levels".
  const more = ranges.filter((r) => !r.named).map((r) => r.label)
  assert.ok(more.includes('IGCSE Core') && more.some((l) => /quran/i.test(l)) && more.includes('IB'))
})

test('one tap on a range selects ALL its grades; a grade can then be switched off', () => {
  let sel: RangeSelection = {}
  sel = toggleRange(sel, byId('primary'))
  assert.deepEqual(sel.primary.grades, ['Grade 1', 'Grade 2', 'Grade 3', 'Grade 4', 'Grade 5'])
  sel = toggleGrade(sel, byId('primary'), 'Grade 4')
  sel = toggleGrade(sel, byId('primary'), 'Grade 5')
  assert.deepEqual(sel.primary.grades, ['Grade 1', 'Grade 2', 'Grade 3'])
  // Back on, in taxonomy order.
  sel = toggleGrade(sel, byId('primary'), 'Grade 5')
  assert.deepEqual(sel.primary.grades, ['Grade 1', 'Grade 2', 'Grade 3', 'Grade 5'])
  // The last grade off removes the level; a second tap on the range removes it too.
  let one = toggleRange({}, byId('olevel'))
  one = toggleGrade(one, byId('olevel'), 'O Levels')
  assert.deepEqual(one, {})
  assert.deepEqual(toggleRange(toggleRange({}, byId('middle')), byId('middle')), {})
})

test('the ids saved are each chosen subject at each CHOSEN grade — never another grade', () => {
  let sel = toggleRange({}, byId('primary'))
  sel = toggleGrade(sel, byId('primary'), 'Grade 5')
  sel = toggleSubject(sel, byId('primary'), 'Mathematics')
  const ids = resolveSelection(sel, ranges, masters)
  const rows = ids.map((id) => masters.find((m) => m.id === id)!)
  assert.equal(rows.length, 4)
  assert.deepEqual(rows.map((r) => r.level), ['Grade 1', 'Grade 2', 'Grade 3', 'Grade 4'])
  assert.ok(rows.every((r) => r.category === 'Primary' && r.subject === 'Mathematics'))
})

test('the minimum to continue is one level AND one subject', () => {
  assert.equal(canContinue({}), false)
  const levelOnly = toggleRange({}, byId('matric'))
  assert.equal(canContinue(levelOnly), false, 'a level with no subject is not enough')
  const both = toggleSubject(levelOnly, byId('matric'), 'Mathematics')
  assert.equal(canContinue(both), true)
  assert.deepEqual(selectionCounts(both), { levels: 1, subjects: 1 })
  // A subject picked from the search selects its level too.
  assert.equal(canContinue(toggleSubject({}, byId('olevel'), 'Physics')), true)
})

test('quick picks: a level and a subject in one tap, only ones the taxonomy can honour', () => {
  const picks = resolveQuickPicks(tree, core, ranges)
  assert.deepEqual(picks.map((p) => p.pick.label), ['Matric Maths', 'O Level English', 'Primary all subjects', 'Quran / Nazra', 'FSc Physics'])
  const get = (id: string) => picks.find((p) => p.pick.id === id)!
  assert.deepEqual(get('matric-maths').subjects, ['Mathematics'])
  assert.equal(get('matric-maths').grades.length, 4)
  assert.ok(subjectsOffered(tree, byId('olevel')).includes(get('olevel-english').subjects[0]))
  // "Primary all subjects" is the level's MAIN subjects, not all 57.
  assert.deepEqual(get('primary-all').subjects, ['English', 'Urdu', 'Mathematics'])
  assert.ok(get('quran').subjects.length >= 1)
  // FSc Physics takes the FSc grade only, not FA.
  assert.ok(get('fsc-physics').grades.length >= 1 && get('fsc-physics').grades.every((g) => /^fsc/i.test(g)))

  let sel = applyQuickPick({}, get('matric-maths'))
  assert.ok(pickApplied(sel, get('matric-maths')) && canContinue(sel))
  sel = applyQuickPick(sel, get('fsc-physics'))
  // Two picks never cross: no Matric Physics, no FSc Mathematics.
  const rows = resolveSelection(sel, ranges, masters).map((id) => masters.find((m) => m.id === id)!)
  assert.ok(rows.every((r) => (r.category.startsWith('Matric') ? r.subject === 'Mathematics' : r.subject === 'Physics')))
  // A second tap takes the pick back out.
  sel = applyQuickPick(sel, get('matric-maths'))
  assert.equal(pickApplied(sel, get('matric-maths')), false)
  // A pick the taxonomy cannot honour is not offered.
  assert.deepEqual(resolveQuickPicks(tree, core, ranges, [{ id: 'x', label: 'X', range: 'matric', subjects: [['Underwater Basket Weaving']] }]), [])
})

test('one search box: Search words and typos, found at every level, chosen levels first', () => {
  const words = { mathematics: ['maths', 'math', 'hisab'], 'computer science': ['computer'] }
  const maths = searchSubjects('maths', tree, ranges, {}, words)
  assert.ok(maths.length > 3 && maths.every((h) => /mathematics/i.test(h.subject)))
  assert.ok(new Set(maths.map((h) => h.range.id)).size > 3, 'found at several levels')
  assert.ok(searchSubjects('computer', tree, ranges, {}, words).some((h) => /computer/i.test(h.subject)))
  assert.ok(searchSubjects('bio', tree, ranges, {}).some((h) => h.subject === 'Biology'))
  assert.ok(searchSubjects('quran', tree, ranges, {}).length > 0)
  // A typo the server's search corrected is honoured.
  assert.ok(searchSubjects('fizics', tree, ranges, {}, {}, ['Physics']).every((h) => h.subject === 'Physics'))
  // The tutor's own levels lead.
  const sel = toggleRange({}, byId('olevel'))
  assert.equal(searchSubjects('maths', tree, ranges, sel, words)[0].range.id, 'olevel')
  assert.deepEqual(searchSubjects('m', tree, ranges, {}), [], 'two letters at least')
})

test('chosen items are removable chips, and a saved selection reads back the same', () => {
  let sel = toggleRange({}, byId('middle'))
  sel = toggleSubject(sel, byId('middle'), 'English')
  sel = toggleSubject(sel, byId('middle'), 'Mathematics')
  assert.deepEqual(selectionChips(sel, ranges).map((c) => `${c.subject} · ${c.range.label}`), ['English · Grade 6–8', 'Mathematics · Grade 6–8'])
  sel = toggleSubject(sel, byId('middle'), 'English') // tap the chip
  assert.deepEqual(selectionChips(sel, ranges).map((c) => c.subject), ['Mathematics'])
  // Leaving and coming back: the saved ids give the same levels, grades and subjects.
  sel = toggleGrade(sel, byId('middle'), 'Grade 8')
  const back = selectionFromIds(resolveSelection(sel, ranges, masters), ranges, masters)
  assert.deepEqual(back, { middle: { grades: ['Grade 6', 'Grade 7'], subjects: ['Mathematics'] } })
})

test('the step uses these rules, saves as the tutor goes, and keeps the cap', () => {
  const src = readFileSync('components/tutor/NewOnboardingFlow.tsx', 'utf8')
  const step = src.slice(src.indexOf('function SubjectsStep('), src.indexOf('function FeeStep('))
  for (const call of ['levelRanges(', 'resolveQuickPicks(', 'searchSubjects(', 'toggleRange(', 'toggleGrade(', 'selectionChips(', 'selectionFromIds(']) {
    assert.ok(step.includes(call), call)
  }
  assert.ok(step.includes('nextDisabled: !canContinueSel(sel)'), 'Next needs one level and one subject')
  assert.ok(step.includes('onAutoSave(ids)') && step.includes('TUTOR_SUBJECT_CAP'))
  assert.equal((step.match(/aria-label="Search a subject"/g) ?? []).length, 1, 'ONE search box')
  assert.ok(src.includes("await saveProfile({ subjectMasterIds: ids })"), 'autosave goes through the same save as Next')
  // The main subjects of every named level, all chosen at once, stay under the cap.
  let all: RangeSelection = {}
  for (const r of ranges.filter((x) => x.named)) {
    all = toggleRange(all, r)
    for (const s of subjectsOffered(tree, r).slice(0, 8)) all = toggleSubject(all, r, s)
  }
  assert.ok(resolveSelection(all, ranges, masters).length <= TUTOR_SUBJECT_CAP)
})
