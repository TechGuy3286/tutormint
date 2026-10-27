import 'server-only'

import { cache } from 'react'

import { createAdminClient } from '@/lib/supabase/admin'
import { chunk, pageAll } from '@/lib/pageAll'
import { loadDirectory } from '@/lib/peopleDirectory'
import { loadNotInterested } from '@/lib/followUpDismissals'
import { isSyntheticEmail, normalisePkMobile } from '@/lib/phone'
import { tuitionPath } from '@/lib/slugs'
import { formatName } from '@/lib/formatName'
import { fuBadgeCount, type ContactRecord, type TabState } from '@/lib/tutorFollowUpTabsCore'
import {
  parentMessageSituation,
  parentProgressKey,
  parentSituation,
  parentTabState,
  PARENT_TEMPLATE_KEY,
  type ParentFacts,
  type ParentReason,
  type ParentTuition,
} from '@/lib/parentFollowUpCore'

type Admin = NonNullable<ReturnType<typeof createAdminClient>>

// Follow-ups → Parents (owner, 26 Oct 2026; rules lib/parentFollowUpCore). Every
// real parent account (the People page's rule — no staff, seed, team or test
// account; not suspended or banned) with something to follow up, its situation,
// its To do / Followed up state and the template it would send.
//
// Never returned to the page: a phone number or an email. The send route reads
// them itself.

export type ParentFollowRow = {
  id: string
  name: string
  city: string | null
  joinedAt: string
  reason: ParentReason
  tuition: { id: string; title: string; path: string | null } | null
  templateKey: string | null
  progress: string
  state: TabState
  posted: boolean
  verification: 'waiting' | 'verified' | 'not_submitted' | 'rejected'
  hasNumber: boolean
  hasEmail: boolean
  notInterested: boolean
}

const VERIFICATION_WORD = { approved: 'verified', waiting: 'waiting', none: 'not_submitted', rejected: 'rejected' } as const

type Loaded = {
  rows: ParentFollowRow[]
  facts: Map<string, ParentFacts>
  /** Every eligible parent, situation or not — for a WhatsApp button anywhere. */
  all: Map<string, { facts: ParentFacts; name: string; contacts: (ContactRecord & { templateKey: string | null })[]; appAts: string[]; refBy: Map<string, string | null> }>
}

async function emailConfirmed(admin: Admin): Promise<Map<string, boolean>> {
  const out = new Map<string, boolean>()
  for (let page = 1; page <= 50; page++) {
    const { data, error } = await admin.auth.admin.listUsers({ page, perPage: 200 })
    if (error) break
    const users = data?.users ?? []
    for (const u of users) out.set(u.id, !!u.email_confirmed_at)
    if (users.length < 200) break
  }
  return out
}

export const loadParentFollowUps = cache(async (): Promise<Loaded> => {
  const admin = createAdminClient()
  if (!admin) return { rows: [], facts: new Map(), all: new Map() }
  const nowMs = Date.now()
  const [directory, dismissed] = await Promise.all([loadDirectory(), loadNotInterested()])
  const parents = directory.people.filter((p) => p.role === 'parent' && p.excluded === null && !p.suspended && !p.banned)
  const ids = parents.map((p) => p.id)
  const realTutors = new Set(directory.people.filter((p) => p.role === 'tutor' && p.excluded === null).map((p) => p.id))
  if (ids.length === 0) return { rows: [], facts: new Map(), all: new Map() }

  const contactBy = new Map<string, { phone: string | null; email: string | null }>()
  const jobs: Record<string, unknown>[] = []
  const contacts = new Map<string, (ContactRecord & { templateKey: string | null })[]>()
  for (const part of chunk(ids, 100)) {
    const [{ data: ps }, js, { data: fus }] = await Promise.all([
      admin.from('profiles').select('id, phone_number, whatsapp, email').in('id', part),
      pageAll((a, b) =>
        admin.from('jobs').select('id, parent_id, title, status, created_at, public_slug, city, ref_id').in('parent_id', part).order('id').range(a, b),
      ),
      admin.from('member_follow_ups').select('member_id, created_at, progress, staff_name, template_key, undone_at').in('member_id', part).is('undone_at', null),
    ])
    for (const p of ps ?? []) {
      contactBy.set(p.id as string, {
        phone: normalisePkMobile(((p.whatsapp as string | null) ?? (p.phone_number as string | null)) ?? null),
        email: (p.email as string | null) && !isSyntheticEmail(p.email as string) ? (p.email as string) : null,
      })
    }
    jobs.push(...(js as Record<string, unknown>[]))
    for (const f of fus ?? []) {
      const k = f.member_id as string
      contacts.set(k, [
        ...(contacts.get(k) ?? []),
        { at: f.created_at as string, progress: (f.progress as string | null) ?? null, staffName: (f.staff_name as string | null) ?? null, templateKey: (f.template_key as string | null) ?? null },
      ])
    }
  }

  const jobIds = jobs.map((j) => j.id as string)
  const apps: Record<string, unknown>[] = []
  const appMsgs = new Map<string, string[]>()
  for (const part of chunk(jobIds, 100)) {
    const [{ data: as }, { data: afu }] = await Promise.all([
      admin.from('applications').select('id, job_id, tutor_id, stage, stage_changed_at, status').in('job_id', part),
      admin.from('application_follow_ups').select('job_id, created_at').eq('recipient', 'parent').is('undone_at', null).in('job_id', part),
    ])
    apps.push(...((as ?? []) as Record<string, unknown>[]))
    for (const m of afu ?? []) appMsgs.set(m.job_id as string, [...(appMsgs.get(m.job_id as string) ?? []), m.created_at as string])
  }
  const tutorNames = new Map<string, string>()
  const hiredTutorIds = [...new Set(apps.filter((a) => a.stage === 'hired').map((a) => a.tutor_id as string))]
  for (const part of chunk(hiredTutorIds, 100)) {
    const { data } = await admin.from('profiles').select('id, full_name').in('id', part)
    for (const p of data ?? []) tutorNames.set(p.id as string, formatName(p.full_name as string | null))
  }
  const confirmed = await emailConfirmed(admin)

  const appsByJob = new Map<string, Record<string, unknown>[]>()
  for (const a of apps) {
    if (a.status === 'withdrawn' || !realTutors.has(a.tutor_id as string)) continue
    appsByJob.set(a.job_id as string, [...(appsByJob.get(a.job_id as string) ?? []), a])
  }
  const jobsByParent = new Map<string, ParentTuition[]>()
  const refBy = new Map<string, string | null>()
  for (const j of jobs) {
    const list = appsByJob.get(j.id as string) ?? []
    const hire = list.filter((a) => a.stage === 'hired').sort((x, y) => String(y.stage_changed_at).localeCompare(String(x.stage_changed_at)))[0]
    const t: ParentTuition = {
      id: j.id as string,
      title: ((j.title as string | null) ?? 'Tuition').trim(),
      status: j.status as string,
      createdAt: j.created_at as string,
      publicPath: j.public_slug ? tuitionPath({ public_slug: j.public_slug as string, city: j.city as string | null }) : null,
      applications: list.length,
      waitingForward: list.filter((a) => a.stage === 'applied').length,
      hiredAt: hire ? ((hire.stage_changed_at as string | null) ?? null) : null,
      hiredTutorName: hire ? (tutorNames.get(hire.tutor_id as string) ?? null) : null,
      hiredApplicationId: hire ? ((hire.id as string | null) ?? null) : null,
    }
    refBy.set(t.id, (j.ref_id as string | null) ?? null)
    const k = j.parent_id as string
    jobsByParent.set(k, [...(jobsByParent.get(k) ?? []), t])
  }

  const rows: ParentFollowRow[] = []
  const factsBy = new Map<string, ParentFacts>()
  const all: Loaded['all'] = new Map()
  for (const p of parents) {
    const c = contactBy.get(p.id) ?? { phone: null, email: null }
    const own = contacts.get(p.id) ?? []
    const tuitions = jobsByParent.get(p.id) ?? []
    const thanks = own.filter((x) => x.templateKey === PARENT_TEMPLATE_KEY.hired).map((x) => x.at).sort().pop() ?? null
    const facts: ParentFacts = {
      joinedAt: p.createdAt,
      emailSignup: !!c.email && !c.phone,
      emailConfirmed: confirmed.get(p.id) ?? true,
      tuitions,
      hiredThanksAt: thanks,
    }
    const appAts = tuitions.flatMap((t) => appMsgs.get(t.id) ?? [])
    all.set(p.id, { facts, name: p.name, contacts: own, appAts, refBy })
    const s = parentSituation(facts, nowMs)
    if (!s) continue
    factsBy.set(p.id, facts)
    const ref = s.tuition ? refBy.get(s.tuition.id) : null
    const applicationsHref = `/admin/applications?staff=all${ref ? `&q=${encodeURIComponent(ref)}` : ''}`
    const state = parentTabState(facts, s, own, appAts, nowMs, applicationsHref)
    rows.push({
      id: p.id,
      name: p.name,
      city: p.city,
      joinedAt: p.createdAt,
      reason: s.reason,
      tuition: s.tuition ? { id: s.tuition.id, title: s.tuition.title, path: s.tuition.publicPath } : null,
      templateKey: PARENT_TEMPLATE_KEY[s.reason],
      progress: parentProgressKey(facts, s),
      state,
      posted: (p.parent?.tuitionsTotal ?? tuitions.length) > 0,
      verification: VERIFICATION_WORD[p.parent?.verification ?? 'none'],
      hasNumber: !!c.phone,
      hasEmail: !!c.email,
      notInterested: dismissed.has(p.id),
    })
  }
  return { rows, facts: factsBy, all }
})

/** The parents' overdue To do count for the Follow-ups badge (not "Not interested"). */
export async function parentFollowUpsOverdueCount(): Promise<number> {
  try {
    const { rows } = await loadParentFollowUps()
    return fuBadgeCount(rows.filter((r) => !r.notInterested).map((r) => r.state))
  } catch {
    return 0
  }
}

/**
 * One parent's row and their contact details, for a send. A parent on the
 * Follow-ups list gets their row; any other eligible parent gets a row built
 * from parentMessageSituation (owner, 27 Oct 2026), so a WhatsApp button
 * anywhere always has a situation message with its link.
 */
export async function parentForSend(memberId: string): Promise<{ row: ParentFollowRow; phone: string | null; email: string | null; facts: ParentFacts } | null> {
  const { rows, facts, all } = await loadParentFollowUps()
  let row = rows.find((r) => r.id === memberId)
  let f = facts.get(memberId)
  if (!row || !f) {
    const a = all.get(memberId)
    if (!a) return null
    const nowMs = Date.now()
    const s = parentMessageSituation(a.facts, nowMs)
    const ref = s.tuition ? a.refBy.get(s.tuition.id) : null
    f = a.facts
    row = {
      id: memberId,
      name: a.name,
      city: null,
      joinedAt: a.facts.joinedAt,
      reason: s.reason,
      tuition: s.tuition ? { id: s.tuition.id, title: s.tuition.title, path: s.tuition.publicPath } : null,
      templateKey: PARENT_TEMPLATE_KEY[s.reason],
      progress: parentProgressKey(a.facts, s),
      state: parentTabState(a.facts, s, a.contacts, a.appAts, nowMs, `/admin/applications?staff=all${ref ? `&q=${encodeURIComponent(ref)}` : ''}`),
      posted: a.facts.tuitions.length > 0,
      verification: 'not_submitted',
      hasNumber: false,
      hasEmail: false,
      notInterested: false,
    }
  }
  const admin = createAdminClient()
  if (!admin) return null
  const { data: p } = await admin.from('profiles').select('phone_number, whatsapp, email').eq('id', memberId).maybeSingle()
  return {
    row,
    facts: f,
    phone: normalisePkMobile(((p?.whatsapp as string | null) ?? (p?.phone_number as string | null)) ?? null),
    email: (p?.email as string | null) && !isSyntheticEmail(p?.email as string) ? (p?.email as string) : null,
  }
}
