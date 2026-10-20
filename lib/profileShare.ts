import 'server-only'

import { createAdminClient } from '@/lib/supabase/admin'
import { pageAllIn } from '@/lib/pageAll'
import { directoryBlockers } from '@/lib/tutorListingStatus'
import { profileShareState, type ProfileShare } from '@/lib/profileShareCore'

// The "Copy profile link" state for many tutors at once (owner, 20 Oct 2026):
// three batched reads for a whole admin list, then the pure rule in
// lib/profileShareCore. "Listed" is read from the tutor_directory view itself
// (the same source as listedTutorIds), the reasons from the directory mirror.

export async function loadProfileShares(ids: string[]): Promise<Map<string, ProfileShare>> {
  const out = new Map<string, ProfileShare>()
  const admin = createAdminClient()
  const unique = Array.from(new Set(ids.filter(Boolean)))
  if (!admin || unique.length === 0) return out

  type P = Record<string, unknown> & { id: string }
  const [profiles, tutors, listed] = await Promise.all([
    pageAllIn<P, string>(unique, (part, from, to) =>
      admin
        .from('profiles')
        .select('id, role, is_suspended, is_banned, is_seed, is_team_account, is_test_name, hidden_from_public, paused_by_user_at, verification_state, profile_pic_status, selfie_status')
        .in('id', part)
        .order('id')
        .range(from, to) as unknown as Promise<{ data: P[] | null; error: { message: string } | null }>,
    ),
    pageAllIn<P, string>(unique, (part, from, to) =>
      admin
        .from('tutor_profiles')
        .select('id, slug, under_review, verification_status, imported, claimed_at')
        .in('id', part)
        .order('id')
        .range(from, to) as unknown as Promise<{ data: P[] | null; error: { message: string } | null }>,
    ),
    pageAllIn<P, string>(unique, (part, from, to) =>
      admin.from('tutor_directory').select('id').in('id', part).order('id').range(from, to) as unknown as Promise<{
        data: P[] | null
        error: { message: string } | null
      }>,
    ),
  ])
  const prof = new Map(profiles.map((p) => [p.id, p]))
  const inDir = new Set(listed.map((r) => r.id))
  for (const tp of tutors) {
    const p = prof.get(tp.id)
    if (!p || p.role !== 'tutor') continue
    const lower = (v: unknown) => String(v ?? '').toLowerCase()
    const blockers = directoryBlockers({
      role: (p.role as string | null) ?? null,
      hiddenFromPublic: (p.hidden_from_public as boolean | null) ?? null,
      isTestName: (p.is_test_name as boolean | null) ?? null,
      pausedByUser: !!p.paused_by_user_at,
      isSuspended: p.is_suspended as boolean | null,
      isBanned: p.is_banned as boolean | null,
      underReview: tp.under_review as boolean | null,
      verificationStatus: tp.verification_status as string | null,
      imported: tp.imported as boolean | null,
      claimedAt: tp.claimed_at as string | null,
      isSeed: p.is_seed as boolean | null,
      isTeamAccount: p.is_team_account as boolean | null,
      cnicRejected: lower(p.verification_state) === 'rejected',
      photoRejected: lower(p.profile_pic_status) === 'rejected',
      selfieRejected: lower(p.selfie_status) === 'rejected',
    } as Parameters<typeof directoryBlockers>[0])
    out.set(tp.id, profileShareState({ slug: tp.slug as string | null, listed: inDir.has(tp.id), blockers }))
  }
  return out
}
