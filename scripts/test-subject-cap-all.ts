// npm run test:subjectcapall — the 15-subject limit on EVERY path (owner,
// 27 Oct 2026): onboarding, Settings (profile save), admin edit and bulk import;
// a 16th is refused with a clear message; nobody is trimmed; a tutor over the
// limit sees a banner and may only remove. Invented data only.
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

import { SUBJECT_LIMIT, SUBJECT_LIMIT_MESSAGE, subjectLimitProblem, subjectChangeAllowed, overCapBannerText, canAddSubject } from '../lib/subjectLimitCore'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const read = (p: string) => readFileSync(join(ROOT, p), 'utf8')

const names = new Map<number, string>()
for (let i = 1; i <= 30; i++) names.set(i, `Subject ${String.fromCharCode(64 + i)}${i}`)
const nameOf = (id: number) => names.get(id)
const ids = (n: number) => Array.from({ length: n }, (_, i) => i + 1)

test('a 16th subject is refused with the clear message', () => {
  assert.equal(subjectLimitProblem(ids(15), ids(14), nameOf), null)
  assert.equal(subjectLimitProblem(ids(16), ids(15), nameOf), SUBJECT_LIMIT_MESSAGE)
  assert.equal(subjectLimitProblem(ids(16), [], nameOf), SUBJECT_LIMIT_MESSAGE) // a brand-new tutor (import)
})

test('a tutor already over the limit is not trimmed: keep or remove only', () => {
  const twenty = new Set(ids(20).map(String))
  assert.equal(subjectChangeAllowed(twenty, twenty), true) // save other things, set kept
  assert.equal(subjectChangeAllowed(twenty, new Set(ids(18).map(String))), true) // remove
  const swap = new Set([...ids(19).map(String), '25'])
  assert.equal(subjectChangeAllowed(twenty, swap), false) // swap in a new one while over
  assert.equal(subjectLimitProblem(ids(20), ids(20), nameOf), null)
  assert.equal(canAddSubject(new Set(ids(20).map(String)), 'Brand New'), false)
})

test('the banner shows only over the limit and says how many to remove', () => {
  assert.equal(overCapBannerText(SUBJECT_LIMIT), null)
  assert.equal(overCapBannerText(3), null)
  assert.match(overCapBannerText(16) ?? '', /You have 16 subjects\. Please reduce to 15 — remove 1 subject\./)
  assert.match(overCapBannerText(39) ?? '', /remove 24 subjects/)
})

test('every server path that writes a subject set checks the limit before writing', () => {
  for (const p of ['app/api/profile/save/route.ts', 'app/api/tutor/onboarding/route.ts', 'app/api/admin/tutors/edit/route.ts']) {
    assert.match(read(p), /subjectLimitRefusal\(/, p)
  }
  assert.match(read('lib/memberMerge.ts'), /15|SUBJECT_LIMIT/)
})

test('the banner is on the dashboard and in the Settings subject editor', () => {
  assert.match(read('app/(site)/tutor/dashboard/page.tsx'), /<SubjectCapBanner count=\{subjectCount\}/)
  assert.match(read('components/tutor/SubjectLevelEditor.tsx'), /<SubjectCapBanner count=\{keys\.size\}/)
})
