// npm run test:whatsappformer — the admin Edit tab's WhatsApp number, and
// "Remove from team" making former staff (owner, 4 Nov 2026). Invented data only.
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

import { maskWhatsapp, whatsappEditDecision, WHATSAPP_INVALID, WHATSAPP_REASON_NEEDED } from '../lib/whatsappEditCore'
import { editTabParts } from '../lib/memberEditCore'
import { roleMayWrite, roleSatisfies, SCREEN_ACCESS, type AdminRole } from '../lib/adminAccessCore'
import { numberHash, postingRefusal, DO_NOT_USE_MESSAGE, HOLD_MESSAGE } from '../lib/contactWithdrawCore'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const read = (p: string) => readFileSync(join(ROOT, p), 'utf8')

// ---------------------------------------------------------------- Part A ---

test('allowed roles: Backend Support and Managers may edit; Tuitions staff may not', () => {
  const may = (r: AdminRole) => roleSatisfies(r, SCREEN_ACCESS.memberWhatsappEdit) && roleMayWrite(r, SCREEN_ACCESS.memberWhatsappEdit)
  for (const r of ['owner', 'admin', 'operations', 'supervisor', 'backend_support', 'partner'] as AdminRole[]) assert.ok(may(r), r)
  assert.equal(may('tuitions_staff'), false)
})

test('the Edit tab shows the WhatsApp section for tutors and parents', () => {
  assert.deepEqual(editTabParts('backend_support', 'tutor'), { tutorFields: false, whatsapp: true, show: true })
  assert.deepEqual(editTabParts('backend_support', 'parent'), { tutorFields: false, whatsapp: true, show: true })
  assert.deepEqual(editTabParts('admin', 'tutor'), { tutorFields: true, whatsapp: true, show: true })
  assert.deepEqual(editTabParts('admin', 'parent'), { tutorFields: false, whatsapp: true, show: true })
  assert.equal(editTabParts('tuitions_staff', 'tutor').show, false)
  assert.equal(editTabParts('admin', 'admin').show, false)
})

test('a reason is required', () => {
  assert.deepEqual(whatsappEditDecision({ targetRole: 'tutor', raw: '0300 1112223', reason: ' a ', current: null }), { ok: false, status: 400, error: WHATSAPP_REASON_NEEDED })
})

test('any common format is saved normalised; bad numbers refused', () => {
  for (const raw of ['0300 1112223', '0300-1112223', '+92 300 1112223', '923001112223']) {
    const d = whatsappEditDecision({ targetRole: 'parent', raw, reason: 'Parent asked', current: null })
    assert.deepEqual(d, { ok: true, msisdn: '923001112223', unchanged: false }, raw)
  }
  assert.deepEqual(whatsappEditDecision({ targetRole: 'tutor', raw: '12345', reason: 'Parent asked', current: null }), { ok: false, status: 400, error: WHATSAPP_INVALID })
  assert.equal(whatsappEditDecision({ targetRole: 'admin', raw: '03001112223', reason: 'xyz', current: null }).ok, false)
})

test('the same number again is a no-op', () => {
  const d = whatsappEditDecision({ targetRole: 'tutor', raw: '0300 1112223', reason: 'check', current: '923001112223' })
  assert.deepEqual(d, { ok: true, msisdn: '923001112223', unchanged: true })
})

test('Do not use and On hold numbers are refused', () => {
  const n = '923001112223'
  assert.equal(postingRefusal([n], new Set([numberHash(n)]), new Set()), DO_NOT_USE_MESSAGE)
  assert.equal(postingRefusal([n], new Set(), new Set([numberHash(n)])), HOLD_MESSAGE)
  assert.equal(postingRefusal([n], new Set(), new Set()), null)
})

test('the number is masked in history, Audit and the timeline', () => {
  assert.equal(maskWhatsapp('923001112223'), '0300 •••• 223')
  assert.equal(maskWhatsapp(null), null)
})

test('the route: gate, reason, Do not use check, logged masked, mobile untouched', () => {
  const s = read('app/api/admin/members/whatsapp/route.ts')
  assert.match(s, /checkAdminRole\(\.\.\.SCREEN_ACCESS\.memberWhatsappEdit\)/)
  assert.match(s, /roleMayWrite\(gate\.actor\.adminRole, SCREEN_ACCESS\.memberWhatsappEdit\)/)
  assert.match(s, /refuseOwnerTarget/)
  assert.match(s, /doNotUseRefusal\(\[decision\.msisdn\]\)/)
  assert.match(s, /update\(\{ whatsapp: decision\.msisdn \}\)/)
  assert.doesNotMatch(s, /phone_number\s*:/, 'the sign-in mobile is never written')
  assert.match(s, /field: 'whatsapp'/)
  assert.match(s, /action: 'member\.whatsapp_edit'/)
  assert.match(s, /targetType: 'profile'/, 'rebuilds the cached tutor profile')
  assert.match(s, /logActivity\(/)
  assert.match(s, /detail: \{ from, to, reason/, 'Audit carries masked values only')
  // Doing the refusal BEFORE the write.
  assert.ok(s.indexOf('doNotUseRefusal([') < s.indexOf(".update({ whatsapp"))
})

test('the form shows the current number masked with the logged Show', () => {
  const s = read('components/admin/WhatsAppEditForm.tsx')
  assert.match(s, /<MaskedContact memberId=\{memberId\} field="whatsapp"/)
  assert.match(s, /Reason for this change/)
})

// ---------------------------------------------------------------- Part B ---

test('Remove from team runs the former-staff flow', () => {
  const s = read('app/api/admin/team/route.ts')
  const remove = s.slice(s.indexOf("if (body.action === 'remove')"))
  assert.match(remove, /makeFormerStaff\(actor, userId, reason \|\| 'Removed from team'\)/)
  assert.doesNotMatch(remove, /\.update\(\{\s*admin_role: null/, 'no bare role revoke left')
})

test('makeFormerStaff records the left date (backfill date allowed) and deactivates the join link', () => {
  const s = read('lib/formerStaff.ts')
  assert.match(s, /opts: \{ at\?: string \} = \{\}/)
  assert.match(s, /const now = opts\.at \?\? new Date\(\)\.toISOString\(\)/)
  assert.match(s, /former_staff_at: \(p\.former_staff_at as string \| null\) \?\? now/)
  assert.match(s, /staff_join_links'\)\.update\(\{ deactivated_at: now \}\)/)
  assert.match(s, /action: 'staff\.former'/)
  assert.match(s, /targetRole === 'owner'/, 'the Owner is never changed')
})
