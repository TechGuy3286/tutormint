// lib/onboardingStop.ts
//
// Batch loader for Admin → People's "Stopped at: <step>" (hotfix, 7 Oct 2026).
// Reads, for a page of tutors, exactly the facts the live onboarding
// (components/tutor/NewOnboardingFlow.tsx `load` + `flowFacts`) reads, and asks
// the shared stepDone() rule which step comes first. Service role (admin only).

import type { SupabaseClient } from '@supabase/supabase-js'
import { availabilityToSlots } from '@/lib/timeSlots'
import { stoppedAtLabel, stoppedAtStep } from '@/lib/onboardingStopCore'
import type { FlowFacts } from '@/lib/tutorFlow'
import { missingSummary } from '@/lib/onboarding/missingItems'
import { chunk, pageAllIn } from '@/lib/pageAll'

export type TutorFlowState = {
  facts: FlowFacts
  /** "Stopped at: <step>", or null when every step is done. */
  stoppedAt: string | null
  /** The same stop as a key (lib/onboardingStopCore stoppedAtStep). */
  stoppedStep: ReturnType<typeof stoppedAtStep>
  /** What is still to do, in plain English (lib/onboarding/missingItems). */
  missing: string[]
}

export async function stoppedAtByTutor(admin: SupabaseClient, ids: string[]): Promise<Map<string, string>> {
  const out = new Map<string, string>()
  for (const [id, s] of await flowStateByTutor(admin, ids)) if (s.stoppedAt) out.set(id, s.stoppedAt)
  return out
}

/** The flow facts, the stopped-at label and the missing-items list for a page
 *  of tutors — one read, so the three can never disagree (owner, 13 Oct 2026). */
export async function flowStateByTutor(admin: SupabaseClient, ids: string[]): Promise<Map<string, TutorFlowState>> {
  const out = new Map<string, TutorFlowState>()
  if (ids.length === 0) return out
  const all = await flowFactsByTutor(admin, ids)
  const unconfirmed = await unconfirmedEmails(admin, new Set(ids))
  for (const [id, facts] of all) {
    out.set(id, {
      facts,
      stoppedAt: stoppedAtLabel(facts, { emailConfirmed: !unconfirmed.has(id) }),
      stoppedStep: stoppedAtStep(facts, { emailConfirmed: !unconfirmed.has(id) }),
      missing: missingSummary(facts).missing.map((m) => m.label),
    })
  }
  return out
}

/**
 * The onboarding facts for any number of tutors, read in chunks and PAGED past
 * the 1,000-row cap (lib/pageAll). Before 15 Oct 2026 this read every
 * tutor_subjects row for up to 80 tutors in ONE request: a few tutors with
 * 40–56 subjects filled the 1,000 rows and everyone else read as having no
 * subjects — so Admin showed "Stopped at: Subjects" for tutors who had chosen
 * theirs. Subjects are now COUNTED per tutor (head count), so a long list can
 * never crowd anyone out.
 */
export async function flowFactsByTutor(admin: SupabaseClient, ids: string[]): Promise<Map<string, FlowFacts>> {
  const out = new Map<string, FlowFacts>()
  const unique = [...new Set(ids)]
  if (unique.length === 0) return out
  const [ps, tps, docs] = await Promise.all([
    pageAllIn(unique, (part, from, to) =>
      admin.from('profiles').select('id, full_name, city, phone_verified_at, whatsapp, cnic_number').in('id', part).order('id').range(from, to),
    ),
    pageAllIn(unique, (part, from, to) =>
      admin
        .from('tutor_profiles')
        .select('id, city, area, gender, avatar_url, headline, bio, experience_years, fee_min_pkr, job_types, degrees, availability_list, verified_fee_paid_at')
        .in('id', part)
        .order('id')
        .range(from, to),
    ),
    pageAllIn(unique, (part, from, to) =>
      admin.from('user_documents').select('id, user_id, kind, label').in('user_id', part).in('kind', ['selfie', 'cnic']).order('id').range(from, to),
    ),
  ])
  const subjCount = new Map<string, number>()
  for (const part of chunk(unique, 20)) {
    await Promise.all(
      part.map(async (id) => {
        const { count } = await admin.from('tutor_subjects').select('tutor_id', { count: 'exact', head: true }).eq('tutor_id', id)
        subjCount.set(id, count ?? 0)
      }),
    )
  }
  const tpById = new Map(tps.map((t) => [t.id as string, t]))
  const docsBy = new Map<string, { kind: string; label: string | null }[]>()
  for (const d of docs) {
    const k = d.user_id as string
    if (!docsBy.has(k)) docsBy.set(k, [])
    docsBy.get(k)!.push({ kind: d.kind as string, label: (d.label as string | null) ?? null })
  }

  for (const p of ps) {
    const id = p.id as string
    const tp = tpById.get(id)
    if (!tp) continue
    const d = docsBy.get(id) ?? []
    const degrees = Array.isArray(tp.degrees) ? (tp.degrees as unknown[]) : []
    const facts = {
      fullName: (p.full_name as string) ?? null,
      gender: (tp.gender as string) ?? null,
      city: (tp.city as string) ?? (p.city as string) ?? null,
      area: (tp.area as string) ?? null,
      avatarUrl: (tp.avatar_url as string) ?? null,
      headline: (tp.headline as string) ?? null,
      bio: (tp.bio as string) ?? null,
      experienceYears: (tp.experience_years as number | null) ?? null,
      hourlyRate: (tp.fee_min_pkr as number | null) ?? null,
      jobTypes: (tp.job_types as string[] | null) ?? [],
      degreesCount: degrees.filter((x) => x && typeof x === 'object').length || degrees.length,
      degreeDocCount: 0,
      degrees,
      cnicNumber: (p.cnic_number as string) ?? null,
      cnicImagePath: d.some((x) => x.kind === 'cnic' && x.label === 'front') && d.some((x) => x.kind === 'cnic' && x.label === 'back') ? 'y' : null,
      subjectCount: subjCount.get(id) ?? 0,
      selfieDone: d.some((x) => x.kind === 'selfie'),
      availabilityCount: availabilityToSlots(tp.availability_list).length,
      phoneVerified: !!p.phone_verified_at,
      whatsapp: (p.whatsapp as string) ?? null,
      feePaid: !!tp.verified_fee_paid_at,
      noDegreeYet: false,
      isSeed: false, isTeamAccount: false, isBanned: false, isSuspended: false, underReview: false,
      verificationStatus: null, imported: false, claimedAt: null,
    } satisfies FlowFacts
    out.set(id, facts)
  }
  return out
}

/** Ids (of `want`) whose auth email was never confirmed — an email signup that
 *  never clicked its link. Read through the Auth admin API, page by page. A
 *  failure reads as "confirmed", so a hiccup never invents a stop. */
async function unconfirmedEmails(admin: SupabaseClient, want: Set<string>): Promise<Set<string>> {
  const out = new Set<string>()
  if (want.size === 0) return out
  for (let page = 1; page <= 50; page++) {
    const { data, error } = await admin.auth.admin.listUsers({ page, perPage: 1000 })
    if (error || !data) break
    for (const u of data.users) if (want.has(u.id) && !u.email_confirmed_at) out.add(u.id)
    if (data.users.length < 1000) break
  }
  return out
}
