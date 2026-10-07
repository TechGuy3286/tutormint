import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'

import { parseBody, z } from '../lib/validate'
import { TUTOR_SUBJECT_CAP, TOO_MANY_SUBJECTS, subjectIdsSchema, dedupeSubjectIds } from '../lib/tutorSubjectCap'

// Hotfix, 7 Oct 2026 — "Subject Master Ids is too long" on the onboarding
// subject step. The old cap was 60; Primary + Middle + IGCSE + Intermediate
// main subjects produce 101 ids, every level's main subjects 142.

const Body = z.object({ subjectMasterIds: subjectIdsSchema.optional() })
const req = (body: unknown) =>
  new Request('http://x/api/profile/save', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
const range = (n: number, from = 1) => Array.from({ length: n }, (_, i) => from + i)

test('the cap covers every level with all its main subjects, with room to spare', () => {
  assert.equal(TUTOR_SUBJECT_CAP, 400)
  assert.ok(TUTOR_SUBJECT_CAP >= 142 + 200)
})

test('the reported case (101 ids) and the largest main-subject case (142) save', async () => {
  for (const n of [101, 142, TUTOR_SUBJECT_CAP]) {
    const r = await parseBody(req({ subjectMasterIds: range(n) }), Body)
    assert.equal(r.ok, true, `n=${n}`)
  }
})

test('duplicates are removed before the cap is checked', async () => {
  const ids = [...range(TUTOR_SUBJECT_CAP), ...range(TUTOR_SUBJECT_CAP)]
  const r = await parseBody(req({ subjectMasterIds: ids }), Body)
  assert.equal(r.ok, true)
  if (r.ok) assert.equal(r.data.subjectMasterIds?.length, TUTOR_SUBJECT_CAP)
  assert.deepEqual(dedupeSubjectIds([3, 1, 3, 2, 1]), [3, 1, 2])
})

test('over the cap: the plain message, never the field name', async () => {
  const r = await parseBody(req({ subjectMasterIds: range(TUTOR_SUBJECT_CAP + 1) }), Body)
  assert.equal(r.ok, false)
  if (!r.ok) {
    const j = await r.response.json()
    assert.equal(j.error, TOO_MANY_SUBJECTS)
    assert.ok(!/Ids|too long|too big|Invalid/i.test(j.error))
  }
})

test('a bad id is a plain message too', async () => {
  const r = await parseBody(req({ subjectMasterIds: [1, 'x', -2] }), Body)
  assert.equal(r.ok, false)
  if (!r.ok) assert.ok(!/Subject Master|Ids|Invalid/i.test((await r.response.json()).error))
})

test('onboarding, Settings and the admin editor share the one cap', () => {
  assert.ok(readFileSync('app/api/profile/save/route.ts', 'utf8').includes('subjectIdsSchema'))
  assert.ok(!/\.max\(60\)/.test(readFileSync('app/api/profile/save/route.ts', 'utf8')))
  assert.ok(readFileSync('app/api/admin/tutors/edit/route.ts', 'utf8').includes('TUTOR_SUBJECT_CAP'))
  assert.ok(!readFileSync('app/api/documents/upload/route.ts', 'utf8').includes("'Invalid upload.'"))
})
