import { NextResponse } from 'next/server'

import { houseAd, pickAd, recordImpression, type AdAudience } from '@/lib/ads'
import { getSessionUser } from '@/lib/auth'

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

  return NextResponse.json({
    kind: 'house',
    ad: houseAd(audience, Number.isFinite(index) ? index : 0),
  })
}
