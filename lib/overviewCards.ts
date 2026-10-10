// lib/overviewCards.ts
//
// The member facts each Overview list card shows (owner, 9 Oct 2026): photo or
// initials, name with badges, role, city, joined date, completion %, "Stopped
// at" while onboarding is unfinished, paid / not paid for tutors, and the
// WhatsApp / Call number. Loaded ONCE for a list's member ids, in chunks so a
// long list never hits a URL or 1,000-row limit. Service role, admin only.
//
// This adds facts to rows the list's own loader returned — it never adds or
// drops a row, so the number of cards equals the header count.

import 'server-only'

import { createAdminClient } from '@/lib/supabase/admin'
import { pageAllIn } from '@/lib/pageAll'
import { loadVerifiedBadgeOk } from '@/lib/badgeFacts'
import { stoppedAtByTutor } from '@/lib/onboardingStop'
import { badgesForPlan, type BadgeName } from '@/lib/planBadges'
import { formatName } from '@/lib/formatName'
import { normalisePkMobile } from '@/lib/phone'

export type MemberCardFacts = {
  name: string
  avatarUrl: string | null
  /** Tutors only — picks the default avatar when there is no photo. */
  gender: string | null
  role: 'tutor' | 'parent' | 'other'
  city: string | null
  joinedAt: string | null
  completion: number
  /** Tutors only, while onboarding is unfinished. */
  stoppedAt: string | null
  /** Tutors only: the Verification Fee is paid. Null for parents. */
  paid: boolean | null
  badges: BadgeName[]
  /** Canonical 92… number for wa.me / tel:, WhatsApp first then mobile. */
  msisdn: string | null
}

const CHUNK = 150

function chunks<T>(xs: T[], n = CHUNK): T[][] {
  const out: T[][] = []
  for (let i = 0; i < xs.length; i += n) out.push(xs.slice(i, i + n))
  return out
}

export async function loadMemberCards(ids: string[]): Promise<Map<string, MemberCardFacts>> {
  const out = new Map<string, MemberCardFacts>()
  const admin = createAdminClient()
  const unique = Array.from(new Set(ids.filter(Boolean)))
  if (!admin || unique.length === 0) return out

  const nowIso = new Date().toISOString()
  const [profs, tps, subs] = await Promise.all([
    pageAllIn(unique, (part, from, to) =>
      admin
        .from('profiles')
        .select('id, full_name, avatar_url, role, city, created_at, profile_completion, whatsapp, phone_number')
        .in('id', part)
        .order('id')
        .range(from, to),
    ),
    pageAllIn(unique, (part, from, to) =>
      admin
        .from('tutor_profiles')
        .select('id, city, gender, avatar_url, whatsapp_number, verified_fee_paid_at, onboarded_at')
        .in('id', part)
        .order('id')
        .range(from, to),
    ),
    pageAllIn(unique, (part, from, to) =>
      admin
        .from('subscriptions')
        .select('id, user_id, plan_code')
        .in('user_id', part)
        .eq('status', 'active')
        .gt('expires_at', nowIso)
        .order('id')
        .range(from, to),
    ),
  ])
  const tp = new Map(tps.map((t) => [t.id as string, t]))
  const plan = new Map(subs.map((s) => [s.user_id as string, s.plan_code as string]))

  const tutorIds = profs.filter((p) => p.role === 'tutor').map((p) => p.id as string)
  const verified = new Set<string>()
  const stopped = new Map<string, string>()
  for (const part of chunks(unique)) for (const id of await loadVerifiedBadgeOk(part)) verified.add(id)
  // "Stopped at" only for tutors who have not finished onboarding.
  const unfinished = tutorIds.filter((id) => !tp.get(id)?.onboarded_at)
  // Smaller chunks here: stoppedAtByTutor reads every CNIC/selfie document row
  // in one query, and paused duplicates add up.
  for (const part of chunks(unfinished, 80)) for (const [k, v] of await stoppedAtByTutor(admin, part)) stopped.set(k, v)

  for (const p of profs) {
    const id = p.id as string
    const t = tp.get(id)
    const role = p.role === 'tutor' ? 'tutor' : p.role === 'parent' || p.role === 'academy' ? 'parent' : 'other'
    const ok = verified.has(id)
    const planCode = plan.get(id) ?? (ok ? (role === 'tutor' ? 'basic' : 'parent_verified') : null)
    out.set(id, {
      name: formatName(p.full_name as string | null) || '—',
      avatarUrl: ((t?.avatar_url as string | null) || (p.avatar_url as string | null)) ?? null,
      gender: (t?.gender as string | null) ?? null,
      role,
      city: ((t?.city as string | null) || (p.city as string | null)) ?? null,
      joinedAt: (p.created_at as string | null) ?? null,
      completion: Number(p.profile_completion ?? 0),
      stoppedAt: role === 'tutor' ? (stopped.get(id) ?? null) : null,
      paid: role === 'tutor' ? !!t?.verified_fee_paid_at : null,
      badges: ok ? badgesForPlan(planCode, true, true) : [],
      msisdn: normalisePkMobile(
        (p.whatsapp as string | null) || (t?.whatsapp_number as string | null) || (p.phone_number as string | null),
      ),
    })
  }
  return out
}
