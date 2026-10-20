import { NextResponse } from 'next/server'
import { checkAdminRole } from '@/lib/adminAuth'
import { loadSessionPages } from '@/lib/memberTimeline'
import { describeActivityEvent } from '@/lib/activityTrack'

// The pages of one visit on the admin member timeline (owner, 20 Oct 2026) —
// opened when staff tap a "Visited TutorMint" line. OWNER/ADMIN ONLY, the same
// gate as the visit list itself (app/api/admin/activity/sessions). Read-only.

export const runtime = 'nodejs'

export async function GET(request: Request) {
  const gate = await checkAdminRole('admin')
  if (!gate.ok) return NextResponse.json({ error: gate.error }, { status: gate.status })
  const url = new URL(request.url)
  const userId = url.searchParams.get('userId') ?? ''
  const sessionId = url.searchParams.get('sessionId') ?? ''
  if (!/^[0-9a-f-]{36}$/i.test(userId) || !/^[0-9a-f-]{36}$/i.test(sessionId)) {
    return NextResponse.json({ error: 'Something in that request was missing. Reload the page and try again.' }, { status: 400 })
  }
  const events = await loadSessionPages(userId, sessionId)
  return NextResponse.json({ rows: events.map((e) => ({ id: e.id, text: describeActivityEvent(e), at: e.at })) })
}
