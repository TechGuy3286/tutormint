import AdView from '@/components/ads/AdView'
import { pickAd, houseAd, houseUpsellAd, recordImpression, type AdAudience, type AdSlotName } from '@/lib/ads'
import type { UpsellAudience } from '@/lib/upsell'

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
//
// UPSELL DISCIPLINE (lib/upsell.ts): when the viewer is a signed-in member of
// the slot's own audience, the house creative is the next plan ABOVE the one
// they hold — never their own or a lower one. At the top of the ladder there is
// nothing honest to pitch, so the slot renders nothing.

function slotAudienceFor(role: string | null | undefined): UpsellAudience | null {
  if (role === 'tutor') return 'tutor'
  if (role === 'parent' || role === 'academy') return 'parent'
  return null
}

function matchesSlot(viewer: UpsellAudience, audience: AdAudience): boolean {
  return (viewer === 'parent' && audience === 'parents') || (viewer === 'tutor' && audience === 'tutors')
}

export default async function AdSlot({
  slot,
  audience = 'parents',
  /** Rotates the house creative so two slots on one page are not identical. */
  index = 0,
  viewerRole = null,
  /** The viewer's held plan_code, so a house upsell never pitches it or lower. */
  viewerPlan = null,
}: {
  slot: AdSlotName
  audience?: AdAudience
  index?: number
  viewerRole?: string | null
  viewerPlan?: string | null
}) {
  // The tutor dashboard carries house and promo creatives only (revenue spec),
  // so it is not offered to the paid rotation at all.
  const paid = slot === 'tutor-dashboard' ? null : await pickAd(audience)

  if (paid) {
    await recordImpression(paid.id, slot, viewerRole)
    return <AdView ad={{ kind: 'paid', ad: paid }} />
  }

  // House fallback. For a signed-in member of this slot's audience, respect
  // their plan; render nothing when they are already at the top.
  const viewer = slotAudienceFor(viewerRole)
  if (viewer && matchesSlot(viewer, audience)) {
    const house = houseUpsellAd(viewer, viewerPlan)
    if (!house) return null
    return <AdView ad={{ kind: 'house', ad: house }} />
  }

  return <AdView ad={{ kind: 'house', ad: houseAd(audience, index) }} />
}
