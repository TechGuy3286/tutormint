import { NextResponse } from 'next/server'
import { headers } from 'next/headers'

import { getSessionUser } from '@/lib/auth'
import { rateLimit, callerIp } from '@/lib/rateLimit'
import { countsAsVisit, visitKindsFor } from '@/lib/signupFunnelCore'
import { bumpSiteVisit } from '@/lib/siteVisits'

// One page view, for the daily sign-up funnel (owner, 15 Oct 2026). Sent by
// components/VisitBeacon after a signed-out visitor's page loads in a real
// browser. Counted only when the user-agent passes the existing bot / own-crawler
// rules and nobody is signed in. Stores a NUMBER per day — no id, no IP. Always
// answers 204 so a page never waits on it or shows an error for it.

export const dynamic = 'force-dynamic'

const none = () => new NextResponse(null, { status: 204 })

export async function POST(request: Request) {
  try {
    const ua = (await headers()).get('user-agent')
    if (!countsAsVisit(ua)) return none()
    const limit = await rateLimit('site_visit', callerIp(request))
    if (!limit.allowed) return none()
    const session = await getSessionUser().catch(() => null)
    if (session) return none()
    const body = (await request.json().catch(() => ({}))) as { path?: unknown }
    const path = typeof body.path === 'string' ? body.path.slice(0, 300) : ''
    for (const kind of visitKindsFor(path)) await bumpSiteVisit(kind)
  } catch {
    /* never an error for a count */
  }
  return none()
}
