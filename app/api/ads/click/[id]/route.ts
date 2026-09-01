import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { recordClick, safeTargetUrl } from '@/lib/ads'

// An ad click: count it, then send the visitor on.
//
// Ads never link straight to the advertiser. Going through here is what makes
// the click count real (ad_events has no INSERT policy, so a browser cannot
// write one), and it is the only point where the destination is checked before
// somebody is sent to it.
//
// An open redirect on a domain parents trust is worth more to a phisher than
// the slot is worth to us, so the target is re-validated on every click and not
// merely when the ad was created: an admin could have edited it since, and the
// check costs nothing.

export const dynamic = 'force-dynamic'

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const origin = new URL(request.url).origin

  if (!/^[0-9a-f-]{36}$/i.test(id)) return NextResponse.redirect(origin)

  // Recorded for analytics only: which side of the marketplace clicks. No user
  // id is stored on an ad event -- an advertiser is buying attention, not a
  // list of who looked.
  let viewerRole: string | null = null
  try {
    const supabase = await createClient()
    const {
      data: { user },
    } = await supabase.auth.getUser()
    if (user) {
      const { data: profile } = await supabase
        .from('profiles')
        .select('role')
        .eq('id', user.id)
        .maybeSingle()
      viewerRole = (profile?.role as string) ?? null
    }
  } catch {
    // Anonymous, or the session could not be read. Neither stops the click.
  }

  const target = await recordClick(id, viewerRole)
  const safe = target ? safeTargetUrl(target) : null

  // No destination, or one we will not send anyone to: home, not an error
  // page. The click is already counted, which is what the advertiser is owed.
  return NextResponse.redirect(safe ?? origin, { status: 302 })
}
