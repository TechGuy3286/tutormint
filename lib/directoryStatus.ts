import 'server-only'

import { createAdminClient } from '@/lib/supabase/admin'
import { directoryBlockers, profileGaps, type ListingBlocker } from '@/lib/tutorListingStatus'

// Server loader for "is this ONE tutor in the public directory, and why not?"
// It fetches exactly the facts the tutor_directory view keys on (migration 87)
// and runs them through the pure `directoryBlockers`, so a surface never says a
// tutor is listed on the strength of the fee flag alone — the fault migration 87
// exists to close. The dashboard uses this; the admin LIST computes the same
// blockers in a batch (no per-row round trip).

/** `blockers` mirror the view (why NOT listed); `gaps` are the step-1 profile
 *  nudges (mobile, subjects, city, area, gender) — never listing reasons. */
export type DirectoryStatus = { listed: boolean; blockers: ListingBlocker[]; gaps: ListingBlocker[] }

export async function loadDirectoryStatus(userId: string): Promise<DirectoryStatus> {
  const admin = createAdminClient()
  if (!admin) return { listed: false, blockers: [], gaps: [] }

  const [{ data: prof }, { data: tp }, { data: subj }] = await Promise.all([
    admin
      .from('profiles')
      .select('role, phone_verified_at, is_suspended, is_banned, is_seed, is_team_account, hidden_from_public, verification_state, profile_pic_status, selfie_status')
      .eq('id', userId)
      .maybeSingle(),
    admin
      .from('tutor_profiles')
      .select('verified_fee_paid_at, city, area, gender, under_review, verification_status, imported, claimed_at')
      .eq('id', userId)
      .maybeSingle(),
    admin.from('tutor_subjects').select('tutor_id').eq('tutor_id', userId).limit(1),
  ])

  // The step-1 completeness items (verified mobile, subjects, city, area, gender)
  // — still what a tutor needs to be FOUND ON GOOGLE and to earn their badge and
  // start their plan (PR89), now surfaced as a nudge rather than a listing gate.
  const facts = {
    role: (prof?.role as string | null) ?? null,
    hiddenFromPublic: (prof?.hidden_from_public as boolean | null) ?? null,
    phoneVerified: !!prof?.phone_verified_at,
    hasSubjects: (subj ?? []).length > 0,
    city: (tp?.city as string | null) ?? null,
    area: (tp?.area as string | null) ?? null,
    gender: (tp?.gender as string | null) ?? null,
    isSuspended: prof?.is_suspended as boolean | null,
    isBanned: prof?.is_banned as boolean | null,
    underReview: tp?.under_review as boolean | null,
    verificationStatus: tp?.verification_status as string | null,
    imported: tp?.imported as boolean | null,
    claimedAt: tp?.claimed_at as string | null,
    isSeed: prof?.is_seed as boolean | null,
    isTeamAccount: prof?.is_team_account as boolean | null,
    // §5 (migration 137): a staff-rejected identity document delists.
    cnicRejected: ((prof?.verification_state as string | null) ?? '').toLowerCase() === 'rejected',
    photoRejected: ((prof?.profile_pic_status as string | null) ?? '').toLowerCase() === 'rejected',
    selfieRejected: ((prof?.selfie_status as string | null) ?? '').toLowerCase() === 'rejected',
  }
  // ONE SOURCE (item 8): the view decides; the mirror explains WHY. The live
  // test (scripts/test-directory-live.ts) keeps the two in step.
  const blockers = directoryBlockers(facts)
  const gaps = profileGaps(facts)
  const { data: inDir } = await admin.from('tutor_directory').select('id').eq('id', userId).maybeSingle()
  return { listed: !!inDir, blockers, gaps }
}

/**
 * Which of these tutor ids are actually LISTED (in tutor_directory), in ONE
 * query — for admin surfaces that link many public profiles at once (e.g. the
 * tuition applicant rows), so a link is shown only when the page resolves and
 * never 404s. Reads the directory VIEW directly through the service role (the
 * same gate loadDirectoryStatus mirrors), so it is not a second rule.
 */
export async function listedTutorIds(ids: string[]): Promise<Set<string>> {
  const admin = createAdminClient()
  if (!admin || ids.length === 0) return new Set()
  const { data } = await admin.from('tutor_directory').select('id').in('id', ids)
  return new Set((data ?? []).map((r) => r.id as string))
}
