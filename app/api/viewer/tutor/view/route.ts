import { NextResponse } from 'next/server'
import { getSessionUser } from '@/lib/auth'
import { getEntitlements } from '@/lib/entitlements'
import { logActivity } from '@/lib/activityLog'
import { recordProfileView } from '@/lib/profileViewRecord'
import { isBotUserAgent } from '@/lib/searchCountCore'

// A view of a tutor profile (push 3, owner 1 Nov 2026). The profile is cached
// for everyone, so the browser reports the view once per page load, with the
// page's own referrer (the search that led here). Recorded exactly as the page
// recorded it before: profile_views, the once-a-day "a parent viewed you"
// notice, and the viewer's timeline. Always 204.
export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const UUID = /^[0-9a-f-]{36}$/i

export async function POST(request: Request) {
  try {
    if (isBotUserAgent(request.headers.get('user-agent'))) return new NextResponse(null, { status: 204 })
    const body = (await request.json().catch(() => null)) as { tutorId?: unknown; referrer?: unknown } | null
    const tutorId = typeof body?.tutorId === 'string' && UUID.test(body.tutorId) ? body.tutorId : null
    if (!tutorId) return new NextResponse(null, { status: 204 })
    const referrer = typeof body?.referrer === 'string' ? body.referrer.slice(0, 2000) : null
    const session = await getSessionUser().catch(() => null)
    const userId = session?.user.id ?? null
    const ent = userId ? await getEntitlements(userId) : null
    await recordProfileView(tutorId, userId, ent?.role ?? null, referrer)
    if (userId && userId !== tutorId) {
      await logActivity({ userId, event: 'profile_viewed', targetType: 'tutor_profile', targetId: tutorId })
    }
  } catch {
    /* a view is never worth an error */
  }
  return new NextResponse(null, { status: 204 })
}
