import 'server-only'

import { coverAssetDataUri } from './assets'
import { renderCoverPng } from './compose'
import { selectCover, coverAltText, type CoverInput } from './select'

// Server orchestration for a composed cover: pick the imagery, load the assets
// into data URIs, render. Kept apart from compose.tsx because this imports the
// server-only asset loader, and compose.tsx must stay importable under the test
// runner.

/** Render one composed cover (1200x630) for a post at a given seed (0..2). */
export async function composeCoverResponse(input: CoverInput, seed: number): Promise<Response> {
  const selection = selectCover(input, seed)
  const [city, person, ...motifs] = await Promise.all([
    coverAssetDataUri(selection.citySlug),
    coverAssetDataUri(selection.personSlug),
    ...selection.motifs.map((m) => coverAssetDataUri(m)),
  ])
  return renderCoverPng({ title: input.title, selection, assets: { city, person, motifs } })
}

/** The auto-filled alt text for a composed cover at a given seed. */
export function composeCoverAlt(input: CoverInput, seed: number): string {
  return coverAltText(input, selectCover(input, seed))
}
