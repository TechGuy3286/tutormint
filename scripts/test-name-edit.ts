// npm run test:nameedit — staff edit of a member's name (owner, 27 Oct 2026).
// Invented data only.
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

import {
  cleanName,
  nameEditDecision,
  nameOwnerOnly,
  nameProblem,
  OWNER_ONLY_NAME,
  NAME_REASON_NEEDED,
  VERIFIED_NAME_HINT,
} from '../lib/nameEditCore'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const read = (p: string) => readFileSync(join(ROOT, p), 'utf8')

const tutor = { role: 'tutor', cnicVerifiedAt: null, fullName: 'zara khan' }
const verifiedTutor = { role: 'tutor', cnicVerifiedAt: '2026-10-01T00:00:00Z', fullName: 'Zara Khan' }
const parent = { role: 'parent', cnicVerifiedAt: '2026-10-01T00:00:00Z', fullName: 'Hina Malik' }

test('names are stored through formatName, spaces tidied', () => {
  assert.equal(cleanName('  aMNA   bibi  '), 'Amna Bibi')
  assert.equal(cleanName("o'neil al-rashid"), "O'Neil Al-Rashid")
})

test('a name must be real words', () => {
  assert.equal(nameProblem('A'), 'Enter the full name.')
  assert.match(nameProblem('Zara 123') ?? '', /letters/)
  assert.match(nameProblem('zara@x.com') ?? '', /letters/)
  assert.equal(nameProblem('Zara Khan'), null)
})

test('a reason is required', () => {
  const d = nameEditDecision({ actorRole: 'admin', target: tutor, name: 'Zara Noor', reason: ' x ' })
  assert.deepEqual(d, { ok: false, status: 400, error: NAME_REASON_NEEDED })
})

test('staff may change an unverified tutor or any parent', () => {
  const t = nameEditDecision({ actorRole: 'operations', target: tutor, name: 'zara noor', reason: 'Typo at signup' })
  assert.deepEqual(t, { ok: true, name: 'Zara Noor', unchanged: false })
  const p = nameEditDecision({ actorRole: 'admin', target: parent, name: 'Hina Malik Khan', reason: 'Parent asked' })
  assert.equal(p.ok, true)
  assert.equal(nameOwnerOnly({ role: 'parent', cnicVerifiedAt: 'x' }), false)
})

test('a verified tutor (CNIC approved) is the Owner’s to rename', () => {
  assert.equal(nameOwnerOnly(verifiedTutor), true)
  for (const role of ['admin', 'operations', 'partner', 'supervisor', 'tuitions_staff']) {
    const d = nameEditDecision({ actorRole: role, target: verifiedTutor, name: 'Zara Noor', reason: 'Spelling' })
    assert.deepEqual(d, { ok: false, status: 403, error: OWNER_ONLY_NAME }, role)
  }
  const o = nameEditDecision({ actorRole: 'owner', target: verifiedTutor, name: 'Zara Noor', reason: 'Matches CNIC' })
  assert.equal(o.ok, true)
})

test('the same name is a no-op, a staff account is refused', () => {
  const same = nameEditDecision({ actorRole: 'owner', target: verifiedTutor, name: 'zara  khan', reason: 'check' })
  assert.deepEqual(same, { ok: true, name: 'Zara Khan', unchanged: true })
  const staff = nameEditDecision({ actorRole: 'owner', target: { role: 'admin', cnicVerifiedAt: null, fullName: 'X' }, name: 'Y Z', reason: 'abc' })
  assert.equal(staff.ok, false)
})

test('route: reason, owner-only, history, audit, timeline', () => {
  const r = read('app/api/admin/members/name/route.ts')
  assert.match(r, /nameEditDecision/)
  assert.match(r, /refuseOwnerTarget/)
  assert.match(r, /recordFieldChanges\([\s\S]*field: 'name'/)
  assert.match(r, /action: 'member\.name_edit'/)
  assert.match(r, /logActivity\(/)
  assert.match(r, /alertOwnerBlocked/)
})

test('UI: Name section on the tutor editor, Edit name on the parent page, the hint, the address prompt', () => {
  const editor = read('app/admin/tutors/[id]/TutorFieldEditor.tsx')
  assert.match(editor, /title="Name"/)
  assert.match(editor, /<NameEditForm/)
  assert.match(editor, /afterSave=\{<SlugField/)
  assert.match(read('app/admin/users/[id]/page.tsx'), /Edit name[\s\S]*<NameEditForm/)
  const form = read('components/admin/NameEditForm.tsx')
  assert.match(form, /VERIFIED_NAME_HINT/)
  assert.match(form, /Save address/)
  assert.equal(VERIFIED_NAME_HINT, 'Check the spelling against the approved CNIC')
  assert.match(read('app/admin/tutors/[id]/TutorFieldHistory.tsx'), /name: 'Name'/)
})
