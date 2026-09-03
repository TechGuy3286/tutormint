import AdView from '@/components/ads/AdView'
import { pickAd, houseAd, recordImpression, type AdAudience, type AdSlotName } from '@/lib/ads'

// An ad slot. There are exactly three placements in the whole product:
//
//   browse-inline     after every 8 results on /browse/tutors and
//                     /browse/tuitions
//   parent-sidebar    the parent dashboard
//   tutor-dashboard   the tutor dashboard (house / promo creatives only)
//
// The homepage has none, deliberately: it is partner-approved and locked, and
// an ad slot is not one of the permitted changes.
//
// A server component, so the impression is recorded where the ad is actually
// chosen -- never on a re-render, and never for a slot nobody reached.
//
// What it looks like is components/ads/AdView.tsx, shared with the client-side
// slot that infinite scroll uses. LABELS live there, decided from the ad's own
// kind: a paid ad is "Sponsored", a house ad is "TutorMint", and a caller
// cannot dress our own marketing up as somebody else's or the reverse.

export default async function AdSlot({
  slot,
  audience = 'parents',
  /** Rotates the house creative so two slots on one page are not identical. */
  index = 0,
  viewerRole = null,
}: {
  slot: AdSlotName
  audience?: AdAudience
  index?: number
  viewerRole?: string | null
}) {
  // The tutor dashboard carries house and promo creatives only (revenue spec),
  // so it is not offered to the paid rotation at all.
  const paid = slot === 'tutor-dashboard' ? null : await pickAd(audience)

  if (paid) {
    await recordImpression(paid.id, slot, viewerRole)
    return <AdView ad={{ kind: 'paid', ad: paid }} />
  }

  return <AdView ad={{ kind: 'house', ad: houseAd(audience, index) }} />
}
