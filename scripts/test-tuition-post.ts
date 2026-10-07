/**
 * scripts/test-tuition-post.ts — tuition posting (owner, 6 Oct 2026, item 17):
 * the "Post type | Class | School name | City" title, the 60-character page
 * title, and the per-grade Select all / Clear all rule.
 *
 *   npm run test:tuitionpost
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'

import { buildTuitionTitle, postType, tuitionPageTitle, TUITION_TITLE_MAX } from '../lib/tuitionTitle'
import { composeJobCopy, unsupportedFacts, type JobSelection } from '../lib/ai/jobBrief'
import {
  clearGrade, displayGroups, gradeSubjectsLine, gradesMissingSubjects, gradesWithoutIds, groupIdsByGrade, keepGrades,
  perGradeKey, sanitizeGradeSubjects, selectAllForGrade, toggleGradeSubject, unionMasterIds, unionSubjects, type GradeSubjectMap,
} from '../lib/gradeSubjects'
import { duplicateReasons, type DuplicateFacts } from '../lib/duplicatesCore'

test('post type comes from the Job Type and gender selections', () => {
  assert.equal(postType('Home Tutor', 'female'), 'Female Home Tutor Required')
  assert.equal(postType('Online Tutor', null), 'Online Tutor Required')
  assert.equal(postType('O Levels Teacher', 'male'), 'Male O Levels Teacher Required')
  assert.equal(postType(null, 'female'), 'Female Tutor Required')
  assert.equal(postType('', ''), 'Tutor Required')
})

test('title WITH a school: Post type | Class | School | City', () => {
  assert.equal(
    buildTuitionTitle({ mode: 'Primary Teacher', gender: 'female', levels: ['Grade 1', 'Grade 2', 'Grade 3', 'Grade 4', 'Grade 5'], school: 'Beaconhouse', area: 'Johar Town', city: 'Lahore' }),
    'Female Primary Teacher Required | Grade 1–5 | Beaconhouse | Lahore',
  )
})

test('title WITHOUT a school uses the area; the city is never repeated', () => {
  assert.equal(
    buildTuitionTitle({ mode: 'Home Tutor', gender: null, levels: ['Grade 6'], area: 'Johar Town', city: 'Lahore' }),
    'Home Tutor Required | Grade 6 | Johar Town | Lahore',
  )
  assert.equal(
    buildTuitionTitle({ mode: 'Home Tutor', gender: null, levels: ['Grade 6'], area: 'Bahria Town Lahore', city: 'Lahore' }),
    'Home Tutor Required | Grade 6 | Bahria Town | Lahore',
  )
  assert.equal(
    buildTuitionTitle({ mode: 'Home Tutor', gender: null, levels: ['Grade 6'], area: 'North Karachi', city: 'Karachi' }),
    'Home Tutor Required | Grade 6 | North Karachi',
  )
  assert.equal(
    buildTuitionTitle({ mode: 'Home Tutor', gender: null, levels: ['Grade 2', 'Grade 5'], area: '', city: 'Lahore' }),
    'Home Tutor Required | Grade 2, Grade 5 | Lahore',
  )
})

test('the composer writes the standard title and it passes the figure verifier', () => {
  const sel: JobSelection = {
    level: 'Grade 6', subjects: ['Mathematics'], city: 'Lahore', area: 'Johar Town', mode: 'Home Tutor',
    budgetMin: 10000, budgetMax: 19999, schedule: null, levels: ['Grade 6'], gender: 'female', school: null,
  }
  const c = composeJobCopy(sel)
  assert.equal(c.title, 'Female Home Tutor Required | Grade 6 | Johar Town | Lahore')
  assert.deepEqual(unsupportedFacts(`${c.title} ${c.description}`, sel), [])
})

test('<title> is 60 characters or fewer: school/area first, then the post type, never mid-word', () => {
  const short = 'Home Tutor Required | Grade 6 | Lahore'
  assert.equal(tuitionPageTitle(short), `${short} | TutorMint`)

  const long = 'Female O Levels Teacher Required | Grade 9–10 | Beaconhouse Defence Campus | Karachi'
  const t = tuitionPageTitle(long)
  assert.ok(t.length <= TUITION_TITLE_MAX, t)
  assert.equal(t, 'Female O Levels Teacher Required | Grade 9–10 | Karachi', 'the school is dropped first')

  const longer = 'Female O Levels Teacher Required | Grade 1, Grade 3, Grade 5, Grade 7 | DHA Phase 6 | Karachi'
  const u = tuitionPageTitle(longer)
  assert.ok(u.length <= TUITION_TITLE_MAX, u)
  assert.ok(!u.includes('DHA'), 'area dropped')
  assert.ok(u.startsWith('O Levels Teacher Required') || u.startsWith('Teacher Required'), u)

  // An older title with extra parts keeps its grade and city; the subject list
  // and the address go first.
  const extra = 'Primary School Teacher Required | English, Urdu, General Science, Social Studies and Islamiat / Islamic Studies | Grade 4–5 | (C 82 block 13 near Rado Bakery Gulistan-e- Johar ) | Karachi'
  assert.equal(tuitionPageTitle(extra), 'Primary School Teacher Required | Grade 4–5 | Karachi')

  const old = 'We are looking for an experienced and patient home tutor for our two children in Gulberg'
  const v = tuitionPageTitle(old)
  assert.ok(v.length <= TUITION_TITLE_MAX)
  assert.ok(old.startsWith(v) && (old[v.length] === ' ' || old.length === v.length), 'never mid-word')
})

test('Clear form: confirms first, then empties every field and removes the draft (create only)', async () => {
  const { readFileSync } = await import('node:fs')
  const src = readFileSync('components/forms/PostTuitionForm.tsx', 'utf8')
  assert.ok(src.includes("title: 'Clear all fields?', confirmLabel: 'Clear', cancelLabel: 'Cancel'"), 'asks first')
  const body = src.slice(src.indexOf('const clearForm = async'), src.indexOf('const discardDraft'))
  for (const step of ['clearFormDraft(draftKey)', "takeDraft('post')", 'setV({ ...EMPTY })', 'setScheduleSlots([])', 'setHasDraft(false)']) {
    assert.ok(body.includes(step), step)
  }
  assert.ok(src.includes("{mode === 'create' && (") && src.includes('Clear form'), 'shown on the create form')
  assert.ok(src.includes('Discard draft'), 'Discard draft stays')
  // EMPTY really is empty for every field the button must reset.
  const empty = src.slice(src.indexOf('const EMPTY'), src.indexOf('\n}\n', src.indexOf('const EMPTY')))
  assert.ok(empty.includes('gradeSubjects: {}'), 'per-grade subjects reset too')
  for (const f of ['teachingMode', 'category', 'levels', 'subjects', 'city', 'area', 'budgetMin', 'budgetMax', 'schedule', 'genderPreference', 'school', 'title', 'description', 'origin', 'contactName', 'contactPhone', 'contactWhatsapp', 'contactEmail', 'contactAddress', 'contactSocial']) {
    assert.match(empty, new RegExp(`\\b${f}: (''|\\[\\])`), f)
  }
})

test('per grade: Select all on Grade 1 leaves Grades 2 and 3 untouched; a chip toggles one grade only', () => {
  const offered = { 'Grade 1': ['English', 'Urdu', 'Mathematics'], 'Grade 2': ['English', 'Mathematics'], 'Grade 3': ['Science'] }
  let m: GradeSubjectMap = keepGrades({}, ['Grade 1', 'Grade 2', 'Grade 3'])
  m = selectAllForGrade(m, 'Grade 1', offered['Grade 1'])
  assert.deepEqual(m, { 'Grade 1': ['English', 'Urdu', 'Mathematics'], 'Grade 2': [], 'Grade 3': [] })
  m = toggleGradeSubject(m, 'Grade 2', 'Mathematics')
  assert.deepEqual(m['Grade 2'], ['Mathematics'])
  assert.deepEqual(m['Grade 1'], ['English', 'Urdu', 'Mathematics'], 'Grade 1 unchanged')
  m = toggleGradeSubject(m, 'Grade 1', 'Urdu')
  assert.deepEqual(m['Grade 1'], ['English', 'Mathematics'])
  assert.deepEqual(m['Grade 2'], ['Mathematics'], 'Grade 2 unchanged')
  assert.deepEqual(clearGrade(m, 'Grade 1')['Grade 2'], ['Mathematics'], 'Clear all is per grade')
  // Validation: every selected grade needs a subject.
  assert.deepEqual(gradesMissingSubjects(m, ['Grade 1', 'Grade 2', 'Grade 3'], offered), ['Grade 3'])
})

test('removing a grade removes its subject list, and the combined list stays in sync', () => {
  let m: GradeSubjectMap = { 'Grade 1': ['English', 'Urdu'], 'Grade 2': ['Mathematics'] }
  assert.deepEqual(unionSubjects(m, ['Grade 1', 'Grade 2']), ['English', 'Urdu', 'Mathematics'])
  m = keepGrades(m, ['Grade 2'])
  assert.deepEqual(m, { 'Grade 2': ['Mathematics'] })
  assert.deepEqual(unionSubjects(m, ['Grade 2']), ['Mathematics'])
  // Stored side: the union of per-grade ids is job_subjects.
  const groups = sanitizeGradeSubjects([{ grade: 'Grade 1', masterIds: [11, 12, 12] }, { grade: 'Grade 2', masterIds: [21] }, { grade: 'Grade 9', masterIds: [99] }, { grade: 'Grade 3', masterIds: [] }], ['Grade 1', 'Grade 2', 'Grade 3'])
  assert.deepEqual(groups, [{ grade: 'Grade 1', masterIds: [11, 12] }, { grade: 'Grade 2', masterIds: [21] }], 'only this tuition’s grades, no repeats, no empty grade')
  assert.deepEqual(unionMasterIds(groups!), [11, 12, 21])
  assert.deepEqual(gradesWithoutIds(groups!, ['Grade 1', 'Grade 2', 'Grade 3']), ['Grade 3'], 'the server refuses a grade with no subject')
})

test('display: grouped by grade, once when every grade is the same', () => {
  assert.equal(
    gradeSubjectsLine([{ grade: 'Grade 1', subjects: ['English', 'Urdu', 'Maths'] }, { grade: 'Grade 2', subjects: ['Maths'] }]),
    'Grade 1: English, Urdu, Maths · Grade 2: Maths',
  )
  assert.equal(
    gradeSubjectsLine([1, 2, 3].map((n) => ({ grade: `Grade ${n}`, subjects: ['English', 'Urdu', 'Maths'] }))),
    'Grades 1–3: English, Urdu, Maths',
  )
  assert.deepEqual(displayGroups([{ grade: 'Grade 6', subjects: ['Physics'] }]), [{ label: 'Grade 6', subjects: ['Physics'] }])
  assert.equal(gradeSubjectsLine([{ grade: 'Grade 1', subjects: ['English'] }, { grade: 'Grade 4', subjects: ['English'] }]), 'Grade 1, Grade 4: English', 'non-adjacent grades are not pluralised')
  assert.equal(gradeSubjectsLine(['Grade 7', 'Grade 8', 'Grade 6'].map((grade) => ({ grade, subjects: ['Computer Science'] }))), 'Grades 6–8: Computer Science', 'grades in natural order')
})

test('backfill: each grade keeps the tuition’s current subjects; the union is unchanged', () => {
  const gradeOf = new Map<number, string>([[11, 'Grade 1'], [12, 'Grade 1'], [21, 'Grade 2'], [22, 'Grade 2'], [90, 'Grade 1 to 5']])
  const before = [22, 11, 21, 12, 90]
  const g = groupIdsByGrade(before, gradeOf, ['Grade 1', 'Grade 2'])
  assert.deepEqual(g, [{ grade: 'Grade 1', masterIds: [11, 12] }, { grade: 'Grade 2', masterIds: [21, 22] }, { grade: 'Grade 1 to 5', masterIds: [90] }])
  assert.deepEqual(unionMasterIds(g), [...before].sort((a, b) => a - b), 'job_subjects stays exactly as it was')
})

test('duplicate check compares per grade when both tuitions have it, otherwise the combined list', () => {
  const base: DuplicateFacts = { id: 'a', title: 'A', city: 'Lahore', area: 'DHA', classLevels: ['Grade 1', 'Grade 2'], masterIds: [11, 21], genderPreference: null, budgetPkr: 5000, budgetMinPkr: 5000, budgetMaxPkr: 9999, createdAt: '2026-10-01' }
  const a = { ...base, gradeSubjects: [{ grade: 'Grade 1', masterIds: [11] }, { grade: 'Grade 2', masterIds: [21] }] }
  const sameSplit = { ...base, id: 'b', title: 'B', gradeSubjects: [{ grade: 'Grade 2', masterIds: [21] }, { grade: 'Grade 1', masterIds: [11] }] }
  assert.deepEqual(duplicateReasons(a, sameSplit), ['same combination'])
  assert.equal(perGradeKey(a.gradeSubjects), perGradeKey(sameSplit.gradeSubjects), 'order-insensitive')
  const otherSplit = { ...base, id: 'c', title: 'C', gradeSubjects: [{ grade: 'Grade 1', masterIds: [11, 21] }, { grade: 'Grade 2', masterIds: [21] }] }
  assert.deepEqual(duplicateReasons(a, otherSplit), [], 'same combined list, different split: not a repeat')
  assert.deepEqual(duplicateReasons(a, { ...base, id: 'd', title: 'D' }), ['same combination'], 'one side without per-grade data: the combined list decides')
})

test('Main subjects: the core map is per level, and the chip adds that grade’s core only (hidden when none)', async () => {
  const { buildTaxonomy } = await import('../lib/taxonomyBuild')
  const { core, tree } = buildTaxonomy({
    categories: [{ slug: 'p', name: 'Primary', sort_order: 1 }],
    levels: [
      { slug: 'g1', category_slug: 'p', name: 'Grade 1', sort_order: 1, legacy: false },
      { slug: 'g2', category_slug: 'p', name: 'Grade 2', sort_order: 2, legacy: false },
      { slug: 'old', category_slug: 'p', name: 'Grade 1 to 5', sort_order: 9, legacy: true },
    ],
    subjects: [{ slug: 'en', name: 'English' }, { slug: 'art', name: 'Art & Drawing' }],
    master: [
      { id: 1, category_slug: 'p', level_slug: 'g1', subject_slug: 'en', leaf_type: null, is_core: true },
      { id: 2, category_slug: 'p', level_slug: 'g1', subject_slug: 'art', leaf_type: null, is_core: false },
      { id: 3, category_slug: 'p', level_slug: 'g2', subject_slug: 'en', leaf_type: null, is_core: false },
      { id: 4, category_slug: 'p', level_slug: 'old', subject_slug: 'en', leaf_type: null, is_core: true },
    ],
  } as never)
  assert.deepEqual(core, { Primary: { 'Grade 1': ['English'] } }, 'same subject core at one level and not another; legacy ignored')
  assert.deepEqual(tree.Primary['Grade 2'], ['English'], 'every subject stays selectable')
  // Adding Grade 1's core touches Grade 1 only.
  let m: GradeSubjectMap = keepGrades({}, ['Grade 1', 'Grade 2', 'Grade 3'])
  m = selectAllForGrade(m, 'Grade 1', core.Primary['Grade 1'])
  assert.deepEqual(m, { 'Grade 1': ['English'], 'Grade 2': [], 'Grade 3': [] })
  const { readFileSync } = await import('node:fs')
  const sel = readFileSync('components/TaxonomySelector.tsx', 'utf8')
  assert.ok(sel.includes('Main subjects') && sel.includes('{main.length > 0 && ('), 'the chip is "Main subjects" and hides when a grade has none')
  assert.ok(sel.includes('setMap(selectAllForGrade(map, g, main))'), 'it adds the core list, not every subject')
  assert.ok(!/>\s*Select all\s*</.test(sel.slice(sel.indexOf('function PerGradeSubjects'))), 'no per-grade "Select all" left')
})

test('Settings → Subjects is owner and admin only; it changes only the core flag', async () => {
  const { SCREEN_ACCESS, roleSatisfies } = await import('../lib/adminAccessCore')
  assert.equal(roleSatisfies('owner', SCREEN_ACCESS.subjectsCore), true)
  assert.equal(roleSatisfies('admin', SCREEN_ACCESS.subjectsCore), true)
  for (const r of ['operations', 'tuitions_staff'] as const) assert.equal(roleSatisfies(r, SCREEN_ACCESS.subjectsCore), false, r)
  const { readFileSync } = await import('node:fs')
  const route = readFileSync('app/api/admin/taxonomy/core/route.ts', 'utf8')
  assert.ok(route.includes('checkAdminRole(...SCREEN_ACCESS.subjectsCore)'), 'the server checks the role')
  const lib = readFileSync('lib/subjectsCore.ts', 'utf8')
  const writes = [...lib.matchAll(/\.from\('([a-z_]+)'\)\.(update|insert|delete|upsert)\(/g)].map((x) => `${x[1]}.${x[2]}`)
  assert.deepEqual([...new Set(writes)], ['taxonomy_master.update'], 'only taxonomy_master is updated — nothing added, renamed or deleted')
  assert.ok(lib.includes(".update({ is_core: true })") && lib.includes(".update({ is_core: false })"))
  assert.ok(lib.includes("action: 'taxonomy.core'"), 'audited')
})
