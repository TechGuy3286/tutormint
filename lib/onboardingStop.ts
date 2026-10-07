// lib/onboardingStop.ts
//
// Batch loader for Admin → People's "Stopped at: <step>" (hotfix, 7 Oct 2026).
// Reads, for a page of tutors, exactly the facts the live onboarding
// (components/tutor/NewOnboardingFlow.tsx `load` + `flowFacts`) reads, and asks
// the shared stepDone() rule which step comes first. Service role (admin only).

import type { SupabaseClient } from '@supabase/supabase-js'
import { availabilityToSlots } from '@/lib/timeSlots'
import { stoppedAtLabel } from '@/lib/onboardingStopCore'
import type { FlowFacts } from '@/lib/tutorFlow'

export async function stoppedAtByTutor(admin: SupabaseClient, ids: string[]): Promise<Map<string, string>> {
  const out = new Map<string, string>()
  if (ids.length === 0) return out
  const [{ data: ps }, { data: tps }, { data: subj }, { data: docs }] = await Promise.all([
    admin.from('profiles').select('id, full_name, city, phone_verified_at, whatsapp, cnic_number').in('id', ids),
    admin
      .from('tutor_profiles')
      .select('id, city, area, gender, avatar_url, headline, bio, experience_years, fee_min_pkr, job_types, degrees, availability_list, verified_fee_paid_at')
      .in('id', ids),
    admin.from('tutor_subjects').select('tutor_id').in('tutor_id', ids),
    admin.from('user_documents').select('user_id, kind, label').in('user_id', ids).in('kind', ['selfie', 'cnic']),
  ])
  const tpById = new Map((tps ?? []).map((t) => [t.id as string, t]))
  const subjCount = new Map<string, number>()
  for (const r of subj ?? []) subjCount.set(r.tutor_id as string, (subjCount.get(r.tutor_id as string) ?? 0) + 1)
  const docsBy = new Map<string, { kind: string; label: string | null }[]>()
  for (const d of docs ?? []) {
    const k = d.user_id as string
    if (!docsBy.has(k)) docsBy.set(k, [])
    docsBy.get(k)!.push({ kind: d.kind as string, label: (d.label as string | null) ?? null })
  }

  for (const p of ps ?? []) {
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
    const label = stoppedAtLabel(facts)
    if (label) out.set(id, label)
  }
  return out
}
