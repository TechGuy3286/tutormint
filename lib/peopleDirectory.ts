// lib/peopleDirectory.ts
//
// People — Tutors | Parents | Staff (owner, 21 Oct 2026). The I/O half: reads
// every member account once (paged, never stopped by the 1,000-row cap),
// works out each one's facts and applies the one "who counts" rule from
// lib/peopleDirectoryCore. The People tabs, the Overview "New tutors" / "New
// parents" cards and the People sidebar badge all read THIS loader, so their
// numbers cannot drift apart.
//
// Service role, admin only. Emails, mobiles and CNIC numbers are read only to
// decide staff links and possible duplicates; nothing here is logged.

import 'server-only'

import { cache } from 'react'

import { createAdminClient } from '@/lib/supabase/admin'
import { pageAll, pageAllIn } from '@/lib/pageAll'
import { formatName } from '@/lib/formatName'
import { planLabel } from '@/lib/display'
import { parentAddressState, parentCnicState } from '@/lib/parentDocsCore'
import { loadTutorDocSummaries, type CardDocs } from '@/lib/tutorDocSummaries'
import {
  excludedReason,
  findPossibleDuplicates,
  hasActivity,
  isParentRole,
  last10,
  parentVerification,
  staffLinkKeys,
  waitingBadge,
  type DupLink,
  type ExcludeReason,
  type ParentVerification,
} from '@/lib/peopleDirectoryCore'

/** The audit actions that mean "this account was (or became) staff". */
const STAFF_ACTIONS = ['staff.create', 'staff.role_change', 'staff.grant_existing', 'staff.remove', 'staff.suspend', 'staff.reactivate', 'staff.invite_resend']

export type DirectoryPerson = {
  id: string
  role: 'tutor' | 'parent'
  name: string
  city: string | null
  createdAt: string
  excluded: ExcludeReason | null
  suspended: boolean
  banned: boolean
  /** Lower-case email + mobile digits, for the page's search box only. */
  searchText: string
  /** Tutors. */
  feePaidAt: string | null
  videoWaiting: boolean
  /** Parents. */
  parent: {
    mobileVerified: boolean
    tuitionsOpen: number
    tuitionsTotal: number
    plan: string
    verification: ParentVerification
    lastActive: string | null
  } | null
}

export type StaffPerson = {
  id: string
  name: string
  adminRole: string | null
  suspended: boolean
  lastActive: string | null
}

export type Directory = {
  people: DirectoryPerson[]
  staff: StaffPerson[]
}

const PROFILE_COLS =
  'id, role, admin_role, full_name, email, phone_number, whatsapp, city, created_at, is_seed, is_team_account, is_test_name, hidden_from_public, is_suspended, is_banned, linked_account_id, cnic_number, phone_verified_at, verification_state, cnic_verified_at, address, address_status, address_verified_at, merged_into'

type Row = Record<string, unknown>

async function lastActiveFor(admin: NonNullable<ReturnType<typeof createAdminClient>>, ids: string[]): Promise<Map<string, string>> {
  const out = new Map<string, string>()
  const rows = await pageAllIn(ids, (part, from, to) =>
    admin.from('activity_sessions').select('user_id, last_seen_at').in('user_id', part).order('last_seen_at', { ascending: false }).order('id').range(from, to),
  )
  for (const r of rows) {
    const id = r.user_id as string
    const at = r.last_seen_at as string | null
    if (at && (!out.has(id) || at > (out.get(id) as string))) out.set(id, at)
  }
  return out
}

/** Every member account with its facts, and the staff list. One read per
 *  request (React cache). */
export const loadDirectory = cache(async (): Promise<Directory> => {
  const admin = createAdminClient()
  if (!admin) return { people: [], staff: [] }

  const profiles = await pageAll<Row>((a, b) =>
    admin.from('profiles').select(PROFILE_COLS).in('role', ['tutor', 'parent', 'academy', 'admin']).order('id').range(a, b),
  )
  const staffRows = profiles.filter((p) => p.role === 'admin')
  const members = profiles.filter((p) => p.role === 'tutor' || isParentRole(p.role as string))
  const tutorIds = members.filter((p) => p.role === 'tutor').map((p) => p.id as string)
  const parentIds = members.filter((p) => isParentRole(p.role as string)).map((p) => p.id as string)

  const [tps, audits, jobs, parentPays, parentSubs, parentDocs] = await Promise.all([
    pageAllIn(tutorIds, (part, from, to) =>
      admin.from('tutor_profiles').select('id, verified_fee_paid_at, onboarded_at, video_status').in('id', part).order('id').range(from, to),
    ),
    pageAll<Row>((a, b) => admin.from('admin_audit_log').select('target_id').in('action', STAFF_ACTIONS).order('id').range(a, b)),
    pageAllIn(parentIds, (part, from, to) => admin.from('jobs').select('id, parent_id, status').in('parent_id', part).order('id').range(from, to)),
    pageAllIn(parentIds, (part, from, to) =>
      admin.from('payments').select('id, user_id').eq('status', 'approved').like('plan_code', 'parent_%').in('user_id', part).order('id').range(from, to),
    ),
    pageAllIn(parentIds, (part, from, to) =>
      admin
        .from('subscriptions')
        .select('id, user_id, plan_code')
        .eq('status', 'active')
        .gt('expires_at', new Date().toISOString())
        .in('user_id', part)
        .order('id')
        .range(from, to),
    ),
    pageAllIn(parentIds, (part, from, to) =>
      admin.from('user_documents').select('id, user_id, label, status').eq('kind', 'cnic').in('status', ['active', 'review']).in('user_id', part).order('id').range(from, to),
    ),
  ])

  const tp = new Map(tps.map((t) => [t.id as string, t]))
  const formerStaff = new Set(audits.map((r) => String(r.target_id)))
  const staffIds = new Set(staffRows.map((s) => s.id as string))
  const keys = staffLinkKeys(staffRows.map((s) => ({ email: s.email as string | null, phone: s.phone_number as string | null, whatsapp: s.whatsapp as string | null })))
  const jobsBy = new Map<string, { open: number; total: number }>()
  for (const j of jobs) {
    const k = j.parent_id as string
    const cur = jobsBy.get(k) ?? { open: 0, total: 0 }
    cur.total++
    if (j.status === 'open') cur.open++
    jobsBy.set(k, cur)
  }
  const paidPlan = new Set(parentPays.map((p) => p.user_id as string))
  const subPlan = new Map(parentSubs.map((s) => [s.user_id as string, s.plan_code as string]))
  const docsBy = new Map<string, Row[]>()
  for (const d of parentDocs) docsBy.set(d.user_id as string, [...(docsBy.get(d.user_id as string) ?? []), d])

  const isStaffLinked = (p: Row) =>
    formerStaff.has(p.id as string) ||
    (!!p.linked_account_id && staffIds.has(p.linked_account_id as string)) ||
    keys.emails.has(String(p.email ?? '').trim().toLowerCase()) ||
    [p.phone_number, p.whatsapp].some((v) => {
      const d = last10(v as string | null)
      return !!d && keys.phones.has(d)
    })

  // Subjects decide "activity" only for the few staff-linked tutors, so they
  // are read just for those.
  const linkedTutorIds = members.filter((p) => p.role === 'tutor' && isStaffLinked(p)).map((p) => p.id as string)
  const subs = await pageAllIn(linkedTutorIds, (part, from, to) =>
    admin.from('tutor_subjects').select('tutor_id, master_id').in('tutor_id', part).order('tutor_id').order('master_id').range(from, to),
  )
  const subjectCount = new Map<string, number>()
  for (const s of subs) subjectCount.set(s.tutor_id as string, (subjectCount.get(s.tutor_id as string) ?? 0) + 1)

  const seen = await lastActiveFor(admin, [...parentIds, ...staffIds])

  const people: DirectoryPerson[] = members.map((p) => {
    const id = p.id as string
    const role = p.role === 'tutor' ? 'tutor' : 'parent'
    const t = tp.get(id)
    const jb = jobsBy.get(id) ?? { open: 0, total: 0 }
    let parent: DirectoryPerson['parent'] = null
    if (role === 'parent') {
      const mine = (docsBy.get(id) ?? []).filter((d) => d.status !== 'review')
      const facts = {
        verification_state: p.verification_state as string | null,
        cnic_verified_at: p.cnic_verified_at as string | null,
        address: p.address as string | null,
        address_status: p.address_status as string | null,
        address_verified_at: p.address_verified_at as string | null,
        hasCnicFront: mine.some((d) => d.label !== 'back'),
        hasCnicBack: mine.some((d) => d.label === 'back'),
        hasCnicReview: (docsBy.get(id) ?? []).some((d) => d.status === 'review'),
      }
      const plan = subPlan.get(id)
      parent = {
        mobileVerified: !!p.phone_verified_at,
        tuitionsOpen: jb.open,
        tuitionsTotal: jb.total,
        plan: plan && plan !== 'parent_verified' ? (planLabel(plan) ?? 'Free') : 'Free',
        verification: parentVerification(parentCnicState(facts).status, parentAddressState(facts).status),
        lastActive: seen.get(id) ?? null,
      }
    }
    const activity = hasActivity(p.role as string, {
      feePaid: !!t?.verified_fee_paid_at,
      onboarded: !!t?.onboarded_at,
      subjects: subjectCount.get(id) ?? 0,
      tuitions: jb.total,
      paidPlan: paidPlan.has(id),
      submitted: ['submitted', 'approved'].includes(String(p.verification_state ?? '')),
    })
    const digits = [p.phone_number, p.whatsapp]
      .map((v) => String(v ?? '').replace(/\D/g, ''))
      .filter(Boolean)
      .flatMap((d) => [d, d.startsWith('92') ? `0${d.slice(2)}` : d])
    return {
      id,
      role,
      name: formatName(p.full_name as string | null) || '—',
      city: (p.city as string | null) ?? null,
      createdAt: (p.created_at as string) ?? '',
      excluded: excludedReason({
        role: p.role as string,
        isSeed: p.is_seed as boolean,
        isTeam: p.is_team_account as boolean,
        isTestName: p.is_test_name as boolean,
        hidden: p.hidden_from_public as boolean,
        staffLinked: isStaffLinked(p),
        activity,
        mergedInto: (p.merged_into as string | null) ?? null,
      }),
      suspended: !!p.is_suspended,
      banned: !!p.is_banned,
      searchText: [String(p.email ?? '').toLowerCase(), ...digits].join(' '),
      feePaidAt: (t?.verified_fee_paid_at as string | null) ?? null,
      videoWaiting: t?.video_status === 'uploaded',
      parent,
    }
  })
  people.sort((a, b) => b.createdAt.localeCompare(a.createdAt) || a.id.localeCompare(b.id))

  const staff: StaffPerson[] = staffRows
    .map((s) => ({
      id: s.id as string,
      name: formatName(s.full_name as string | null) || '—',
      adminRole: (s.admin_role as string | null) ?? null,
      suspended: !!s.is_suspended,
      lastActive: seen.get(s.id as string) ?? null,
    }))
    .sort((a, b) => a.name.localeCompare(b.name))

  return { people, staff }
})

/** The duplicate tags for a set of people (the ones the view shows). */
export const loadDuplicateFacts = cache(async (): Promise<Map<string, { phones: string[]; cnic: string | null; linkedId: string | null }>> => {
  const admin = createAdminClient()
  const out = new Map<string, { phones: string[]; cnic: string | null; linkedId: string | null }>()
  if (!admin) return out
  const rows = await pageAll<Row>((a, b) =>
    admin.from('profiles').select('id, phone_number, whatsapp, cnic_number, linked_account_id').in('role', ['tutor', 'parent', 'academy']).order('id').range(a, b),
  )
  for (const r of rows)
    out.set(r.id as string, {
      phones: [r.phone_number as string | null, r.whatsapp as string | null].filter((x): x is string => !!x),
      cnic: (r.cnic_number as string | null) ?? null,
      linkedId: (r.linked_account_id as string | null) ?? null,
    })
  return out
})

export async function duplicateTags(people: DirectoryPerson[]): Promise<Map<string, DupLink[]>> {
  const facts = await loadDuplicateFacts()
  return findPossibleDuplicates(
    people.map((p) => {
      const f = facts.get(p.id)
      return { id: p.id, name: p.name, city: p.city, phones: f?.phones ?? [], cnic: f?.cnic ?? null, linkedId: f?.linkedId ?? null }
    }),
  )
}

/** The people one tab shows: by default only those who count. */
export function inTab(people: DirectoryPerson[], role: 'tutor' | 'parent', showAll: boolean): DirectoryPerson[] {
  return people.filter((p) => p.role === role && (showAll || p.excluded === null))
}

/** Default-view counts — the People tabs and the Overview cards. */
export async function directoryCounts(): Promise<{ tutors: number; parents: number; staff: number }> {
  const d = await loadDirectory()
  return { tutors: inTab(d.people, 'tutor', false).length, parents: inTab(d.people, 'parent', false).length, staff: d.staff.length }
}

/** Every tutor's Documents status, for the default Tutors tab (one batch). */
export const loadDirectoryDocs = cache(async (): Promise<Map<string, CardDocs>> => {
  const d = await loadDirectory()
  return loadTutorDocSummaries(inTab(d.people, 'tutor', true).map((p) => p.id))
})

/** The People sidebar badge: documents waiting for the Owner — tutors in the
 *  Tutors tab's "Waiting" chip plus parents in "Waiting for review". */
export async function peopleWaitingCount(): Promise<number> {
  const d = await loadDirectory()
  const docs = await loadDirectoryDocs()
  const tutors = inTab(d.people, 'tutor', false)
  const parents = inTab(d.people, 'parent', false)
  return waitingBadge(
    tutors.map((t) => docs.get(t.id)?.kind ?? null),
    parents.map((p) => p.parent?.verification ?? 'none'),
  )
}
