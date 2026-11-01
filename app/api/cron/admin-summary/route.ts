import { NextResponse } from 'next/server'
import { timingSafeEqual } from 'node:crypto'
import { rebuildAdminSummary } from '@/lib/adminSummary'

// The admin summary job (owner, 1 Nov 2026 — lib/adminSummary). Vercel calls it
// every minute; it rebuilds only when something changed since the last build
// (an admin or member action marked it) or the last build is 10 minutes old,
// and never while another rebuild is running. Protected by CRON_SECRET.
export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 300

function authorised(request: Request): boolean {
  const secret = process.env.CRON_SECRET
  if (!secret) return false
  const header = request.headers.get('authorization') ?? ''
  const provided = header.startsWith('Bearer ') ? header.slice(7) : header
  const a = Buffer.from(secret, 'utf8')
  const b = Buffer.from(provided, 'utf8')
  if (a.length !== b.length) return false
  return timingSafeEqual(a, b)
}

export async function GET(request: Request) {
  if (!authorised(request)) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 })
  const force = new URL(request.url).searchParams.get('force') === '1'
  const r = await rebuildAdminSummary({ force })
  return NextResponse.json(r, { status: r.failed.length ? 500 : 200 })
}
