import 'server-only'

import { coverAssetDataUri } from './assets'
import { renderCoverPng } from './compose'
import { selectCover, coverAltText, type CoverInput } from './select'
import { brandLine } from '@/lib/brandClaims'
import { createPublicClient } from '@/lib/supabase/public'
import { pageAll } from '@/lib/pageAll'
import { loadVerifiedBadgeOk } from '@/lib/badgeFacts'

// Server orchestration for a composed cover: pick the imagery, load the assets
// into data URIs, render. Kept apart from compose.tsx because this imports the
// server-only asset loader, and compose.tsx must stay importable under the test
// runner.

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

/** The brand line a cover made now carries (lib/brandClaims brandLine). */
export async function currentBrandLine(): Promise<string> {
  return brandLine(await verifiedBadgeTutorCount())
}

/** Render one composed cover (1200x630) for a post at a given seed (0..2). The
 *  brand line is computed at generation time. Throws CoverTextError (see
 *  compose.tsx) when the title carries a banned claim. */
export async function composeCoverResponse(input: CoverInput, seed: number): Promise<Response> {
  const line = await currentBrandLine()
  const selection = selectCover(input, seed)
  const [city, person, ...motifs] = await Promise.all([
    coverAssetDataUri(selection.citySlug),
    coverAssetDataUri(selection.personSlug),
    ...selection.motifs.map((m) => coverAssetDataUri(m)),
  ])
  return renderCoverPng({ title: input.title, selection, assets: { city, person, motifs }, brandLine: line })
}

/** The auto-filled alt text for a composed cover at a given seed. */
export function composeCoverAlt(input: CoverInput, seed: number): string {
  return coverAltText(input, selectCover(input, seed))
}
