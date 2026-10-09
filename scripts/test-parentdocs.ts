/**
 * scripts/test-parentdocs.ts  —  npm run test:parentdocs
 *
 * Parent document review (owner, 8 Oct 2026): the per-item rules (CNIC + typed
 * address), "verified = both approved", the queue's waiting set, the parent's
 * own page state, who may see documents (Tuitions staff never), and the
 * server wiring (roles, reason required, audit, notify, email). Pure logic +
 * source scans. No browser/DB/network.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

import {
  parentCnicState,
  parentAddressState,
  parentWaiting,
  parentVerified,
  canApproveParentItem,
  parentDecisionPatch,
  parentShownState,
  PARENT_REJECT_PRESETS,
} from '../lib/parentDocsCore'
import { isDocumentStaff, documentServable } from '../lib/documentAccess'
import { SCREEN_ACCESS, roleSatisfies } from '../lib/adminAccessCore'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const read = (p: string) => readFileSync(join(ROOT, p), 'utf8')

const base = { hasCnicFront: true, hasCnicBack: true }

test('a submitted CNIC with both sides is waiting; an empty address is not', () => {
  const f = { ...base, verification_state: 'submitted', address: '' }
  assert.equal(parentCnicState(f).status, 'pending')
  assert.equal(parentAddressState(f).status, 'none')
  assert.deepEqual(parentWaiting(f), ['CNIC'])
})

test('a typed address on a submitted parent is waiting', () => {
  const f = { ...base, verification_state: 'submitted', address: 'House 1, Street 2, Model Town' }
  assert.deepEqual(parentWaiting(f), ['CNIC', 'Address'])
  assert.equal(
    parentAddressState({ ...f, address_status: 'pending', verification_state: 'approved', cnic_verified_at: 'x' }).status,
    'pending',
  )
})

test('verified only when BOTH are approved', () => {
  assert.equal(parentVerified({ cnic_verified_at: 'x', address_verified_at: null }), false)
  assert.equal(parentVerified({ cnic_verified_at: 'x', address_verified_at: 'y' }), true)
})

test('approve is refused over a missing file or empty address', () => {
  // One side is enough to approve (owner, 9 Oct 2026); no side is not.
  assert.equal(canApproveParentItem('cnic', { hasCnicFront: true, hasCnicBack: false }), true)
  assert.equal(canApproveParentItem('cnic', { hasCnicFront: false, hasCnicBack: true }), true)
  assert.equal(canApproveParentItem('cnic', { hasCnicFront: false, hasCnicBack: false }), false)
  assert.equal(canApproveParentItem('cnic', base), true)
  assert.equal(canApproveParentItem('address', { ...base, address: '  ' }), false)
  assert.equal(canApproveParentItem('address', { ...base, address: 'Gulberg' }), true)
})

test('decision patches touch only their own item', () => {
  const now = '2026-10-08T00:00:00Z'
  assert.deepEqual(parentDecisionPatch('cnic', 'approve', '', now), {
    verification_state: 'approved',
    verification_rejection_reason: null,
    cnic_verified_at: now,
  })
  assert.deepEqual(parentDecisionPatch('address', 'reject', ' Incomplete. ', now), {
    address_status: 'rejected',
    address_reason: 'Incomplete.',
    address_verified_at: null,
  })
})

test('a rejected address with an approved CNIC is not verified and shows its reason', () => {
  const f = {
    ...base,
    verification_state: 'approved',
    cnic_verified_at: 'x',
    address: 'a',
    address_status: 'rejected',
    address_reason: 'Incomplete.',
  }
  assert.equal(parentAddressState(f).status, 'rejected')
  assert.equal(parentAddressState(f).reason, 'Incomplete.')
  assert.deepEqual(parentWaiting(f), [])
  const shown = parentShownState({
    verification_state: 'approved',
    cnic_verified_at: 'x',
    address_verified_at: null,
    address_status: 'rejected',
    verification_rejection_reason: null,
    address_reason: 'Incomplete.',
  })
  assert.equal(shown.state, 'rejected')
  assert.match(shown.reason ?? '', /Address: Incomplete\./)
})

test('the parent page says approved only when both are approved', () => {
  const half = parentShownState({
    verification_state: 'approved',
    cnic_verified_at: 'x',
    address_verified_at: null,
    address_status: 'pending',
    verification_rejection_reason: null,
    address_reason: null,
  })
  assert.equal(half.state, 'submitted')
  const both = parentShownState({
    verification_state: 'approved',
    cnic_verified_at: 'x',
    address_verified_at: 'y',
    address_status: 'approved',
    verification_rejection_reason: null,
    address_reason: null,
  })
  assert.equal(both.state, 'approved')
})

test('reject reasons: a short list per item, plus Other (free text)', () => {
  assert.ok(PARENT_REJECT_PRESETS.cnic.length >= 3)
  assert.ok(PARENT_REJECT_PRESETS.address.length >= 2)
  const ui = read('components/admin/ParentDocumentReview.tsx')
  assert.match(ui, />\s*Other\s*</)
  assert.match(ui, /<textarea/)
  const wa = ui.slice(ui.indexOf('const whatsappHref'), ui.indexOf('const act'))
  assert.ok(!/cnicNumber/.test(wa), 'no CNIC number in the WhatsApp message')
  assert.match(wa, /wa\.me\/\$\{waMsisdn\}\?text=/)
})

test('roles: owner/admin/operations review; Partner view-only; Tuitions staff never', () => {
  for (const r of ['owner', 'admin', 'operations'] as const) assert.ok(roleSatisfies(r, SCREEN_ACCESS.parents), r)
  assert.equal(roleSatisfies('tuitions_staff', SCREEN_ACCESS.parents), false)
  assert.equal(roleSatisfies('tuitions_staff', SCREEN_ACCESS.users), false)
  assert.equal(isDocumentStaff({ role: 'admin', admin_role: 'tuitions_staff' }), false)
  assert.equal(isDocumentStaff({ role: 'admin', admin_role: 'partner' }), true)
  assert.equal(isDocumentStaff({ role: 'admin', admin_role: 'operations', is_suspended: true }), false)
  assert.equal(isDocumentStaff({ role: 'parent', admin_role: null }), false)
  assert.equal(
    documentServable('cnic', { isOwner: false, isAdmin: isDocumentStaff({ role: 'admin', admin_role: 'tuitions_staff' }) }),
    false,
  )
  const route = read('app/api/admin/parents/document-review/route.ts')
  assert.match(route, /checkAdminRole\(\.\.\.SCREEN_ACCESS\.parents\)/, 'Partner writes are refused by checkAdminRole')
  assert.match(read('app/api/documents/[id]/preview/route.ts'), /isDocumentStaff\(me\)/)
})

test('server: reason required, audit + timeline + notify + email on every decision', () => {
  const lib = read('lib/parentDocuments.ts')
  assert.match(lib, /decision === 'reject' && reason\.length < 3[^]*A reason is required/)
  assert.match(lib, /logAdminAction\(/)
  assert.match(lib, /parent\.verify\.approve/)
  assert.match(lib, /logActivity\(/)
  assert.match(lib, /id: 'verification_rejected'[^]*audience: 'parent'/)
  assert.match(lib, /verified && !before\.verified[^]*You are verified/)
})

test('one list: Overview row, People badge and Parents queue share parentsAwaitingReview', () => {
  assert.match(read('lib/approvalQueue.ts'), /parentsAwaitingReview\(\)/)
  assert.match(read('lib/adminQueues.ts'), /filter === 'submitted'[^]*parentsAwaitingReview\(\)/)
  assert.match(read('lib/overviewItems.ts'), /case 'todo-docs'[^]*approvalNeeded\(\)/)
  const page = read('app/admin/users/[id]/page.tsx')
  assert.match(page, /href=\{parentDocs \|\| tutorDocs \? '#documents'/)
  assert.match(page, /id="documents"/)
})
