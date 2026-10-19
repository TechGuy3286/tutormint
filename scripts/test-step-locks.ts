/**
 * scripts/test-step-locks.ts — npm run test:steplocks
 * Only documents lock (owner, 19 Oct 2026): the CNIC (front, back, number), the
 * profile picture and the selfie, once approved. Subjects, where you teach and
 * every other step stay editable. Pure rules plus source scans; the database
 * behaviour for a real Step-1-complete tutor is proven by the rolled-back probe
 * in scripts/apply-migration-187.ts (city, areas, subjects, headline, fee save;
 * CNIC number and approved photo refused).
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'

import { refusedNewSubjects, notMasterSubjects } from '../lib/subjectDisplay'
import { uploadDecision, photoUploadDecision, LOCKED_ERROR } from '../lib/docLockCore'
import { SettingsTile, APPROVED_LOCK_LABEL } from '../components/tutor/SettingsPieces'

const read = (p: string) => readFileSync(p, 'utf8')
const SETTINGS = 'app/(site)/tutor/dashboard/settings/page.tsx'

/** Each Settings card's own source block, keyed by its `key:`. */
function cardBlocks(src: string): Map<string, string> {
  const out = new Map<string, string>()
  const re = /\n\s+key: '([a-zA-Z]+)',/g
  const hits = [...src.matchAll(re)]
  hits.forEach((m, i) => out.set(m[1], src.slice(m.index!, hits[i + 1]?.index ?? src.length)))
  return out
}

test('subjects and areas save for a verified tutor with approved CNIC, photo and selfie', () => {
  const m = read('supabase/migrations/187_unlock_city_areas.sql')
  assert.match(m, /drop trigger if exists lock_tutor_areas on public\.tutor_areas;/)
  // The city checks are gone from both lock functions; nothing calls tutor_step1_complete.
  const code = m.replace(/^--.*$/gm, '')
  assert.doesNotMatch(code, /tutor_step1_complete/)
  assert.doesNotMatch(code, /city IS DISTINCT FROM|city is distinct from/i)
  // The subjects lock was removed in 134 and is not brought back.
  assert.match(read('supabase/migrations/134_unlock_tutor_subjects.sql'), /DROP TRIGGER IF EXISTS lock_tutor_subjects ON public\.tutor_subjects;/)
  // The Settings cards no longer lock after Step 1.
  const src = read(SETTINGS)
  assert.doesNotMatch(src, /step1Complete/)
  const cards = cardBlocks(src)
  for (const key of ['subjects', 'location', 'jobType', 'availability', 'degrees', 'certifications', 'experience', 'monthlyFee', 'fee', 'email', 'details', 'mobile']) {
    const block = cards.get(key)
    assert.ok(block, `${key} card exists`)
    assert.doesNotMatch(block!, /\n\s+locked:/, `${key} card must not lock`)
  }
  assert.ok(cards.has('subjects') && cards.has('location'))
})

test('a CNIC, photo or selfie save is refused without an unlock', () => {
  assert.deepEqual(uploadDecision({ kind: 'cnic', part: 'front', approved: true, partOnRecord: true, unlock: null }), { allow: false, status: 403, error: LOCKED_ERROR })
  assert.deepEqual(uploadDecision({ kind: 'cnic', part: 'back', approved: true, partOnRecord: true, unlock: null }), { allow: false, status: 403, error: LOCKED_ERROR })
  assert.deepEqual(uploadDecision({ kind: 'selfie', part: 'selfie', approved: true, partOnRecord: true, unlock: null }), { allow: false, status: 403, error: LOCKED_ERROR })
  assert.deepEqual(photoUploadDecision({ approved: true, onRecord: true, unlockOpen: false }), { allow: false, status: 403, error: LOCKED_ERROR })
  const m = read('supabase/migrations/187_unlock_city_areas.sql')
  // The CNIC number and the approved photo are still refused by the database.
  assert.match(m, /AND NEW\.cnic_number IS DISTINCT FROM OLD\.cnic_number THEN/)
  assert.equal((m.match(/tm_photo_change_refused\((OLD|old)\.id\)/g) ?? []).length, 2)
  // The mobile (once OTP-verified) is unchanged: changed through support.
  assert.match(m, /OLD\.phone_verified_at IS NOT NULL AND NEW\.phone_number IS DISTINCT FROM OLD\.phone_number/)
})

test('an old non-list subject does not block a save; a new one is refused', () => {
  const master = [1, 2, 3]
  // 77 is a value saved earlier that is not on the master list: kept, not refused.
  assert.deepEqual(refusedNewSubjects([1, 2, 77], [1, 77], master), [])
  // 88 is newly added and not on the list: refused.
  assert.deepEqual(refusedNewSubjects([1, 77, 88], [1, 77], master), [88])
  assert.deepEqual(notMasterSubjects([1, 77], master), [77])
  const save = read('app/api/profile/save/route.ts')
  assert.match(save, /unknownNewMasterIds\(supabase, ids, savedIds\)/)
  assert.match(read('app/api/admin/tutors/edit/route.ts'), /unknownNewMasterIds\(admin, ids, oldIds\)/)
})

test('the dashboard shows a lock only on document cards, as "Approved 🔒"', () => {
  const cards = cardBlocks(read(SETTINGS))
  const locked = [...cards.entries()].filter(([, b]) => /\n\s+locked:/.test(b)).map(([k]) => k).sort()
  assert.deepEqual(locked, ['cnic', 'selfie'])
  // The approved photo keeps its card open (the Hide my photo toggle) with the label.
  assert.match(cards.get('profilePic') ?? '', /approvedLock: photoLocked,/)
  assert.match(read(SETTINGS), /const photoLocked = photoView === 'locked';/)
  // A locked tile reads "Approved 🔒" — the word "Locked" is gone from the tiles.
  const tile = renderToStaticMarkup(createElement(SettingsTile, { cardKey: 'selfie', status: 'completed', icon: null, open: false, onClick: () => {}, locked: true }))
  assert.match(tile, new RegExp(APPROVED_LOCK_LABEL))
  assert.doesNotMatch(tile, />Locked</)
  const open = renderToStaticMarkup(createElement(SettingsTile, { cardKey: 'subjects', status: 'completed', icon: null, open: false, onClick: () => {} }))
  assert.doesNotMatch(open, /Approved 🔒|Locked/)
  assert.doesNotMatch(read('components/tutor/SettingsPieces.tsx'), /'Locked'/)
})
