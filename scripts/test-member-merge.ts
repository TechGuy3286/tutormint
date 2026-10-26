/**
 * scripts/test-member-merge.ts — merging duplicate accounts and "Not a
 * duplicate" (owner, 26 Oct 2026). Pure rules on invented accounts, an
 * in-memory table store to prove Undo is exact, and source scans.
 *   npm run test:membermerge
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

import { mergeBlock, MERGED_LOGIN_MESSAGE, planMerge, previewLines, suggestKeep, undoOps, type MergeSide, type Op } from '../lib/memberMergeCore'
import { openPairs, pairId, withoutDismissed } from '../lib/memberDuplicatesCore'
import { mergedTutorRedirectPath } from '../lib/mergedTutorRedirect'

const read = (p: string) => readFileSync(p, 'utf8')

function side(id: string, over: Partial<MergeSide> = {}): MergeSide {
  return {
    id,
    role: 'tutor',
    name: `Tutor ${id}`,
    joinedAt: '2026-10-01T00:00:00Z',
    completion: 50,
    phone: null,
    secondaryPhone: null,
    mergedInto: null,
    isStaff: false,
    profile: { full_name: `Tutor ${id}`, city: null, address: null, whatsapp: null, avatar_url: null, hidden_from_public: false },
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
    ...over,
  }
}

const NOW = '2026-10-26T10:00:00.000Z'

test('field rules: the kept value wins; an empty one takes the other', () => {
  const keep = side('k', { tutor: { ...side('k').tutor!, headline: 'Kept headline', bio: null } })
  const other = side('o', { tutor: { ...side('o').tutor!, headline: 'Other headline', bio: 'Other bio', degrees: ['BSc'] } })
  const plan = planMerge(keep, other, NOW)
  const fill = plan.ops.find((o) => o.table === 'tutor_profiles' && o.match.id === 'k' && 'bio' in o.set)!
  assert.equal(fill.set.bio, 'Other bio')
  assert.deepEqual(fill.set.degrees, ['BSc'])
  assert.ok(!('headline' in fill.set), 'the kept headline stays')
})

test('subjects combine within the 15-subject cap; the rest are listed', () => {
  const subjects = (n: number, from = 0) => Array.from({ length: n }, (_, i) => ({ masterId: 1000 + from + i, subject: `Subject ${from + i}` }))
  const keep = side('k', { subjects: subjects(14) })
  const other = side('o', { subjects: [...subjects(1, 0), ...subjects(3, 20)] })
  const plan = planMerge(keep, other, NOW)
  const moved = plan.ops.filter((o) => o.table === 'tutor_subjects')
  assert.equal(moved.length, 1, 'one new subject fits (14 → 15); the shared one is not moved twice')
  assert.deepEqual(plan.report.subjectsLeftOut, ['Subject 21', 'Subject 22'])
  assert.ok(previewLines(plan).some((l) => l.includes('Subject 21')))
})

test('blocks: different types, both paid, both with approved documents', () => {
  const paid = { payments: [{ id: 'p', planCode: 'verified', status: 'approved', refunded: false, ref: 'TM-X' }] }
  assert.match(mergeBlock(side('a', paid), side('b', paid))!, /Both accounts have paid/)
  assert.match(mergeBlock(side('a', { approvedDocs: ['CNIC'] }), side('b', { approvedDocs: ['Selfie'] }))!, /approved documents/)
  assert.match(mergeBlock(side('a'), side('b', { role: 'parent' }))!, /same type/)
  assert.match(mergeBlock(side('a'), side('b', { mergedInto: 'x' }))!, /already merged/)
  assert.match(mergeBlock(side('a', { isStaff: true }), side('b'))!, /staff/)
  assert.equal(mergeBlock(side('a', paid), side('b')), null, 'one paid is fine')
  assert.equal(mergeBlock(side('a', { role: 'academy' }), side('b', { role: 'parent' })), null, 'an academy is a parent account')
})

test('payments move only when only the other account paid — shown clearly', () => {
  const other = side('o', { payments: [{ id: 'p1', planCode: 'verified', status: 'approved', refunded: false, ref: 'TM-123' }], feePaidAt: '2026-10-02T00:00:00Z' })
  const plan = planMerge(side('k'), other, NOW)
  assert.ok(plan.ops.some((o) => o.table === 'payments' && o.match.id === 'p1' && o.set.user_id === 'k'))
  assert.ok(plan.ops.some((o) => o.table === 'tutor_profiles' && o.set.verified_fee_paid_at === '2026-10-02T00:00:00Z'))
  assert.ok(previewLines(plan).some((l) => l.startsWith('PAYMENT MOVES: Verification Fee (TM-123)')))
  const keepPaid = planMerge(side('k', { feePaidAt: '2026-10-01T00:00:00Z' }), side('o'), NOW)
  assert.ok(!keepPaid.ops.some((o) => o.table === 'payments'))
})

test('documents move only when the kept account has none, or none approved', () => {
  const other = side('o', { documents: [{ id: 'd1', kind: 'cnic' }], docColumns: { ...side('o').docColumns, cnic_number: '00000-0000000-0', verification_state: 'approved' } })
  const plan = planMerge(side('k'), other, NOW)
  assert.equal(plan.report.documentsMoved, true)
  // The CNIC number is cleared on the other account BEFORE the kept one takes it (it is unique).
  const clear = plan.ops.findIndex((o) => o.match.id === 'o' && o.set.cnic_number === null)
  const take = plan.ops.findIndex((o) => o.match.id === 'k' && o.set.cnic_number === '00000-0000000-0')
  assert.ok(clear >= 0 && take > clear)
  const keepApproved = planMerge(side('k', { documents: [{ id: 'd0', kind: 'cnic' }], approvedDocs: ['CNIC'] }), other, NOW)
  assert.equal(keepApproved.report.documentsMoved, false)
  const keepPending = planMerge(side('k', { documents: [{ id: 'd0', kind: 'cnic' }] }), other, NOW)
  assert.equal(keepPending.report.documentsMoved, true)
})

test('applications, follow-ups, notes, timeline and staff credit move; the earliest credit wins', () => {
  const keep = side('k', { applications: [{ id: 'a0', jobId: 'job1' }], credit: { member_id: 'k', staff_id: 's2', source: 'link', created_at: '2026-10-05T00:00:00Z' } })
  const other = side('o', {
    applications: [{ id: 'a1', jobId: 'job1' }, { id: 'a2', jobId: 'job2' }],
    applicationFollowUps: [{ id: 'f1', applicationId: 'a2' }],
    followUps: ['m1'],
    notes: ['n1'],
    activity: ['t1', 't2'],
    credit: { member_id: 'o', staff_id: 's1', source: 'code', created_at: '2026-10-03T00:00:00Z' },
  })
  const plan = planMerge(keep, other, NOW)
  assert.deepEqual(plan.report.applicationsLeft, ['a1'], 'both applied to job1: that one stays')
  assert.ok(plan.ops.some((o) => o.table === 'applications' && o.match.id === 'a2'))
  assert.ok(plan.ops.some((o) => o.table === 'application_follow_ups' && o.match.id === 'f1'))
  assert.ok(plan.ops.some((o) => o.table === 'member_notes' && o.match.id === 'n1'))
  assert.equal(plan.ops.filter((o) => o.table === 'user_activity_log').length, 2)
  const credit = plan.ops.find((o) => o.table === 'staff_signup_credits')!
  assert.equal(credit.match.member_id, 'k')
  assert.equal(credit.set.staff_id, 's1')
  assert.equal(credit.set.created_at, '2026-10-03T00:00:00Z')
})

test('login: the kept phone stays; the other is a secondary contact; the other is "Merged into"', () => {
  const plan = planMerge(side('k', { phone: '923000000001' }), side('o', { phone: '923000000002' }), NOW)
  assert.ok(plan.ops.some((o) => o.match.id === 'k' && o.set.secondary_phone === '923000000002'))
  const last = plan.ops[plan.ops.length - 1]
  assert.deepEqual(last.set, { merged_into: 'k', merged_at: NOW, hidden_from_public: true })
  assert.match(MERGED_LOGIN_MESSAGE, /^Please use your other account/)
  assert.match(read('app/api/auth/login/route.ts'), /if \(profile\?\.merged_into\) \{\s*await supabase\.auth\.signOut\(\)/)
  assert.match(read('app/api/auth/reset/route.ts'), /if \(mergedRow\?\.merged_into\) return NextResponse\.json\(\{ error: MERGED_LOGIN_MESSAGE/)
})

test('Undo restores every row exactly', () => {
  // An in-memory store of the rows the plan touches.
  type Row = Record<string, unknown>
  const db: Record<string, Row[]> = {
    profiles: [
      { id: 'k', full_name: 'Kept', city: null, cnic_number: null, verification_state: null, secondary_phone: null, merged_into: null, merged_at: null, hidden_from_public: false },
      { id: 'o', full_name: 'Other', city: 'Lahore', cnic_number: '00000-0000000-0', verification_state: 'submitted', secondary_phone: null, merged_into: null, merged_at: null, hidden_from_public: false },
    ],
    tutor_profiles: [{ id: 'k', bio: null, verified_fee_paid_at: null }, { id: 'o', bio: 'Bio', verified_fee_paid_at: '2026-10-02' }],
    tutor_subjects: [{ tutor_id: 'o', master_id: 7 }],
    tutor_areas: [{ id: 'ar1', tutor_id: 'o' }],
    applications: [{ id: 'a2', tutor_id: 'o' }],
    user_documents: [{ id: 'd1', user_id: 'o' }],
    payments: [{ id: 'p1', user_id: 'o' }],
    staff_signup_credits: [{ member_id: 'o', staff_id: 's1' }],
  }
  const snapshot = JSON.stringify(db)
  const apply = (ops: Op[]) => {
    for (const op of ops) {
      const rows = (db[op.table] ?? []).filter((r) => Object.entries(op.match).every(([k, v]) => r[k] === v))
      assert.ok(rows.length > 0, `${op.table} ${JSON.stringify(op.match)} matched no row`)
      for (const r of rows) Object.assign(r, op.set)
    }
  }
  const keep = side('k', { profile: { ...side('k').profile, full_name: 'Kept' }, tutor: { ...side('k').tutor!, bio: null } })
  const other = side('o', {
    phone: '923000000002',
    profile: { ...side('o').profile, full_name: 'Other', city: 'Lahore' },
    tutor: { ...side('o').tutor!, bio: 'Bio' },
    docColumns: { ...side('o').docColumns, cnic_number: '00000-0000000-0', verification_state: 'submitted' },
    documents: [{ id: 'd1', kind: 'cnic' }],
    subjects: [{ masterId: 7, subject: 'Physics' }],
    areas: [{ id: 'ar1', city: 'Lahore', area: 'DHA' }],
    applications: [{ id: 'a2', jobId: 'j' }],
    payments: [{ id: 'p1', planCode: 'verified', status: 'approved', refunded: false, ref: 'TM-1' }],
    feePaidAt: '2026-10-02',
    credit: { member_id: 'o', staff_id: 's1', created_at: '2026-10-01' },
  })
  const plan = planMerge(keep, other, NOW)
  apply(plan.ops)
  assert.equal(db.profiles[1].merged_into, 'k')
  assert.equal(db.applications[0].tutor_id, 'k')
  assert.equal(db.tutor_subjects[0].tutor_id, 'k')
  assert.equal(db.staff_signup_credits[0].member_id, 'k')
  apply(undoOps(plan.ops))
  assert.equal(JSON.stringify(db), snapshot, 'every row is back exactly')
})

test('the more complete account is suggested; the merge is owner only, password re-checked, logged', () => {
  assert.equal(suggestKeep(side('a', { completion: 40 }), side('b', { completion: 90 })), 'b')
  assert.equal(suggestKeep(side('a', { feePaidAt: 'x' }), side('b')), 'a')
  const route = read('app/api/admin/members/merge/route.ts')
  assert.match(route, /refuseUnlessOwnerApproval\(gate\.actor/)
  assert.match(route, /requireFreshAuth\(gate\.actor\.id\)/)
  const lib = read('lib/memberMerge.ts')
  assert.match(lib, /await record\(actor, 'member\.merge', keep, other/)
  assert.match(lib, /await record\(actor, 'member\.merge_undo'/)
  assert.match(lib, /\[kept\.id, 'kept'\],\s*\[merged\.id, 'merged'\]/, 'Audit and the Activity tab on BOTH accounts')
  assert.match(lib, /await applyAll\(admin, undoOps\(applied\)\)/, 'a failure part-way puts back what was applied')
  assert.match(read('app/api/admin/members/duplicates/route.ts'), /refuseUnlessOwnerApproval/)
})

test('a merged profile is a 301 to the kept one', async () => {
  const saved = { fetch: globalThis.fetch, url: process.env.NEXT_PUBLIC_SUPABASE_URL, key: process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY }
  process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://example.supabase.co'
  process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY = 'test-key'
  globalThis.fetch = (async () => new Response(JSON.stringify([{ slug: 'ali-raza-tutor-ab12', kept_slug: 'ali-raza-tutor' }]), { status: 200 })) as typeof fetch
  try {
    assert.equal(await mergedTutorRedirectPath('/tutor/ali-raza-tutor-ab12'), '/tutor/ali-raza-tutor')
    assert.equal(await mergedTutorRedirectPath('/tutor/someone-else'), null)
    assert.equal(await mergedTutorRedirectPath('/tutor/dashboard'), null)
  } finally {
    globalThis.fetch = saved.fetch
    process.env.NEXT_PUBLIC_SUPABASE_URL = saved.url
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY = saved.key
  }
  assert.match(read('proxy.ts'), /const kept = await mergedTutorRedirectPath\(request\.nextUrl\.pathname\)[\s\S]{0,200}NextResponse\.redirect\(target, 301\)/)
  // Hidden from lists, search and the sitemap: the merged account is hidden_from_public.
  assert.match(read('lib/peopleDirectoryCore.ts'), /if \(f\.mergedInto\) return 'merged'/)
})

test('"Not a duplicate" hides the pair for good', () => {
  const tags = new Map([
    ['a', [{ id: 'b', name: 'B', reason: 'mobile' as const }, { id: 'c', name: 'C', reason: 'name' as const }]],
    ['b', [{ id: 'a', name: 'A', reason: 'mobile' as const }]],
    ['c', [{ id: 'a', name: 'A', reason: 'name' as const }]],
  ])
  const people = new Map([['a', { name: 'A', role: 'tutor' }], ['b', { name: 'B', role: 'tutor' }], ['c', { name: 'C', role: 'tutor' }]])
  assert.equal(openPairs(tags, new Set(), people).length, 2, 'each pair once')
  const dismissed = new Set([pairId('b', 'a')])
  assert.deepEqual(openPairs(tags, dismissed, people).map((p) => `${p.aId}|${p.bId}`), ['a|c'])
  assert.deepEqual([...withoutDismissed(tags, dismissed).keys()].sort(), ['a', 'c'])
  // Stored in a table (survives every reload), one row per pair, logged on both accounts.
  const lib = read('lib/memberDuplicates.ts')
  assert.match(lib, /from\('member_duplicate_dismissals'\)\.upsert/)
  assert.match(lib, /action: 'member\.not_duplicate'/)
  assert.match(read('supabase/migrations/201_status_merge_parents_viewas.sql'), /primary key \(a_id, b_id\),\s*check \(a_id < b_id\)/)
})
