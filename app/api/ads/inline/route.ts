import { NextResponse } from 'next/server'

import { houseAd, houseUpsellAd, pickAd, recordImpression, type AdAudience } from '@/lib/ads'
import { getSessionUser } from '@/lib/auth'
import { getEntitlements } from '@/lib/entitlements'
import type { UpsellAudience } from '@/lib/upsell'

// One inline browse ad, for the windows infinite scroll appends.
//
// WHY THIS EXISTS. AdSlot is an async server component and cannot render inside
// the client list, so without this the second and later windows of /browse
// would carry no ads at all — quietly cutting an advertiser's delivered
// impressions on the page they bought.
//
// The two things that make ad numbers worth reporting stay on the server: the
// ad is CHOSEN here (weighted rotation, expiry enforced by the RLS policy, so
// an expired ad is not returned to any key) and the impression is RECORDED
// here. ad_events still has no INSERT policy for anyone — nothing a browser
// sends becomes a counted impression on its own.
//
// The viewer's role comes from their session, never from the query string:
// otherwise anyone could label their own impressions as a tutor's or a
// parent's and skew the reporting an advertiser is shown.

export const dynamic = 'force-dynamic'

export async function GET(request: Request) {
  const url = new URL(request.url)
  const audience: AdAudience = url.searchParams.get('audience') === 'tutors' ? 'tutors' : 'parents'
  const index = Number(url.searchParams.get('index') ?? 0)

  const session = await getSessionUser()
  const viewerRole = session?.profile?.role ?? null

  const paid = await pickAd(audience)
  if (paid) {
    await recordImpression(paid.id, 'browse-inline', viewerRole)
    return NextResponse.json({ kind: 'paid', ad: paid })
  }

  // House fallback with upsell discipline: a member of this slot's audience is
  // pitched only a plan above the one they hold, and nothing at the top.
  const viewer: UpsellAudience | null =
    viewerRole === 'tutor' ? 'tutor' : viewerRole === 'parent' || viewerRole === 'academy' ? 'parent' : null
  if (
    viewer &&
    session?.user?.id &&
    ((viewer === 'parent' && audience === 'parents') || (viewer === 'tutor' && audience === 'tutors'))
  ) {
    const ent = await getEntitlements(session.user.id)
    const house = houseUpsellAd(viewer, ent.plan)
    if (!house) return NextResponse.json({ kind: 'none' })
    return NextResponse.json({ kind: 'house', ad: house })
  }

  return NextResponse.json({
    kind: 'house',
    ad: houseAd(audience, Number.isFinite(index) ? index : 0),
  })
}
