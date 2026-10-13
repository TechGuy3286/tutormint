import 'server-only'

import { unstable_cache } from 'next/cache'

import { brandLine } from '@/lib/brandClaims'
import { createPublicClient } from '@/lib/supabase/public'
import { pageAll } from '@/lib/pageAll'
import { loadVerifiedBadgeOk } from '@/lib/badgeFacts'

// The brand line TutorMint shows about itself (owner, 13–14 Oct 2026), from the
// live count of tutors holding the Verified badge: under 100 → "Pakistan's
// fast-growing tutor network"; 100 or more → "100+ verified tutors across
// Pakistan" (lib/brandClaims brandLine). One loader for the homepage pill and
// every composed blog cover, so they cannot disagree.

/**
 * How many tutors hold the Verified badge RIGHT NOW — listed tutors, judged by
 * the site's one badge rule (lib/badgeRule through lib/badgeFacts). A read that
 * fails counts nobody, so the line falls back to the modest wording.
 */
export async function verifiedBadgeTutorCount(): Promise<number> {
  try {
    const db = createPublicClient()
    const rows = await pageAll((from, to) =>
      db.from('tutor_directory').select('id').not('verified_fee_paid_at', 'is', null).order('id').range(from, to),
    )
    return (await loadVerifiedBadgeOk(rows.map((r) => r.id as string))).size
  } catch {
    return 0
  }
}

/** The brand line, computed now (a cover made now carries exactly this). */
export async function currentBrandLine(): Promise<string> {
  return brandLine(await verifiedBadgeTutorCount())
}

/** The same line for a public page: recomputed at most once an hour, so the
 *  homepage does not count tutors on every request. */
export const cachedBrandLine = unstable_cache(async () => currentBrandLine(), ['brand-line'], { revalidate: 3600 })
