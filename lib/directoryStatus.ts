import 'server-only'

import { createAdminClient } from '@/lib/supabase/admin'
import { directoryBlockers, type ListingBlocker } from '@/lib/tutorListingStatus'

// Server loader for "is this ONE tutor in the public directory, and why not?"
// It fetches exactly the facts the tutor_directory view keys on (migration 87)
// and runs them through the pure `directoryBlockers`, so a surface never says a
// tutor is listed on the strength of the fee flag alone — the fault migration 87
// exists to close. The dashboard uses this; the admin LIST computes the same
// blockers in a batch (no per-row round trip).

export type DirectoryStatus = { listed: boolean; blockers: ListingBlocker[] }

export async function loadDirectoryStatus(userId: string): Promise<DirectoryStatus> {
  const admin = createAdminClient()
  if (!admin) return { listed: false, blockers: [] }

  const [{ data: prof }, { data: tp }, { data: subj }] = await Promise.all([
    admin
      .from('profiles')
      .select('phone_verified_at, is_suspended, is_banned, is_seed, is_team_account')
      .eq('id', userId)
      .maybeSingle(),
    admin
      .from('tutor_profiles')
      .select('verified_fee_paid_at, city, area, gender, under_review, verification_status, imported, claimed_at')
      .eq('id', userId)
      .maybeSingle(),
    admin.from('tutor_subjects').select('tutor_id').eq('tutor_id', userId).limit(1),
  ])

  const blockers = directoryBlockers({
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
  })
  return { listed: blockers.length === 0, blockers }
}
