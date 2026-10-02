import { NextResponse } from 'next/server'
import { checkAdminRole } from '@/lib/adminAuth'
import { loadActivitySessions } from '@/lib/adminActivity'

// Load-more for the member activity session list (PR99 §2). OWNER/ADMIN ONLY —
// the activity telemetry is more sensitive than the curated timeline, so
// operations does not see it (matches the summary gate on the member page).

export const runtime = 'nodejs'

export async function GET(request: Request) {
  const gate = await checkAdminRole('admin')
  if (!gate.ok) return NextResponse.json({ error: gate.error }, { status: gate.status })

  const url = new URL(request.url)
  const userId = url.searchParams.get('userId') ?? ''
  const cursor = url.searchParams.get('cursor')
  if (!/^[0-9a-f-]{36}$/i.test(userId)) {
    return NextResponse.json({ error: 'Bad request.' }, { status: 400 })
  }

  const { rows, nextCursor } = await loadActivitySessions(userId, { cursor })
  return NextResponse.json({ rows, nextCursor })
}
