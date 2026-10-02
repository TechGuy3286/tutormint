import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { rateLimit } from '@/lib/rateLimit'
import { cleanEvents, isBotUserAgent, clampActiveDelta } from '@/lib/activityTrack'

// Member activity ingest (PR99 §2).
//
// Fire-and-forget from the client (sendBeacon / keepalive fetch). It NEVER
// blocks or slows a page: the client does not await it, and a failure here is
// invisible to the member.
//
// RULES:
//  * No recording when signed out — no session, we return { tracking:false } and
//    write nothing. The client then goes dormant.
//  * Bots dropped (user-agent).
//  * Rate-limited per user; over budget → silently dropped (still 200).
//  * Only a fixed set of fields is accepted (lib/activityTrack); search text is
//    masked for phone/email; no password/OTP/CNIC/message/payment can ride in.
//  * Staff/owner/seed are recorded but MARKED (is_staff/is_seed on the session).
//
// All writes go through the service role: these tables are admin-read only and
// have no member write policy.

export const runtime = 'nodejs'

type Body = { sid?: unknown; activeMs?: unknown; events?: unknown }

export async function POST(request: Request) {
  // A browser always sends a UA; a bot/script often does not or names itself.
  const ua = request.headers.get('user-agent')
  if (isBotUserAgent(ua)) return NextResponse.json({ tracking: false })

  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ tracking: false })

  const limit = await rateLimit('activity', user.id)
  if (!limit.allowed) return NextResponse.json({ tracking: true }) // drop, never block

  let body: Body
  try {
    body = (await request.json()) as Body
  } catch {
    return NextResponse.json({ tracking: true })
  }

  const admin = createAdminClient()
  if (!admin) return NextResponse.json({ tracking: false })

  const events = cleanEvents(body.events)
  const activeDelta = clampActiveDelta(body.activeMs)
  const pageViews = events.filter((e) => e.kind === 'page_view').length

  // Resolve the session: a client-supplied sid must belong to THIS user, else we
  // start a fresh one. A new tab (no sid) always starts a fresh session.
  let sessionId: string | null = typeof body.sid === 'string' && body.sid.length >= 20 ? body.sid : null
  if (sessionId) {
    const { data: existing } = await admin
      .from('activity_sessions')
      .select('id, user_id')
      .eq('id', sessionId)
      .maybeSingle()
    if (!existing || existing.user_id !== user.id) sessionId = null
  }

  if (!sessionId) {
    const { data: prof } = await admin
      .from('profiles')
      .select('role, admin_role, is_seed')
      .eq('id', user.id)
      .maybeSingle()
    const isStaff = prof?.role === 'admin' || !!prof?.admin_role
    const { data: created } = await admin
      .from('activity_sessions')
      .insert({
        user_id: user.id,
        active_ms: activeDelta,
        page_count: pageViews,
        is_staff: isStaff,
        is_seed: !!prof?.is_seed,
        user_agent: (ua ?? '').slice(0, 300),
      })
      .select('id')
      .single()
    sessionId = (created?.id as string) ?? null
  } else {
    // Continue the session: bump last_seen, add foreground time and page count.
    await admin.rpc('bump_activity_session', {
      p_session: sessionId,
      p_active_ms: activeDelta,
      p_pages: pageViews,
    })
  }

  if (sessionId && events.length > 0) {
    await admin.from('activity_events').insert(
      events.map((e) => ({
        session_id: sessionId,
        user_id: user.id,
        kind: e.kind,
        path: e.path,
        label: e.label,
        result_count: e.resultCount,
        meta: e.meta,
      })),
    )
  }

  return NextResponse.json({ tracking: true, sid: sessionId })
}
