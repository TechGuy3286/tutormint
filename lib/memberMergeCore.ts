// lib/memberMergeCore.ts — PURE. Merging two accounts of the same person
// (owner, 26 Oct 2026). Owner only, reversible, nothing deleted.
//
// The owner picks the account to KEEP (the more complete one is suggested); the
// other becomes "Merged into <name>". The rules:
//
//   Same type only     tutor + tutor or parent + parent.
//   Blocked            both paid (an approved, not refunded payment, or the
//                      Verification Fee granted), or both have an approved
//                      document — the owner must sort those out by hand.
//   Single fields      the kept account's value wins; an empty one takes the
//                      other's.
//   Subjects, areas    combined. Subjects respect the 15-subject cap: over it,
//                      the kept account's stay and the rest are listed.
//   Documents          moved only when the kept account has none, or none approved.
//   Applications, follow-ups, notes, the timeline and staff credit
//                      moved to the kept account (the earliest staff credit wins).
//                      An application to a tuition the kept account also applied
//                      to stays where it is (listed).
//   Tuitions (parents) moved to the kept account.
//   Payments           only the other account paid → moved (shown clearly).
//   Login              the kept account's phone stays the login; the other phone
//                      is saved as a secondary contact.
//
// Every write is an Op with the values it replaces, so "Undo merge" puts each
// one back exactly, in reverse order.

import { SUBJECT_LIMIT } from '@/lib/subjectLimitCore'
import { subjectDisplayKey } from '@/lib/subjectDisplay'

export type MergeRole = 'tutor' | 'parent'

export type Op = {
  table: string
  /** The row(s): column → value. */
  match: Record<string, string | number>
  set: Record<string, unknown>
  /** The values `set` replaces — what Undo writes back. */
  before: Record<string, unknown>
  /** Short words for the preview. */
  label: string
}

export type MergeSide = {
  id: string
  role: string | null
  name: string
  joinedAt: string
  completion: number
  phone: string | null
  secondaryPhone: string | null
  mergedInto: string | null
  isStaff: boolean
  /** profiles columns the merge may fill (single-value). */
  profile: Record<string, unknown>
  /** tutor_profiles columns the merge may fill (single-value). */
  tutor: Record<string, unknown> | null
  /** The document status columns on profiles. */
  docColumns: Record<string, unknown>
  approvedDocs: string[]
  documents: { id: string; kind: string }[]
  subjects: { masterId: number; subject: string }[]
  areas: { id: string; city: string; area: string }[]
  applications: { id: string; jobId: string }[]
  applicationFollowUps: { id: string; applicationId: string | null }[]
  stageEvents: { id: string; applicationId: string | null }[]
  followUps: string[]
  notes: string[]
  activity: string[]
  jobs: string[]
  payments: { id: string; planCode: string; status: string; refunded: boolean; ref: string | null }[]
  subscriptions: { id: string; planCode: string; status: string }[]
  feePaidAt: string | null
  credit: Record<string, unknown> | null
}

export const PROFILE_FILL = ['full_name', 'city', 'address', 'whatsapp', 'avatar_url'] as const
export const TUTOR_FILL = [
  'headline',
  'bio',
  'gender',
  'experience_years',
  'hourly_rate_pkr',
  'area',
  'city',
  'teaching_mode',
  'job_types',
  'degrees',
  'class_levels',
  'avatar_url',
] as const
export const DOC_COLUMNS = ['cnic_number', 'cnic_image_path', 'verification_state', 'cnic_verified_at', 'profile_pic_status', 'selfie_status'] as const

export function isEmptyValue(v: unknown): boolean {
  if (v === null || v === undefined) return true
  if (typeof v === 'string') return v.trim() === ''
  if (Array.isArray(v)) return v.length === 0
  return false
}

export function isPaid(s: Pick<MergeSide, 'payments' | 'feePaidAt'>): boolean {
  return !!s.feePaidAt || s.payments.some((p) => p.status === 'approved' && !p.refunded)
}

/** Why these two accounts cannot be merged, or null. */
export function mergeBlock(keep: MergeSide, other: MergeSide): string | null {
  if (keep.id === other.id) return 'Pick two different accounts.'
  if (keep.isStaff || other.isStaff) return 'A staff account cannot be merged.'
  if (keep.mergedInto || other.mergedInto) return 'One of these accounts is already merged.'
  const role = (r: string | null) => (r === 'academy' ? 'parent' : r)
  if (role(keep.role) !== role(other.role) || !['tutor', 'parent'].includes(role(keep.role) ?? '')) {
    return 'Only accounts of the same type can be merged (tutor with tutor, parent with parent).'
  }
  if (isPaid(keep) && isPaid(other)) return 'Both accounts have paid. Sort out the payments first — a merge would leave two payments on one account.'
  if (keep.approvedDocs.length > 0 && other.approvedDocs.length > 0) {
    return 'Both accounts have approved documents. Decide which documents are right before merging.'
  }
  return null
}

/** The account to keep, suggested: the more complete one, then the one that
 *  paid, then the older one. */
export function suggestKeep(a: MergeSide, b: MergeSide): string {
  if (a.completion !== b.completion) return a.completion > b.completion ? a.id : b.id
  if (isPaid(a) !== isPaid(b)) return isPaid(a) ? a.id : b.id
  return Date.parse(a.joinedAt) <= Date.parse(b.joinedAt) ? a.id : b.id
}

export type MergeReport = {
  subjectsLeftOut: string[]
  applicationsLeft: string[]
  documentsMoved: boolean
  paymentsMoved: { ref: string | null; planCode: string }[]
  counts: Record<string, number>
}

export type MergePlan = { ops: Op[]; report: MergeReport }

const lower = (s: string) => s.trim().toLowerCase()

export function planMerge(keep: MergeSide, other: MergeSide, nowIso: string): MergePlan {
  const ops: Op[] = []
  const report: MergeReport = { subjectsLeftOut: [], applicationsLeft: [], documentsMoved: false, paymentsMoved: [], counts: {} }
  const count = (k: string, n = 1) => (report.counts[k] = (report.counts[k] ?? 0) + n)
  const move = (table: string, col: string, id: string | number, label: string, idCol = 'id') => {
    ops.push({ table, match: { [idCol]: id }, set: { [col]: keep.id }, before: { [col]: other.id }, label })
    count(label)
  }

  // ---- documents (first: the CNIC number is unique across accounts) ----------
  const moveDocs = other.documents.length > 0 && (keep.documents.length === 0 || keep.approvedDocs.length === 0)
  if (moveDocs) {
    report.documentsMoved = true
    // Clear the other account's CNIC number before the kept one takes it.
    if (!isEmptyValue(other.docColumns.cnic_number)) {
      ops.push({ table: 'profiles', match: { id: other.id }, set: { cnic_number: null }, before: { cnic_number: other.docColumns.cnic_number }, label: 'CNIC number' })
    }
    const set: Record<string, unknown> = {}
    const before: Record<string, unknown> = {}
    for (const c of DOC_COLUMNS) {
      if (!isEmptyValue(other.docColumns[c])) {
        set[c] = other.docColumns[c]
        before[c] = keep.docColumns[c] ?? null
      }
    }
    if (Object.keys(set).length) ops.push({ table: 'profiles', match: { id: keep.id }, set, before, label: 'Document status' })
    for (const d of other.documents) move('user_documents', 'user_id', d.id, 'Documents')
  }

  // ---- single-value fields ------------------------------------------------
  const fill = (table: 'profiles' | 'tutor_profiles', cols: readonly string[], k: Record<string, unknown> | null, o: Record<string, unknown> | null) => {
    if (!k || !o) return
    const set: Record<string, unknown> = {}
    const before: Record<string, unknown> = {}
    for (const c of cols) {
      if (isEmptyValue(k[c]) && !isEmptyValue(o[c])) {
        set[c] = o[c]
        before[c] = k[c] ?? null
      }
    }
    if (Object.keys(set).length) {
      ops.push({ table, match: { id: keep.id }, set, before, label: 'Profile details' })
      count('Profile details', Object.keys(set).length)
    }
  }
  fill('profiles', PROFILE_FILL, keep.profile, other.profile)
  fill('tutor_profiles', TUTOR_FILL, keep.tutor, other.tutor)

  // ---- subjects (15-subject cap) and areas --------------------------------
  const subjectKey = (s: { masterId: number; subject: string }) => subjectDisplayKey(s.subject) || `id:${s.masterId}`
  const keptSubjects = new Set(keep.subjects.map(subjectKey))
  const keptMasters = new Set(keep.subjects.map((s) => s.masterId))
  const leftOut = new Set<string>()
  for (const s of other.subjects) {
    if (keptMasters.has(s.masterId)) continue
    const name = subjectKey(s)
    if (!keptSubjects.has(name) && keptSubjects.size >= SUBJECT_LIMIT) {
      leftOut.add(s.subject)
      continue
    }
    keptSubjects.add(name)
    keptMasters.add(s.masterId)
    ops.push({ table: 'tutor_subjects', match: { tutor_id: other.id, master_id: s.masterId }, set: { tutor_id: keep.id }, before: { tutor_id: other.id }, label: 'Subjects' })
    count('Subjects')
  }
  report.subjectsLeftOut = [...leftOut]
  const keptAreas = new Set(keep.areas.map((a) => `${lower(a.city)}|${lower(a.area)}`))
  for (const a of other.areas) {
    const k = `${lower(a.city)}|${lower(a.area)}`
    if (keptAreas.has(k)) continue
    keptAreas.add(k)
    move('tutor_areas', 'tutor_id', a.id, 'Areas')
  }

  // ---- applications (and their follow-ups and stage history) --------------
  const keptJobs = new Set(keep.applications.map((a) => a.jobId))
  const moved = new Set<string>()
  for (const a of other.applications) {
    if (keptJobs.has(a.jobId)) {
      report.applicationsLeft.push(a.id)
      continue
    }
    keptJobs.add(a.jobId)
    moved.add(a.id)
    move('applications', 'tutor_id', a.id, 'Applications')
  }
  for (const f of other.applicationFollowUps) if (f.applicationId && moved.has(f.applicationId)) move('application_follow_ups', 'tutor_id', f.id, 'Application follow-ups')
  for (const e of other.stageEvents) if (e.applicationId && moved.has(e.applicationId)) move('application_stage_events', 'tutor_id', e.id, 'Application history')

  // ---- follow-ups, notes, timeline, tuitions -------------------------------
  for (const id of other.followUps) move('member_follow_ups', 'member_id', id, 'Follow-ups')
  for (const id of other.notes) move('member_notes', 'member_id', id, 'Notes')
  for (const id of other.activity) move('user_activity_log', 'user_id', id, 'Timeline')
  for (const id of other.jobs) move('jobs', 'parent_id', id, 'Tuitions')

  // ---- staff credit: the earliest wins -------------------------------------
  if (other.credit) {
    if (!keep.credit) {
      ops.push({ table: 'staff_signup_credits', match: { member_id: other.id }, set: { member_id: keep.id }, before: { member_id: other.id }, label: 'Staff credit' })
      count('Staff credit')
    } else if (Date.parse(String(other.credit.created_at)) < Date.parse(String(keep.credit.created_at))) {
      const set: Record<string, unknown> = {}
      const before: Record<string, unknown> = {}
      for (const [c, v] of Object.entries(other.credit)) {
        if (c === 'member_id') continue
        if (v !== keep.credit[c]) {
          set[c] = v
          before[c] = keep.credit[c] ?? null
        }
      }
      if (Object.keys(set).length) {
        ops.push({ table: 'staff_signup_credits', match: { member_id: keep.id }, set, before, label: 'Staff credit' })
        count('Staff credit')
      }
    }
  }

  // ---- payments: only the other account paid -------------------------------
  if (isPaid(other) && !isPaid(keep)) {
    for (const p of other.payments) {
      move('payments', 'user_id', p.id, 'Payments')
      if (p.status === 'approved' && !p.refunded) report.paymentsMoved.push({ ref: p.ref, planCode: p.planCode })
    }
    for (const s of other.subscriptions) move('subscriptions', 'user_id', s.id, 'Plans')
    if (other.feePaidAt && keep.tutor) {
      ops.push({ table: 'tutor_profiles', match: { id: keep.id }, set: { verified_fee_paid_at: other.feePaidAt }, before: { verified_fee_paid_at: keep.feePaidAt }, label: 'Verification Fee' })
    }
  }

  // ---- login: the other phone becomes a secondary contact -------------------
  const digits = (s: string | null) => (s ?? '').replace(/\D/g, '').slice(-10)
  if (other.phone && digits(other.phone) !== digits(keep.phone) && isEmptyValue(keep.secondaryPhone)) {
    ops.push({ table: 'profiles', match: { id: keep.id }, set: { secondary_phone: other.phone }, before: { secondary_phone: keep.secondaryPhone }, label: 'Secondary phone' })
  }

  // ---- last: the other account becomes "Merged into <name>" ----------------
  ops.push({
    table: 'profiles',
    match: { id: other.id },
    set: { merged_into: keep.id, merged_at: nowIso, hidden_from_public: true },
    before: { merged_into: null, merged_at: null, hidden_from_public: other.profile.hidden_from_public ?? false },
    label: 'Merged account',
  })
  return { ops, report }
}

/** Undo: every op written back, newest first. */
export function undoOps(ops: Op[]): Op[] {
  return [...ops].reverse().map((o) => ({ table: o.table, match: { ...o.match, ...matchAfter(o) }, set: o.before, before: o.set, label: o.label }))
}

/** A row matched on a column the op itself changed is found by its new value. */
function matchAfter(o: Op): Record<string, string | number> {
  const out: Record<string, string | number> = {}
  for (const k of Object.keys(o.match)) if (k in o.set) out[k] = o.set[k] as string | number
  return { ...out }
}

/** The preview's lines, in words. */
export function previewLines(plan: MergePlan): string[] {
  const lines: string[] = []
  for (const [label, n] of Object.entries(plan.report.counts)) lines.push(`${label}: ${n} ${label === 'Profile details' ? (n === 1 ? 'field' : 'fields') : n === 1 ? 'item' : 'items'} move`)
  if (plan.report.documentsMoved) lines.push('Documents move to the kept account (it has none approved).')
  for (const p of plan.report.paymentsMoved) lines.push(`PAYMENT MOVES: ${p.planCode === 'verified' ? 'Verification Fee' : p.planCode}${p.ref ? ` (${p.ref})` : ''}`)
  if (plan.report.subjectsLeftOut.length) lines.push(`Over the ${SUBJECT_LIMIT}-subject cap, not moved: ${plan.report.subjectsLeftOut.join(', ')}`)
  if (plan.report.applicationsLeft.length) lines.push(`${plan.report.applicationsLeft.length} application(s) to a tuition both applied to stay on the merged account.`)
  return lines
}

/** What signing in with a merged account says. */
export const MERGED_LOGIN_MESSAGE = 'Please use your other account. This account was merged into it — sign in with that account’s mobile number or email.'

/** A duplicate pair's stable key (order does not matter). */
export function pairKey(a: string, b: string): [string, string] {
  return a < b ? [a, b] : [b, a]
}
