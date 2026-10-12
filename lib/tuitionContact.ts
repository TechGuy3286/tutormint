// lib/tuitionContact.ts
//
// A tuition must always have the parent's contact number (owner, 12 Oct 2026) —
// the I/O half (rules: lib/tuitionContactCore).
//
//   contactFactsForJobs      what number each tuition has (staff-posted: the
//                            job_contacts row; parent-posted: the parent's own
//                            verified mobile) — read by every resume path.
//   saveTuitionContactNumber staff add or change the number on a STAFF-posted
//                            tuition, and may resume it in the same step (a
//                            fresh 7 days, same address). Audited.
//
// The number is stored in job_contacts (never on the anon-readable jobs row),
// in the one MSISDN format of lib/phone.ts. Nothing is deleted.

import 'server-only'

import { createAdminClient } from '@/lib/supabase/admin'
import { logAdminAction } from '@/lib/auditLog'
import type { AdminActor } from '@/lib/adminAuth'
import { pageAllIn } from '@/lib/pageAll'
import { queueIndexingUpdate } from '@/lib/googleIndexing'
import { revalidateLanding } from '@/lib/landingRevalidate'
import { NO_CONTACT_SOURCE, parseContactNumber, tuitionContactNumber, type TuitionContactFacts } from '@/lib/tuitionContactCore'

type Admin = NonNullable<ReturnType<typeof createAdminClient>>

/** The contact facts of each tuition, keyed by job id. */
export async function contactFactsForJobs(admin: Admin, jobs: { id: string; parent_id: string | null }[]): Promise<Map<string, TuitionContactFacts>> {
  const ids = jobs.map((j) => j.id)
  const parentIds = [...new Set(jobs.map((j) => j.parent_id).filter((v): v is string => !!v))]
  const [contacts, parents] = await Promise.all([
    pageAllIn<{ job_id: string; contact_phone: string | null; contact_whatsapp: string | null }, string>(ids, (part, from, to) =>
      admin.from('job_contacts').select('job_id, contact_phone, contact_whatsapp').in('job_id', part).order('job_id').range(from, to),
    ),
    pageAllIn<{ id: string; is_team_account: boolean | null; phone_number: string | null; phone_verified_at: string | null }, string>(parentIds, (part, from, to) =>
      admin.from('profiles').select('id, is_team_account, phone_number, phone_verified_at').in('id', part).order('id').range(from, to),
    ),
  ])
  const contactBy = new Map(contacts.map((c) => [c.job_id, c]))
  const parentBy = new Map(parents.map((p) => [p.id, p]))
  const out = new Map<string, TuitionContactFacts>()
  for (const j of jobs) {
    const p = j.parent_id ? parentBy.get(j.parent_id) : undefined
    const c = contactBy.get(j.id)
    out.set(j.id, {
      isTeam: !!p?.is_team_account,
      contactPhone: c?.contact_phone ?? null,
      contactWhatsapp: c?.contact_whatsapp ?? null,
      parentPhone: p?.phone_number ?? null,
      parentPhoneVerifiedAt: p?.phone_verified_at ?? null,
    })
  }
  return out
}

/** The ids of these tuitions that have NO valid contact number. */
export async function jobsWithoutContactNumber(admin: Admin, jobs: { id: string; parent_id: string | null }[]): Promise<Set<string>> {
  const facts = await contactFactsForJobs(admin, jobs)
  return new Set(jobs.filter((j) => tuitionContactNumber(facts.get(j.id) ?? { isTeam: false }) === null).map((j) => j.id))
}

export type SaveNumberResult =
  | { ok: true; msisdn: string; resumed: boolean; canResume: boolean }
  | { ok: false; status: 400 | 404 | 503; error: string }

/**
 * Save the parent's contact number on a staff-posted tuition. With `resume`, a
 * tuition paused for having no number goes live again in the same step: a fresh
 * 7 days, the same address, Google told. `canResume` says the tuition is paused
 * for no number and could be resumed now (the "Resume now" offer).
 */
export async function saveTuitionContactNumber(args: { actor: AdminActor; jobId: string; phone: string; resume?: boolean }): Promise<SaveNumberResult> {
  const parsed = parseContactNumber(args.phone)
  if (!parsed.ok) return { ok: false, status: 400, error: parsed.error }
  const admin = createAdminClient()
  if (!admin) return { ok: false, status: 503, error: 'This is not working right now. Please try again in a few minutes.' }

  const { data: job } = await admin.from('jobs').select('id, ref_id, job_tx_id, title, status, pause_source, parent_id, public_slug, city').eq('id', args.jobId).maybeSingle()
  if (!job) return { ok: false, status: 404, error: 'That tuition was not found.' }
  const { data: poster } = await admin.from('profiles').select('is_team_account').eq('id', job.parent_id as string).maybeSingle()
  if (!poster?.is_team_account) {
    return { ok: false, status: 400, error: "This tuition was posted by a parent. It uses the parent's own verified mobile, so there is no number to add here." }
  }

  const { data: had } = await admin.from('job_contacts').select('job_id, contact_phone').eq('job_id', args.jobId).maybeSingle()
  const write = had
    ? await admin.from('job_contacts').update({ contact_phone: parsed.msisdn }).eq('job_id', args.jobId)
    : await admin.from('job_contacts').insert({ job_id: args.jobId, contact_phone: parsed.msisdn, created_by: args.actor.id })
  if (write.error) return { ok: false, status: 400, error: 'That did not save. Please try again.' }

  const pausedForNumber = job.status === 'paused' && job.pause_source === NO_CONTACT_SOURCE
  let resumed = false
  if (args.resume && pausedForNumber) {
    const now = new Date().toISOString()
    const { data: back } = await admin
      .from('jobs')
      .update({ status: 'open', resumed_at: now, bumped_at: now, paused_at: null, self_paused_at: null, pause_source: null })
      .eq('id', args.jobId)
      .eq('status', 'paused')
      .select('id')
    resumed = (back ?? []).length === 1
    if (resumed) {
      queueIndexingUpdate({ public_slug: (job.public_slug as string | null) ?? null, city: (job.city as string | null) ?? null })
      revalidateLanding()
    }
  }

  await logAdminAction({
    actorId: args.actor.id,
    actorRole: args.actor.adminRole,
    actorEmail: args.actor.email,
    action: 'job.contact_number',
    targetType: 'job',
    targetId: args.jobId,
    // The number itself is not written to the audit log — only that it was set.
    detail: { refId: job.ref_id ?? null, jobTxId: job.job_tx_id ?? null, title: job.title, hadNumber: !!had?.contact_phone, resumed },
  })
  if (resumed) {
    await logAdminAction({
      actorId: args.actor.id,
      actorRole: args.actor.adminRole,
      actorEmail: args.actor.email,
      action: 'job.resume',
      targetType: 'job',
      targetId: args.jobId,
      detail: { refId: job.ref_id ?? null, jobTxId: job.job_tx_id ?? null, title: job.title, from: 'contact-number-added' },
    })
  }
  return { ok: true, msisdn: parsed.msisdn, resumed, canResume: pausedForNumber && !resumed }
}
