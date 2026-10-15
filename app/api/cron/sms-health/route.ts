import { NextResponse } from 'next/server'
import { cronAuthorised } from '@/lib/internalAuth'
import { runSmsHealthCheck } from '@/lib/smsLog'

// The hourly SMS health check (owner, 15 Oct 2026). Emails the Owner and adds a
// bell notification when a send failed, or when 2+ numbers asked for a code in
// the last 12 hours and none was sent — at most once per 6 hours. Protected by
// CRON_SECRET, like every cron route. GET, because that is what Vercel Cron issues.

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 30

export async function GET(request: Request) {
  if (!cronAuthorised(request)) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 })
  const result = await runSmsHealthCheck()
  return NextResponse.json(result)
}
