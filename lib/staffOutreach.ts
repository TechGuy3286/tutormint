// lib/staffOutreach.ts
//
// Server I/O for the two staff outreach tabs under Admin → People (owner,
// 8 Oct 2026): Unpaid signups and Featured WhatsApp. The rules live in the pure
// lib/staffOutreachCore.ts. Service role; every route that calls this checks
// SCREEN_ACCESS.unpaidSignups / featuredWhatsapp first.

import { pageAll, pageAllIn } from '@/lib/pageAll'
import 'server-only'

import { createAdminClient } from '@/lib/supabase/admin'
import { logAdminAction } from '@/lib/auditLog'
import type { AdminRole } from '@/lib/adminAuth'
import { stoppedAtByTutor } from '@/lib/onboardingStop'
import { normalisePkMobile } from '@/lib/phone'
import { tuitionPath } from '@/lib/slugs'
import { absoluteUrl } from '@/lib/siteUrl'
import { formatName } from '@/lib/formatName'
import {
  CONTACT_OUTCOMES,
  FEATURED_FIRST_LOOKBACK_DAYS,
  FEATURED_MAX_TUITIONS,
  UNPAID_WINDOW_DAYS,
  featuredCutoff,
  featuredMessage,
  firstNameOf,
  isTestName,
  tutorMatchesJob,
  unpaidHelpMessage,
  waLink,
  type ContactOutcome,
} from '@/lib/staffOutreachCore'

type Actor = { id: string; adminRole: AdminRole; email?: string | null }

// ======================================================== Unpaid signups

export type UnpaidRow = {
  id: string
  name: string
  city: string | null
  joinedAt: string
  stoppedAt: string | null
  completion: number
  msisdn: string | null
  waHref: string | null
  telHref: string | null
  lastContact: { outcome: ContactOutcome; note: string | null; staffEmail: string | null; at: string } | null
}

/** Tutors who signed up in the last 30 days and have not paid the
 *  Verification Fee — newest first, paused (suspended/banned) and test accounts out. */
export async function loadUnpaidSignups(now = new Date()): Promise<UnpaidRow[]> {
  const admin = createAdminClient()
  if (!admin) return []
  const since = new Date(now.getTime() - UNPAID_WINDOW_DAYS * 86_400_000).toISOString()
  const profiles = await pageAll((from, to) =>
    admin
      .from('profiles')
      .select('id, full_name, city, created_at, profile_completion, phone_number, whatsapp, is_suspended, is_banned, is_seed, is_team_account, admin_role')
      .eq('role', 'tutor')
      .gte('created_at', since)
      .order('created_at', { ascending: false })
      .order('id')
      .range(from, to),
  )
  const candidates = profiles.filter(
    // Staff accounts (any admin_role) are TutorMint's own people, not leads.
    (p) => !p.is_suspended && !p.is_banned && !p.is_seed && !p.is_team_account && !p.admin_role && !isTestName(p.full_name as string | null),
  )
  const ids = candidates.map((p) => p.id as string)
  if (ids.length === 0) return []
  const [{ data: tps }, { data: logs }, stopped] = await Promise.all([
    admin.from('tutor_profiles').select('id, city, verified_fee_paid_at').in('id', ids),
    admin
      .from('tutor_contact_logs')
      .select('tutor_id, outcome, note, staff_email, created_at')
      .in('tutor_id', ids)
      .order('created_at', { ascending: false }),
    stoppedAtByTutor(admin, ids),
  ])
  const tp = new Map((tps ?? []).map((t) => [t.id as string, t]))
  const last = new Map<string, UnpaidRow['lastContact']>()
  for (const l of logs ?? []) {
    const k = l.tutor_id as string
    if (last.has(k)) continue // newest first
    last.set(k, {
      outcome: l.outcome as ContactOutcome,
      note: (l.note as string | null) ?? null,
      staffEmail: (l.staff_email as string | null) ?? null,
      at: l.created_at as string,
    })
  }
  const out: UnpaidRow[] = []
  for (const p of candidates) {
    const t = tp.get(p.id as string)
    if (!t || t.verified_fee_paid_at) continue // paid (or no tutor row)
    const name = formatName(p.full_name as string | null) || '—'
    const stoppedAt = stopped.get(p.id as string) ?? null
    const msisdn = normalisePkMobile((p.whatsapp as string | null) || (p.phone_number as string | null))
    out.push({
      id: p.id as string,
      name,
      city: (t.city as string | null) || (p.city as string | null) || null,
      joinedAt: p.created_at as string,
      stoppedAt,
      completion: (p.profile_completion as number | null) ?? 0,
      msisdn,
      waHref: msisdn ? waLink(msisdn, unpaidHelpMessage(firstNameOf(name), stoppedAt)) : null,
      telHref: msisdn ? `tel:+${msisdn}` : null,
      lastContact: last.get(p.id as string) ?? null,
    })
  }
  return out
}

/** Record one call/WhatsApp outcome for a tutor. Audited; on the tutor's file. */
export async function logContact(
  tutorId: string,
  outcome: ContactOutcome,
  note: string | null,
  actor: Actor,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const admin = createAdminClient()
  if (!admin) return { ok: false, error: 'This is not working right now. Please try again in a few minutes.' }
  if (!CONTACT_OUTCOMES.includes(outcome)) return { ok: false, error: 'Choose what happened on the call.' }
  const { data: tutor } = await admin.from('profiles').select('id, role').eq('id', tutorId).maybeSingle()
  if (!tutor || tutor.role !== 'tutor') return { ok: false, error: 'That tutor was not found.' }
  const clean = (note ?? '').trim().slice(0, 1000) || null
  const { error } = await admin.from('tutor_contact_logs').insert({
    tutor_id: tutorId,
    outcome,
    note: clean,
    staff_id: actor.id,
    staff_email: actor.email ?? null,
  })
  if (error) return { ok: false, error: 'That did not save. Please try again.' }
  await logAdminAction({
    actorId: actor.id,
    actorRole: actor.adminRole,
    actorEmail: actor.email ?? null,
    action: 'outreach.contact_logged',
    targetType: 'profile',
    targetId: tutorId,
    detail: { outcome, hasNote: !!clean },
  })
  return { ok: true }
}

// ===================================================== Featured WhatsApp

export type FeaturedMatch = { jobId: string; refId: string | null; title: string; area: string | null; city: string | null; url: string }

export type FeaturedRow = {
  tutorId: string
  name: string
  city: string | null
  msisdn: string | null
  matches: FeaturedMatch[]
  lastSent: { at: string; byEmail: string | null } | null
}

type JobRow = {
  id: string
  ref_id: string | null
  title: string | null
  city: string | null
  area: string | null
  teaching_mode: string | null
  gender_preference: string | null
  public_slug: string | null
  created_at: string
}

/**
 * Featured tutors and their new matching open tuitions: posted after the
 * tutor's last WhatsApp send (or in the 7 days before today's list) and up to
 * the day's 10:00 PKT cut-off, never already sent to them. Includes tutors with
 * nothing new (matches = []) so the page can show "sent today"; the page hides
 * the empty ones from the to-send list.
 */
export async function loadFeaturedWhatsapp(now = new Date()): Promise<{ cutoff: string; rows: FeaturedRow[] }> {
  const cutoff = featuredCutoff(now)
  const admin = createAdminClient()
  if (!admin) return { cutoff: cutoff.toISOString(), rows: [] }

  const { data: subs } = await admin
    .from('subscriptions')
    .select('user_id')
    .eq('status', 'active')
    .eq('plan_code', 'featured')
    .gt('expires_at', now.toISOString())
  const featuredIds = [...new Set((subs ?? []).map((s) => s.user_id as string))]
  if (featuredIds.length === 0) return { cutoff: cutoff.toISOString(), rows: [] }

  // Only tutors the platform is showing (the email alerts' rule).
  const [{ data: dir }, { data: profs }, { data: tsub }, { data: sends }] = await Promise.all([
    admin.from('tutor_directory').select('id, city, job_types, gender').in('id', featuredIds),
    admin.from('profiles').select('id, full_name, phone_number, whatsapp').in('id', featuredIds),
    admin.from('tutor_subjects').select('tutor_id, master_id').in('tutor_id', featuredIds),
    admin
      .from('featured_whatsapp_sends')
      .select('tutor_id, job_id, sent_at, sent_by_email')
      .in('tutor_id', featuredIds)
      .order('sent_at', { ascending: false }),
  ])
  const listed = (dir ?? []) as { id: string; city: string | null; job_types: string[] | null; gender: string | null }[]
  if (listed.length === 0) return { cutoff: cutoff.toISOString(), rows: [] }

  const prof = new Map((profs ?? []).map((p) => [p.id as string, p]))
  const subjects = new Map<string, number[]>()
  for (const r of tsub ?? []) {
    const k = r.tutor_id as string
    subjects.set(k, [...(subjects.get(k) ?? []), r.master_id as number])
  }
  const sentJobs = new Map<string, Set<string>>()
  const lastSent = new Map<string, { at: string; byEmail: string | null }>()
  for (const s of sends ?? []) {
    const k = s.tutor_id as string
    if (!sentJobs.has(k)) sentJobs.set(k, new Set())
    sentJobs.get(k)!.add(s.job_id as string)
    if (!lastSent.has(k)) lastSent.set(k, { at: s.sent_at as string, byEmail: (s.sent_by_email as string | null) ?? null })
  }

  // Candidate tuitions: open, posted before today's cut-off and inside the
  // widest look-back any tutor needs.
  const earliest = new Date(cutoff.getTime() - FEATURED_FIRST_LOOKBACK_DAYS * 86_400_000).toISOString()
  const jobs = await pageAll((from, to) =>
    admin
      .from('jobs')
      .select('id, ref_id, title, city, area, teaching_mode, gender_preference, public_slug, created_at')
      .eq('status', 'open')
      .gt('created_at', earliest)
      .lte('created_at', cutoff.toISOString())
      .order('created_at', { ascending: false })
      .order('id')
      .range(from, to),
  )
  const jobList = jobs as JobRow[]
  const jobIds = jobList.map((j) => j.id)
  const jsub = await pageAllIn(jobIds, (ids, from, to) =>
    admin.from('job_subjects').select('job_id, master_id').in('job_id', ids).order('job_id').order('master_id').range(from, to),
  )
  const jobMasters = new Map<string, number[]>()
  for (const r of jsub) {
    const k = r.job_id as string
    jobMasters.set(k, [...(jobMasters.get(k) ?? []), r.master_id as number])
  }

  const rows: FeaturedRow[] = listed.map((t) => {
    const p = prof.get(t.id)
    const since = lastSent.get(t.id)?.at ?? earliest
    const already = sentJobs.get(t.id) ?? new Set<string>()
    const tutor = { masterIds: subjects.get(t.id) ?? [], city: t.city, jobTypes: t.job_types, gender: t.gender }
    const matches = jobList
      .filter((j) => j.created_at > since && !already.has(j.id))
      .filter((j) =>
        tutorMatchesJob(
          { masterIds: jobMasters.get(j.id) ?? [], city: j.city, jobType: j.teaching_mode, genderPreference: j.gender_preference },
          tutor,
        ),
      )
      .slice(0, FEATURED_MAX_TUITIONS)
      .map((j) => ({
        jobId: j.id,
        refId: j.ref_id,
        title: (j.title ?? '').trim() || 'Tuition',
        area: j.area,
        city: j.city,
        url: absoluteUrl(tuitionPath({ public_slug: j.public_slug, city: j.city, id: j.id })),
      }))
    return {
      tutorId: t.id,
      name: formatName((p?.full_name as string | null) ?? null) || '—',
      city: t.city,
      msisdn: normalisePkMobile(((p?.whatsapp as string | null) || (p?.phone_number as string | null)) ?? null),
      matches,
      lastSent: lastSent.get(t.id) ?? null,
    }
  })
  return { cutoff: cutoff.toISOString(), rows }
}

/**
 * Record a Featured WhatsApp send BEFORE the message opens, so two staff can
 * never send the same tuitions: the (tutor, tuition) pair is UNIQUE, and a pair
 * someone else already recorded makes the whole send refuse with who sent it.
 */
export async function recordFeaturedSend(
  tutorId: string,
  jobIds: string[],
  actor: Actor,
): Promise<{ ok: true; href: string; sentAt: string } | { ok: false; error: string; status: number }> {
  const admin = createAdminClient()
  if (!admin) return { ok: false, error: 'This is not working right now. Please try again in a few minutes.', status: 503 }
  const { rows } = await loadFeaturedWhatsapp()
  const row = rows.find((r) => r.tutorId === tutorId)
  if (!row) return { ok: false, error: 'That tutor is not a listed Featured tutor.', status: 404 }
  if (!row.msisdn) return { ok: false, error: 'This tutor has no WhatsApp number on file.', status: 400 }
  const current = new Set(row.matches.map((m) => m.jobId))
  const wanted = [...new Set(jobIds)].filter((id) => current.has(id))
  if (wanted.length === 0) {
    const by = row.lastSent ? ` Sent ${row.lastSent.at} by ${row.lastSent.byEmail ?? 'a staff member'}.` : ''
    return { ok: false, error: `These tuitions were already sent to this tutor.${by}`, status: 409 }
  }

  const sentAt = new Date().toISOString()
  const { data: inserted, error } = await admin
    .from('featured_whatsapp_sends')
    .upsert(
      wanted.map((job_id) => ({ tutor_id: tutorId, job_id, sent_by: actor.id, sent_by_email: actor.email ?? null, sent_at: sentAt })),
      { onConflict: 'tutor_id,job_id', ignoreDuplicates: true },
    )
    .select('job_id')
  if (error) return { ok: false, error: 'That did not save. Please try again.', status: 500 }
  const got = new Set((inserted ?? []).map((r) => r.job_id as string))
  if (got.size === 0) return { ok: false, error: 'Another staff member has just sent these tuitions to this tutor.', status: 409 }

  const sendNow = row.matches.filter((m) => got.has(m.jobId))
  await logAdminAction({
    actorId: actor.id,
    actorRole: actor.adminRole,
    actorEmail: actor.email ?? null,
    action: 'outreach.featured_whatsapp_sent',
    targetType: 'profile',
    targetId: tutorId,
    detail: { tuitions: sendNow.map((m) => m.refId ?? m.jobId) },
  })
  return { ok: true, href: waLink(row.msisdn, featuredMessage(firstNameOf(row.name), sendNow)), sentAt }
}
