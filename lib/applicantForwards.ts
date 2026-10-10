// lib/applicantForwards.ts
//
// The server half of Marketplace → "Applicants to forward" (rules:
// lib/applicantForwardCore). Loads every tuition a PAID tutor applied to or
// viewed the contact number of, with the parent's contact as staff see it, and
// records forwards and outcomes.
//
// "Paid" = the Verification Fee is paid (tutor_profiles.verified_fee_paid_at),
// and the account is not paused, banned or a hidden test account.
// "Applied"  = an applications row that was not withdrawn.
// "Viewed number" = a tuition_access row (the tutor spent an application to
// open this tuition's contact) with no application, or a contact_reveals row
// for the tuition's seeded contact.
//
// Staff only. Nothing here is read by a tutor's or a parent's dashboard.

import 'server-only'

import { cache } from 'react'

import { createAdminClient } from '@/lib/supabase/admin'
import { pageAll, pageAllIn } from '@/lib/pageAll'
import { logAdminAction } from '@/lib/auditLog'
import type { AdminActor } from '@/lib/adminAuth'
import { fetchTaxonomyTables, buildTaxonomy } from '@/lib/taxonomyBuild'
import { loadVerifiedBadgeOk } from '@/lib/badgeFacts'
import { formatName } from '@/lib/formatName'
import { normalisePkMobile } from '@/lib/phone'
import { placeLabel, areaWithoutCity } from '@/lib/place'
import { tutorPath, tuitionPath } from '@/lib/slugs'
import { absoluteUrl } from '@/lib/siteUrl'
import type { BadgeName } from '@/lib/planBadges'
import {
  APPLICANTS_FORWARD_DEFAULT,
  APPLICANTS_FORWARD_TEMPLATE_KEY,
  OUTCOME_NEEDS_TUTOR,
  buildForwardStates,
  forwardCounts,
  validForwardTutorIds,
  type ForwardRow,
  type ForwardState,
  type InterestEvent,
  type OutcomeKind,
  type OutcomeRow,
} from '@/lib/applicantForwardCore'

export type ForwardTutor = {
  id: string
  name: string
  avatarUrl: string | null
  gender: string | null
  badges: BadgeName[]
  subjects: string[]
  experienceYears: number | null
  city: string | null
  area: string | null
  /** Absolute public profile URL, or null when the tutor has no public page. */
  profileUrl: string | null
  kind: 'applied' | 'viewed'
  at: string
  alreadySent: boolean
}

export type ForwardCard = {
  jobId: string
  ref: string | null
  title: string
  level: string | null
  subjects: string[]
  area: string | null
  city: string | null
  place: string
  postedAt: string
  status: string
  publicUrl: string | null
  parent: { name: string | null; msisdn: string | null; phoneLabel: string | null; teamPosted: boolean }
  tutors: ForwardTutor[]
  state: Pick<ForwardState, 'tab' | 'newTutorIds' | 'newApplicant' | 'checkWithParent' | 'lastForward' | 'lastOutcome'>
}

export type ForwardBoard = {
  cards: ForwardCard[]
  counts: ReturnType<typeof forwardCounts>
  template: string
}

const EMPTY: ForwardBoard = {
  cards: [],
  counts: { toForward: 0, forwarded: 0, outcome: 0, paidTutors: 0, paidTutorsToForward: 0, applications: 0, views: 0 },
  template: APPLICANTS_FORWARD_DEFAULT,
}

type Admin = NonNullable<ReturnType<typeof createAdminClient>>

/** Interest events + the paid set + forwards + outcomes: the inputs to the rules. */
async function loadInputs(admin: Admin) {
  const [apps, access, reveals] = await Promise.all([
    pageAll<{ job_id: string; tutor_id: string; created_at: string; withdrawn_at: string | null }>((from, to) =>
      admin.from('applications').select('job_id, tutor_id, created_at, withdrawn_at').order('id').range(from, to),
    ),
    pageAll<{ job_id: string; tutor_id: string; created_at: string }>((from, to) =>
      admin.from('tuition_access').select('job_id, tutor_id, created_at').order('created_at').order('tutor_id').order('job_id').range(from, to),
    ),
    pageAll<{ job_contact_id: string | null; tutor_id: string; created_at: string }>((from, to) =>
      admin
        .from('contact_reveals')
        .select('job_contact_id, tutor_id, created_at')
        .not('job_contact_id', 'is', null)
        .order('created_at')
        .order('tutor_id')
        .range(from, to),
    ),
  ])

  const applied = new Set<string>()
  const events: InterestEvent[] = []
  for (const a of apps) {
    if (a.withdrawn_at) continue
    applied.add(`${a.job_id}:${a.tutor_id}`)
    events.push({ jobId: a.job_id, tutorId: a.tutor_id, kind: 'applied', at: a.created_at })
  }
  for (const v of access) {
    if (applied.has(`${v.job_id}:${v.tutor_id}`)) continue
    events.push({ jobId: v.job_id, tutorId: v.tutor_id, kind: 'viewed', at: v.created_at })
  }
  for (const r of reveals) {
    if (!r.job_contact_id || applied.has(`${r.job_contact_id}:${r.tutor_id}`)) continue
    events.push({ jobId: r.job_contact_id, tutorId: r.tutor_id, kind: 'viewed', at: r.created_at })
  }

  const tutorIds = [...new Set(events.map((e) => e.tutorId))]
  const [tutorRows, profileRows] = await Promise.all([
    pageAllIn<{ id: string; verified_fee_paid_at: string | null }, string>(tutorIds, (ids, from, to) =>
      admin.from('tutor_profiles').select('id, verified_fee_paid_at').in('id', ids).order('id').range(from, to),
    ),
    pageAllIn<{ id: string; is_suspended: boolean | null; is_banned: boolean | null; hidden_from_public: boolean | null; is_test_name: boolean | null; is_seed: boolean | null }, string>(
      tutorIds,
      (ids, from, to) => admin.from('profiles').select('id, is_suspended, is_banned, hidden_from_public, is_test_name, is_seed').in('id', ids).order('id').range(from, to),
    ),
  ])
  const blocked = new Set(
    profileRows.filter((p) => p.is_suspended || p.is_banned || p.hidden_from_public || p.is_test_name || p.is_seed).map((p) => p.id),
  )
  const paid = new Set(tutorRows.filter((t) => !!t.verified_fee_paid_at && !blocked.has(t.id)).map((t) => t.id))

  const [fwd, out] = await Promise.all([
    pageAll<{ job_id: string; tutor_ids: string[] | null; created_at: string; staff_name: string | null; channel: string }>((from, to) =>
      admin.from('applicant_forwards').select('job_id, tutor_ids, created_at, staff_name, channel').order('created_at').order('id').range(from, to),
    ),
    pageAll<{ job_id: string; outcome: OutcomeKind; tutor_id: string | null; note: string | null; created_at: string; staff_name: string | null }>((from, to) =>
      admin.from('applicant_forward_outcomes').select('job_id, outcome, tutor_id, note, created_at, staff_name').order('created_at').order('id').range(from, to),
    ),
  ])
  const forwards: ForwardRow[] = fwd.map((f) => ({
    jobId: f.job_id,
    tutorIds: f.tutor_ids ?? [],
    at: f.created_at,
    staffName: f.staff_name,
    channel: f.channel,
  }))
  const outcomes: OutcomeRow[] = out.map((o) => ({
    jobId: o.job_id,
    outcome: o.outcome,
    tutorId: o.tutor_id,
    note: o.note,
    at: o.created_at,
    staffName: o.staff_name,
  }))
  return { events, paid, forwards, outcomes }
}

async function loadStates(admin: Admin) {
  const inputs = await loadInputs(admin)
  const states = buildForwardStates({ ...inputs, nowMs: Date.now() })
  return { ...inputs, states }
}

/** The sidebar badge: tuitions in "To forward". Tolerant — 0 on any failure. */
export const applicantsToForwardCount = cache(async (): Promise<number> => {
  const admin = createAdminClient()
  if (!admin) return 0
  try {
    const { states } = await loadStates(admin)
    return states.filter((s) => s.tab === 'to_forward').length
  } catch {
    return 0
  }
})

/** Everything the screen shows. */
export async function loadForwardBoard(): Promise<ForwardBoard> {
  const admin = createAdminClient()
  if (!admin) return EMPTY
  const { events, paid, states } = await loadStates(admin)
  if (states.length === 0) return { ...EMPTY, counts: forwardCounts(states, events, paid) }

  const jobIds = states.map((s) => s.jobId)
  const tutorIds = [...new Set(states.flatMap((s) => s.tutors.map((t) => t.tutorId)))]

  const [jobs, jobSubjects, contacts, tutors, tutorProfiles, tutorSubjects, subs, verifiedOk, tables, tpl] = await Promise.all([
    pageAllIn<Record<string, unknown>, string>(jobIds, (ids, from, to) =>
      admin.from('jobs').select('id, ref_id, title, class_level, city, area, status, created_at, parent_id, public_slug').in('id', ids).order('id').range(from, to),
    ),
    pageAllIn<{ job_id: string; master_id: number }, string>(jobIds, (ids, from, to) =>
      admin.from('job_subjects').select('job_id, master_id').in('job_id', ids).order('job_id').order('master_id').range(from, to),
    ),
    pageAllIn<{ job_id: string; contact_name: string | null; contact_phone: string | null; contact_whatsapp: string | null }, string>(jobIds, (ids, from, to) =>
      admin.from('job_contacts').select('job_id, contact_name, contact_phone, contact_whatsapp').in('job_id', ids).order('job_id').range(from, to),
    ),
    pageAllIn<{ id: string; full_name: string | null; avatar_url: string | null; profile_pic_status: string | null }, string>(tutorIds, (ids, from, to) =>
      admin.from('profiles').select('id, full_name, avatar_url, profile_pic_status').in('id', ids).order('id').range(from, to),
    ),
    pageAllIn<{ id: string; slug: string | null; city: string | null; area: string | null; gender: string | null; experience_years: number | null }, string>(tutorIds, (ids, from, to) =>
      admin.from('tutor_profiles').select('id, slug, city, area, gender, experience_years').in('id', ids).order('id').range(from, to),
    ),
    pageAllIn<{ tutor_id: string; master_id: number }, string>(tutorIds, (ids, from, to) =>
      admin.from('tutor_subjects').select('tutor_id, master_id').in('tutor_id', ids).order('tutor_id').order('master_id').range(from, to),
    ),
    pageAllIn<{ user_id: string; plan_code: string }, string>(tutorIds, (ids, from, to) =>
      admin
        .from('subscriptions')
        .select('user_id, plan_code')
        .eq('status', 'active')
        .gt('expires_at', new Date().toISOString())
        .in('user_id', ids)
        .order('user_id')
        .order('plan_code')
        .range(from, to),
    ),
    loadVerifiedBadgeOk(tutorIds),
    fetchTaxonomyTables(admin),
    admin.from('admin_message_templates').select('body').eq('key', APPLICANTS_FORWARD_TEMPLATE_KEY).maybeSingle(),
  ])

  const subjectName = new Map<number, string>()
  if (tables) for (const r of buildTaxonomy(tables).rows) subjectName.set(r.id, r.subject ?? r.level)
  const namesFor = (ids: number[]) => [...new Set(ids.map((id) => subjectName.get(id)).filter((n): n is string => !!n))]

  const jobSubjectIds = new Map<string, number[]>()
  for (const r of jobSubjects) jobSubjectIds.set(r.job_id, [...(jobSubjectIds.get(r.job_id) ?? []), r.master_id])
  const tutorSubjectIds = new Map<string, number[]>()
  for (const r of tutorSubjects) tutorSubjectIds.set(r.tutor_id, [...(tutorSubjectIds.get(r.tutor_id) ?? []), r.master_id])

  const parentIds = [...new Set(jobs.map((j) => j.parent_id as string).filter(Boolean))]
  const parents = await pageAllIn<{ id: string; full_name: string | null; phone_number: string | null; whatsapp: string | null; is_team_account: boolean | null }, string>(
    parentIds,
    (ids, from, to) => admin.from('profiles').select('id, full_name, phone_number, whatsapp, is_team_account').in('id', ids).order('id').range(from, to),
  )
  const parentBy = new Map(parents.map((p) => [p.id, p]))
  const contactBy = new Map(contacts.map((c) => [c.job_id, c]))
  const jobBy = new Map(jobs.map((j) => [j.id as string, j]))
  const profileBy = new Map(tutors.map((t) => [t.id, t]))
  const tpBy = new Map(tutorProfiles.map((t) => [t.id, t]))
  const planBy = new Map<string, string>()
  for (const s of subs) if (!planBy.has(s.user_id)) planBy.set(s.user_id, s.plan_code)

  const cards: ForwardCard[] = []
  for (const s of states) {
    const job = jobBy.get(s.jobId)
    if (!job) continue
    const parent = parentBy.get(job.parent_id as string)
    const contact = contactBy.get(s.jobId)
    const teamPosted = !!parent?.is_team_account
    // A team-posted tuition belongs to the real parent recorded with it; an
    // ordinary tuition to the account that posted it.
    const rawPhone = teamPosted ? contact?.contact_whatsapp || contact?.contact_phone || null : parent?.whatsapp || parent?.phone_number || null
    const msisdn = normalisePkMobile(rawPhone)
    const city = (job.city as string | null) ?? null
    const area = (job.area as string | null) ?? null

    const cardTutors: ForwardTutor[] = s.tutors.map((t) => {
      const p = profileBy.get(t.tutorId)
      const tp = tpBy.get(t.tutorId)
      const plan = planBy.get(t.tutorId) ?? null
      const badges: BadgeName[] = []
      if (verifiedOk.has(t.tutorId)) badges.push('Verified')
      if (plan === 'premium' || plan === 'featured') badges.push('Premium')
      if (plan === 'featured') badges.push('Featured')
      const path = tutorPath(tp?.slug)
      return {
        id: t.tutorId,
        name: formatName(p?.full_name) || 'Unnamed tutor',
        avatarUrl: (p?.profile_pic_status ?? '').toLowerCase() === 'rejected' ? null : (p?.avatar_url ?? null),
        gender: tp?.gender ?? null,
        badges,
        subjects: namesFor(tutorSubjectIds.get(t.tutorId) ?? []),
        experienceYears: tp?.experience_years ?? null,
        city: tp?.city ?? null,
        area: tp?.area ?? null,
        profileUrl: path ? absoluteUrl(path) : null,
        kind: t.kind,
        at: t.at,
        alreadySent: t.alreadySent,
      }
    })

    cards.push({
      jobId: s.jobId,
      ref: (job.ref_id as string | null) ?? null,
      title: (job.title as string | null) ?? 'Tuition',
      level: (job.class_level as string | null) ?? null,
      subjects: namesFor(jobSubjectIds.get(s.jobId) ?? []),
      area: areaWithoutCity(area, city) || area,
      city,
      place: placeLabel(area, city),
      postedAt: job.created_at as string,
      status: (job.status as string | null) ?? 'open',
      publicUrl: tuitionPath({ public_slug: (job.public_slug as string | null) ?? null, city }),
      parent: {
        name: teamPosted ? (contact?.contact_name ?? null) : formatName(parent?.full_name) || null,
        msisdn,
        phoneLabel: rawPhone,
        teamPosted,
      },
      tutors: cardTutors,
      state: {
        tab: s.tab,
        newTutorIds: s.newTutorIds,
        newApplicant: s.newApplicant,
        checkWithParent: s.checkWithParent,
        lastForward: s.lastForward,
        lastOutcome: s.lastOutcome,
      },
    })
  }

  return {
    cards,
    counts: forwardCounts(states, events, paid),
    template: ((tpl.data?.body as string | null) ?? '').trim() || APPLICANTS_FORWARD_DEFAULT,
  }
}

// ----------------------------------------------------------------- writes ----

type WriteResult = { ok: true } | { ok: false; status: 400 | 404 | 503; error: string }

async function staffName(admin: Admin, actor: AdminActor): Promise<string | null> {
  const { data } = await admin.from('profiles').select('full_name').eq('id', actor.id).maybeSingle()
  return formatName(data?.full_name as string | null) || null
}

/** "Mark as forwarded": when, who, the channel, and which tutors were included. */
export async function recordForward(args: { actor: AdminActor; jobId: string; channel: 'whatsapp' | 'call' | 'other'; tutorIds: string[] }): Promise<WriteResult> {
  const admin = createAdminClient()
  if (!admin) return { ok: false, status: 503, error: 'This is not working right now. Please try again in a few minutes.' }
  const { states } = await loadStates(admin)
  const state = states.find((s) => s.jobId === args.jobId)
  if (!state) return { ok: false, status: 404, error: 'That tuition has no paid applicants to forward. Reload the page.' }
  // Only tutors who are on the card (paid, and interested in THIS tuition).
  const tutorIds = validForwardTutorIds(state, args.tutorIds)
  if (tutorIds.length === 0) return { ok: false, status: 400, error: 'Choose at least one tutor to include.' }

  const name = await staffName(admin, args.actor)
  const { data, error } = await admin
    .from('applicant_forwards')
    .insert({ job_id: args.jobId, channel: args.channel, tutor_ids: tutorIds, staff_id: args.actor.id, staff_email: args.actor.email, staff_name: name })
    .select('id')
    .single()
  if (error) return { ok: false, status: 400, error: 'That did not save. Please try again.' }

  await logAdminAction({
    actorId: args.actor.id,
    actorRole: args.actor.adminRole,
    actorEmail: args.actor.email,
    action: 'applicants.forward',
    targetType: 'job',
    targetId: args.jobId,
    detail: { forwardId: data.id, channel: args.channel, tutorIds, tutorCount: tutorIds.length },
  })
  return { ok: true }
}

/** The outcome of a forward: hired / demo arranged / not interested / no answer. */
export async function recordOutcome(args: { actor: AdminActor; jobId: string; outcome: OutcomeKind; tutorId: string | null; note: string | null }): Promise<WriteResult> {
  const admin = createAdminClient()
  if (!admin) return { ok: false, status: 503, error: 'This is not working right now. Please try again in a few minutes.' }
  const { states } = await loadStates(admin)
  const state = states.find((s) => s.jobId === args.jobId)
  if (!state || !state.lastForward) return { ok: false, status: 400, error: 'Mark the tuition as forwarded first, then record what the parent said.' }
  let tutorId: string | null = null
  if (OUTCOME_NEEDS_TUTOR[args.outcome]) {
    tutorId = validForwardTutorIds(state, args.tutorId ? [args.tutorId] : [])[0] ?? null
    if (!tutorId) return { ok: false, status: 400, error: 'Choose which tutor.' }
  }
  const note = (args.note ?? '').trim().slice(0, 500) || null
  const name = await staffName(admin, args.actor)
  const { data, error } = await admin
    .from('applicant_forward_outcomes')
    .insert({ job_id: args.jobId, outcome: args.outcome, tutor_id: tutorId, note, staff_id: args.actor.id, staff_email: args.actor.email, staff_name: name })
    .select('id')
    .single()
  if (error) return { ok: false, status: 400, error: 'That did not save. Please try again.' }

  await logAdminAction({
    actorId: args.actor.id,
    actorRole: args.actor.adminRole,
    actorEmail: args.actor.email,
    action: 'applicants.outcome',
    targetType: 'job',
    targetId: args.jobId,
    detail: { outcomeId: data.id, outcome: args.outcome, tutorId, hasNote: !!note },
  })
  return { ok: true }
}
