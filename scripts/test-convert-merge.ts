/**
 * scripts/test-convert-merge.ts — hotfix (owner, 27 Oct 2026): "Change to
 * Tutor" never fails silently, a clash names the other account and offers a
 * merge, and a parent account can be merged INTO a tutor account (CNIC,
 * address and tuitions move; exact Undo; blocked when both paid). Pure rules,
 * an in-memory table store, and source scans — nothing touches a database.
 *   npm run test:convertmerge
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

import { convertClashMessage, findConvertClash, mergeInsteadHref, plainDbError } from '../lib/convertAccountCore'
import { maskPhoneDisplay } from '../lib/contactMaskCore'
import { MERGED_LOGIN_MESSAGE, mergeBlock, mergeKind, planMerge, previewLines, suggestKeep, undoOps, type MergeSide, type Op } from '../lib/memberMergeCore'

const read = (p: string) => readFileSync(p, 'utf8')
const NOW = '2026-10-27T10:00:00.000Z'
const PHONE = '923001234567'
const CNIC = '42101-1234567-1'

function side(id: string, over: Partial<MergeSide> = {}): MergeSide {
  return {
    id,
    role: 'tutor',
    name: `Member ${id}`,
    joinedAt: '2026-10-01T00:00:00Z',
    completion: 50,
    phone: null,
    secondaryPhone: null,
    mergedInto: null,
    isStaff: false,
    profile: { full_name: `Member ${id}`, city: null, address: null, whatsapp: null, avatar_url: null, hidden_from_public: false },
    tutor: { headline: null, bio: null, gender: null, experience_years: null, hourly_rate_pkr: null, area: null, city: null, teaching_mode: null, job_types: [], degrees: [], class_levels: [], avatar_url: null },
    docColumns: { cnic_number: null, cnic_image_path: null, verification_state: null, cnic_verified_at: null, profile_pic_status: null, selfie_status: null },
    approvedDocs: [],
    documents: [],
    subjects: [],
    areas: [],
    applications: [],
    applicationFollowUps: [],
    stageEvents: [],
    followUps: [],
    notes: [],
    activity: [],
    jobs: [],
    payments: [],
    subscriptions: [],
    feePaidAt: null,
    credit: null,
    addressColumns: { address: null, address_status: null, address_reason: null, address_reviewed_by: null, address_reviewed_at: null, address_verified_at: null },
    children: [],
    ...over,
  }
}

// ---- Change to Tutor: a clash is a clear message, never "did not save" -----

test('a clash on mobile, CNIC or link names the other account with the phone masked', () => {
  const self = { id: 'p1', phone: PHONE, cnic: CNIC, linkedAccountId: null }
  const tutor = { id: 't1', name: 'Ali Raza', role: 'tutor', phone: '0300 1234567', cnic: null, linkedAccountId: null }
  const mobile = findConvertClash({ ...self, cnic: null }, 'tutor', [tutor], maskPhoneDisplay)!
  assert.equal(mobile.reason, 'mobile')
  assert.equal(mobile.id, 't1')
  const msg = convertClashMessage(mobile, 'tutor')
  assert.match(msg, /already has a Tutor account with the same mobile: Ali Raza \(ID t1/)
  assert.match(msg, /Merge this account into that one/)
  assert.ok(!msg.includes('1234567'), 'the phone is masked in the message')
  assert.equal(findConvertClash(self, 'tutor', [{ ...tutor, phone: null, cnic: '4210112345671' }], maskPhoneDisplay)!.reason, 'cnic')
  assert.equal(findConvertClash({ ...self, phone: null, cnic: null, linkedAccountId: 't1' }, 'tutor', [{ ...tutor, phone: null }], maskPhoneDisplay)!.reason, 'linked')
  // A parent account with the same mobile is not a clash for "to tutor"; nor is a different number.
  assert.equal(findConvertClash(self, 'tutor', [{ ...tutor, role: 'parent' }], maskPhoneDisplay), null)
  assert.equal(findConvertClash(self, 'tutor', [{ ...tutor, phone: '923339999999' }], maskPhoneDisplay), null)
  assert.equal(mergeInsteadHref('p1', 't1'), '/admin/users/merge?a=p1&b=t1')
})

test('Change to Tutor: the tutor profile row carries its NOT NULL email; the clash and the real reason reach the screen', () => {
  const lib = read('lib/convertAccount.ts')
  assert.match(lib, /from\('tutor_profiles'\)\.insert\(\{[\s\S]{0,400}email: \(p\.email as string \| null\) \?\? ''/, 'the insert names email (NOT NULL)')
  assert.match(lib, /const clash = await clashFor\(admin, p, to\)\s*if \(clash\)/, 'checked before any write')
  assert.match(lib, /return failed\('role', roleErr\)/)
  assert.match(lib, /return failed\('tutor_profile', error\)/)
  assert.ok(!/'That did not save\. Please try again\.'/.test(lib), 'no silent "did not save" left')
  const route = read('app/api/admin/members/convert/route.ts')
  assert.match(route, /clash: res\.clash \?\? null/)
  const card = read('components/admin/ConvertAccountCard.tsx')
  assert.match(card, /Merge into that \{to\.toLowerCase\(\)\} account instead/)
  assert.match(card, /!preview\.clash && reason/, 'the change button stays off while there is a clash')
  // Owner only, password re-checked — unchanged.
  assert.match(route, /refuseUnlessOwnerApproval\(gate\.actor, 'change an account type'/)
  assert.match(route, /requireFreshAuth\(gate\.actor\.id\)/)
})

// ---- No phone, CNIC or email in logs ---------------------------------------

test('database errors are logged and shown with every number removed', () => {
  const e = { code: '23505', message: `duplicate key value violates unique constraint "uniq_verified_mobile_per_role" Key (phone)=(${PHONE}) cnic ${CNIC}` }
  const s = plainDbError(e)
  assert.ok(s.startsWith('23505: duplicate key'))
  assert.ok(!s.includes('1234567') && !s.includes('3001234567'), s)
  assert.ok(!/\d{5,}/.test(s.replace(/^23505: /, '')), 'no run of digits after the error code')
  // Every log line in the convert and merge paths goes through plainDbError or carries ids only.
  for (const f of ['lib/convertAccount.ts', 'lib/memberMerge.ts']) {
    for (const line of read(f).split('\n').filter((l) => /console\.(log|warn|error|info)/.test(l))) {
      assert.ok(!/phone|cnic|email|full_name/i.test(line), `${f}: ${line.trim()}`)
    }
  }
  assert.match(read('lib/memberMerge.ts'), /return error \? `\$\{op\.table\}: \$\{plainDbError\(error\)\}` : null/)
})

// ---- Parent → tutor merge ---------------------------------------------------

const parent = (over: Partial<MergeSide> = {}) =>
  side('p', {
    role: 'parent',
    tutor: null,
    phone: '923330000002',
    docColumns: { cnic_number: CNIC, cnic_image_path: 'p/cnic.jpg', verification_state: 'approved', cnic_verified_at: '2026-10-26T11:30:00Z', profile_pic_status: null, selfie_status: null },
    approvedDocs: ['CNIC'],
    documents: [{ id: 'dp1', kind: 'cnic', status: 'active' }, { id: 'dp2', kind: 'cnic', status: 'active' }],
    addressColumns: { address: 'House 1, Ranipur', address_status: 'pending', address_reason: null, address_reviewed_by: null, address_reviewed_at: null, address_verified_at: null },
    jobs: ['job1'],
    children: ['ch1'],
    activity: ['ev1'],
    credit: { member_id: 'p', staff_id: 's1', member_role: 'parent', source: 'link', created_at: '2026-10-26T11:11:00Z' },
    ...over,
  })
const tutor = (over: Partial<MergeSide> = {}) =>
  side('t', { phone: '923000000001', approvedDocs: ['Profile photo', 'Selfie'], documents: [{ id: 'dt1', kind: 'selfie', status: 'active' }], ...over })

test('a parent merges INTO a tutor; the reverse and both-paid are blocked; approved documents on both sides are fine', () => {
  assert.equal(mergeKind(tutor(), parent()), 'parent_into_tutor')
  assert.equal(mergeBlock(tutor(), parent()), null)
  assert.match(mergeBlock(parent(), tutor())!, /Keep the tutor account/)
  assert.equal(suggestKeep(parent(), tutor()), 't', 'the tutor account is always suggested')
  assert.equal(suggestKeep(tutor({ completion: 10 }), parent({ completion: 99 })), 't')
  const paid = { payments: [{ id: 'x', planCode: 'verified', status: 'approved', refunded: false, ref: 'TM-1' }] }
  assert.match(mergeBlock(tutor({ ...paid, feePaidAt: '2026-10-01' }), parent({ payments: [{ id: 'y', planCode: 'parent_featured', status: 'approved', refunded: false, ref: 'TM-2' }] }))!, /Both accounts have paid/)
  assert.equal(mergeBlock(tutor({ feePaidAt: '2026-10-01' }), parent()), null, 'one paid is fine')
})

test('the CNIC, the home address, tuitions and children move; the staff credit becomes a tutor credit', () => {
  const plan = planMerge(tutor(), parent(), NOW)
  const clear = plan.ops.findIndex((o) => o.match.id === 'p' && o.set.cnic_number === null)
  const take = plan.ops.findIndex((o) => o.match.id === 't' && o.set.cnic_number === CNIC)
  assert.ok(clear >= 0 && take > clear, 'the CNIC number is cleared on the parent first (it is unique)')
  assert.equal(plan.ops[take].set.verification_state, 'approved')
  assert.equal(plan.ops[take].set.cnic_verified_at, '2026-10-26T11:30:00Z')
  assert.equal(plan.ops.filter((o) => o.table === 'user_documents' && o.set.user_id === 't').length, 2, 'both CNIC photos')
  assert.ok(!plan.ops.some((o) => o.table === 'user_documents' && o.match.id === 'dt1'), "the tutor's selfie is untouched")
  const addr = plan.ops.find((o) => o.label === 'Home address')!
  assert.equal(addr.set.address, 'House 1, Ranipur')
  assert.equal(addr.set.address_status, 'pending')
  assert.ok(plan.ops.some((o) => o.table === 'jobs' && o.match.id === 'job1' && o.set.parent_id === 't'))
  assert.ok(plan.ops.some((o) => o.table === 'children' && o.match.id === 'ch1' && o.set.parent_id === 't'))
  const credit = plan.ops.find((o) => o.table === 'staff_signup_credits')!
  assert.deepEqual(credit.set, { member_id: 't', member_role: 'tutor' })
  const lines = previewLines(plan)
  assert.ok(lines.some((l) => l.startsWith('The CNIC moves')))
  assert.ok(lines.some((l) => l.startsWith('The home address moves')))
  assert.ok(lines.some((l) => l.includes('posted as a parent')))
  // Tuitions owned by a tutor account read "posted as a parent" (derived, no column).
  assert.match(read('lib/convertAccountCore.ts'), /export function postedAsParent\(ownerRole[\s\S]{0,80}return ownerRole === 'tutor'/)
  // The last op: "Merged into", hidden; signing in says "Please use your other account".
  assert.deepEqual(plan.ops[plan.ops.length - 1].set, { merged_into: 't', merged_at: NOW, hidden_from_public: true })
  assert.match(MERGED_LOGIN_MESSAGE, /^Please use your other account/)
})

test('a tutor with an approved CNIC or address keeps its own; a pending tutor CNIC steps aside for an approved one', () => {
  const keepApproved = planMerge(tutor({ approvedDocs: ['CNIC'], docColumns: { ...side('t').docColumns, cnic_number: '35202-7654321-9', verification_state: 'approved' } }), parent(), NOW)
  assert.equal(keepApproved.report.cnicMoved, undefined)
  assert.ok(!keepApproved.ops.some((o) => o.match.id === 'p' && 'cnic_number' in o.set))
  const addrApproved = planMerge(tutor({ addressColumns: { ...side('t').addressColumns, address: 'Old', address_verified_at: '2026-10-01' } }), parent(), NOW)
  assert.equal(addrApproved.report.addressMoved, undefined)
  const pending = planMerge(tutor({ documents: [{ id: 'dt2', kind: 'cnic', status: 'active' }] }), parent(), NOW)
  assert.ok(pending.ops.some((o) => o.table === 'user_documents' && o.match.id === 'dt2' && o.set.status === 'paused'))
})

test('Undo restores every row exactly', () => {
  type Row = Record<string, unknown>
  const db: Record<string, Row[]> = {
    profiles: [
      { id: 't', full_name: 'Tutor', city: 'Karachi', whatsapp: null, avatar_url: null, cnic_number: null, cnic_image_path: null, verification_state: null, cnic_verified_at: null,
        address: null, address_status: null, address_reason: null, address_reviewed_by: null, address_reviewed_at: null, address_verified_at: null, secondary_phone: null, merged_into: null, merged_at: null, hidden_from_public: false },
      { id: 'p', full_name: 'Parent', city: 'Ranipur', whatsapp: '923330000002', cnic_number: CNIC, merged_into: null, merged_at: null, hidden_from_public: false },
    ],
    user_documents: [{ id: 'dp1', user_id: 'p', status: 'active' }, { id: 'dp2', user_id: 'p', status: 'active' }, { id: 'dt1', user_id: 't', status: 'active' }],
    jobs: [{ id: 'job1', parent_id: 'p' }],
    children: [{ id: 'ch1', parent_id: 'p' }],
    user_activity_log: [{ id: 'ev1', user_id: 'p' }],
    staff_signup_credits: [{ member_id: 'p', staff_id: 's1', member_role: 'parent' }],
  }
  const snapshot = JSON.stringify(db)
  const apply = (ops: Op[]) => {
    for (const op of ops) {
      const rows = (db[op.table] ?? []).filter((r) => Object.entries(op.match).every(([k, v]) => r[k] === v))
      assert.ok(rows.length > 0, `${op.table} ${JSON.stringify(op.match)} matched no row`)
      for (const r of rows) Object.assign(r, op.set)
    }
  }
  const t = tutor({ profile: { ...side('t').profile, full_name: 'Tutor', city: 'Karachi' } })
  const p = parent({ profile: { ...side('p').profile, full_name: 'Parent', city: 'Ranipur', whatsapp: '923330000002' } })
  const plan = planMerge(t, p, NOW)
  apply(plan.ops)
  assert.equal(db.profiles[0].cnic_number, CNIC)
  assert.equal(db.profiles[0].address, 'House 1, Ranipur')
  assert.equal(db.profiles[0].whatsapp, '923330000002')
  assert.equal(db.profiles[1].merged_into, 't')
  assert.equal(db.jobs[0].parent_id, 't')
  assert.equal(db.staff_signup_credits[0].member_role, 'tutor')
  apply(undoOps(plan.ops))
  assert.equal(JSON.stringify(db), snapshot, 'every row is back exactly')
})

test('merge stays owner only with the password re-check, logged on both accounts', () => {
  const route = read('app/api/admin/members/merge/route.ts')
  assert.match(route, /refuseUnlessOwnerApproval\(gate\.actor/)
  assert.match(route, /requireFreshAuth\(gate\.actor\.id\)/)
  const lib = read('lib/memberMerge.ts')
  assert.match(lib, /ids\(admin, 'children', 'parent_id', memberId\)/)
  assert.match(lib, /addressColumns: Object\.fromEntries\(ADDRESS_COLUMNS/)
  assert.match(lib, /\[kept\.id, 'kept'\],\s*\[merged\.id, 'merged'\]/)
})
