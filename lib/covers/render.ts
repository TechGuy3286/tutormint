import 'server-only'

import { brandLogoDataUri, coverAssetDataUri } from './assets'
import { renderCoverPng } from './compose'
import { selectCover, coverAltText, type CoverInput } from './select'
import { currentBrandLine, verifiedBadgeTutorCount } from '@/lib/brandLineServer'

// Server orchestration for a composed cover: pick the imagery, load the assets
// into data URIs, render. Kept apart from compose.tsx because this imports the
// server-only asset loader, and compose.tsx must stay importable under the test
// runner. The brand line comes from lib/brandLineServer — the same line the
// homepage pill shows: brandLine(await verifiedBadgeTutorCount()), which counts
// tutors with loadVerifiedBadgeOk( … ), the site's one badge rule.

export { currentBrandLine, verifiedBadgeTutorCount }

/** Render one composed cover (1200x630 PNG) for a post at a given seed. The
 *  brand line is computed at generation time. Throws CoverTextError (see
 *  compose.tsx) when the title carries a banned claim. */
export async function composeCoverResponse(input: CoverInput, seed: number): Promise<Response> {
  const line = await currentBrandLine()
  const selection = selectCover(input, seed)
  const [logo, city, person, ...motifs] = await Promise.all([
    brandLogoDataUri(),
    coverAssetDataUri(selection.citySlug),
    coverAssetDataUri(selection.personSlug),
    ...selection.motifs.map((m) => coverAssetDataUri(m)),
  ])
  return renderCoverPng({ title: input.title, selection, assets: { city, person, motifs, logo }, brandLine: line })
}

/** The auto-filled alt text for a composed cover at a given seed. */
export function composeCoverAlt(input: CoverInput, seed: number): string {
  return coverAltText(input, selectCover(input, seed))
}
