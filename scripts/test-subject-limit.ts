// npm run test:subjectlimit — at most 15 distinct subjects per tutor (owner, 21 Oct 2026).
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

import {
  SUBJECT_LIMIT,
  SUBJECT_LIMIT_MESSAGE,
  OVER_LIMIT_NOTE,
  canAddSubject,
  subjectChangeAllowed,
  subjectCounterLabel,
  subjectKeysOfIds,
  subjectKeysOfNames,
  subjectLimitProblem,
} from '../lib/subjectLimitCore'
import { subjectLimitRefusal } from '../lib/subjectLimit'

// 20 subjects, each offered at 3 levels: id = subject * 10 + level.
const NAMES = Array.from({ length: 20 }, (_, i) => `Subject ${String.fromCharCode(65 + i)}`)
const nameOf = (id: number) => NAMES[Math.floor(id / 10)]
const idsFor = (subjects: number, levels = 1) => Array.from({ length: subjects }, (_, s) => Array.from({ length: levels }, (_, l) => s * 10 + l)).flat()

test('the limit is 15 and the wording is the owner’s', () => {
  assert.equal(SUBJECT_LIMIT, 15)
  assert.equal(SUBJECT_LIMIT_MESSAGE, 'You can choose up to 15 subjects. Remove one to add another.')
  assert.equal(OVER_LIMIT_NOTE, 'Parents trust focused profiles — please keep your top 15 subjects.')
  assert.equal(subjectCounterLabel(12), '12 of 15 subjects')
})

test('a subject counts once however many levels it is taught at', () => {
  assert.equal(subjectKeysOfIds(idsFor(15, 3), nameOf).size, 15)
  // Two taxonomy names for one subject count once.
  assert.equal(subjectKeysOfNames(['Islamiat / Islamic Studies', 'Islamiyat', 'Islamic Studies']).size, 1)
})

test('the server refuses a 16th subject', () => {
  assert.equal(subjectLimitProblem(idsFor(15, 3), [], nameOf), null)
  assert.equal(subjectLimitProblem(idsFor(16), idsFor(15), nameOf), SUBJECT_LIMIT_MESSAGE)
  assert.equal(subjectLimitProblem(idsFor(16), [], nameOf), SUBJECT_LIMIT_MESSAGE)
  // Adding a level of a subject already chosen is not a new subject.
  assert.equal(subjectLimitProblem([...idsFor(15), 141, 142], idsFor(15), nameOf), null)
})

test('a tutor already over 15 keeps everything and may remove, but not add', () => {
  const saved = idsFor(18)
  assert.equal(subjectLimitProblem(saved, saved, nameOf), null, 'saving the same set (e.g. with other fields)')
  assert.equal(subjectLimitProblem(idsFor(17), saved, nameOf), null, 'a removal, still over')
  assert.equal(subjectLimitProblem([...idsFor(17), 171], saved, nameOf), null, 'another level of a saved subject')
  assert.equal(subjectLimitProblem([...idsFor(17), 190], saved, nameOf), SUBJECT_LIMIT_MESSAGE, 'a new subject')
  assert.equal(subjectLimitProblem([...idsFor(14), 190], saved, nameOf), null, 'at 15 or fewer a new one is fine')
})

test('pickers: adding stops at 15, removing never does', () => {
  const k15 = subjectKeysOfNames(NAMES.slice(0, 15))
  assert.equal(canAddSubject(k15, NAMES[15]), false)
  assert.equal(canAddSubject(k15, NAMES[0]), true, 'already chosen')
  assert.equal(canAddSubject(subjectKeysOfNames(NAMES.slice(0, 14)), NAMES[15]), true)
  assert.equal(subjectChangeAllowed(subjectKeysOfNames(NAMES.slice(0, 18)), subjectKeysOfNames(NAMES.slice(0, 16))), true)
})

test('subjectLimitRefusal reads subject names and refuses a 16th', async () => {
  const client = {
    from: (t: string) => ({
      select: () => ({
        in: async (_c: string, v: (number | string)[]) => ({
          data: t === 'taxonomy_master' ? (v as number[]).map((id) => ({ id, subject_slug: `s${Math.floor(id / 10)}` })) : (v as string[]).map((slug) => ({ slug, name: NAMES[Number(slug.slice(1))] })),
          error: null,
        }),
      }),
    }),
  }
  assert.equal(await subjectLimitRefusal(client, idsFor(16), idsFor(15)), SUBJECT_LIMIT_MESSAGE)
  assert.equal(await subjectLimitRefusal(client, idsFor(15, 3), idsFor(15)), null)
  assert.equal(await subjectLimitRefusal(client, idsFor(17), idsFor(18)), null)
})

test('every subject save route checks the limit before it writes; other saves are untouched', () => {
  const save = readFileSync('app/api/profile/save/route.ts', 'utf8')
  const check = save.indexOf('subjectLimitRefusal(supabase, ids, savedIds)')
  assert.ok(check > 0)
  // Inside the subjects-only branch: a save without subjects never reaches it.
  assert.ok(save.lastIndexOf('if (Array.isArray(body.subjectMasterIds)) {', check) > 0)
  assert.ok(check < save.indexOf("from('tutor_subjects').delete()"), 'before the delete')
  const edit = readFileSync('app/api/admin/tutors/edit/route.ts', 'utf8')
  assert.ok(edit.indexOf('subjectLimitRefusal(admin, ids, oldIds)') < edit.indexOf("from('tutor_subjects').delete()"))
  const onb = readFileSync('app/api/tutor/onboarding/route.ts', 'utf8')
  assert.ok(onb.indexOf('subjectLimitRefusal(') > 0 && onb.indexOf('subjectLimitRefusal(') < onb.indexOf("from('tutor_subjects').delete()"))
  for (const f of ['components/tutor/NewOnboardingFlow.tsx', 'components/tutor/SubjectLevelEditor.tsx', 'components/tutor/CompleteProfileFlow.tsx', 'app/admin/tutors/[id]/TutorFieldEditor.tsx']) {
    assert.ok(readFileSync(f, 'utf8').includes('SubjectLimitNote'), `${f} shows the counter`)
  }
})
