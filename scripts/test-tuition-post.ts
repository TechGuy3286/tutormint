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
import { selectAllForGrade, clearAllForGrade, gradeFullySelected } from '../lib/gradeSubjectBulk'

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
  const empty = src.slice(src.indexOf('const EMPTY'), src.indexOf('}', src.indexOf('const EMPTY')))
  for (const f of ['teachingMode', 'category', 'levels', 'subjects', 'city', 'area', 'budgetMin', 'budgetMax', 'schedule', 'genderPreference', 'school', 'title', 'description', 'origin', 'contactName', 'contactPhone', 'contactWhatsapp', 'contactEmail', 'contactAddress', 'contactSocial']) {
    assert.match(empty, new RegExp(`\\b${f}: (''|\\[\\])`), f)
  }
})

test('Select all / Clear all touch only that grade’s subjects', () => {
  const grade1 = ['English', 'Mathematics', 'Urdu']
  const grade6 = ['English', 'Physics', 'Chemistry']
  let sel = selectAllForGrade([], grade1)
  assert.deepEqual(sel, grade1)
  assert.equal(gradeFullySelected(sel, grade1), true)
  assert.ok(!sel.includes('Physics'), 'never a subject from another grade')
  sel = selectAllForGrade(sel, grade6)
  assert.deepEqual(sel, ['English', 'Mathematics', 'Urdu', 'Physics', 'Chemistry'])
  sel = clearAllForGrade(sel, grade6)
  assert.deepEqual(sel, ['Mathematics', 'Urdu'], 'a shared subject (English) is one choice, cleared with the grade')
  sel = selectAllForGrade(sel, grade1).filter((s) => s !== 'Urdu')
  assert.deepEqual(sel, ['Mathematics', 'English'])
  assert.equal(gradeFullySelected(sel, grade1), false)
})
