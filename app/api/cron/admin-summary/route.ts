import { NextResponse } from 'next/server'
import { timingSafeEqual } from 'node:crypto'
import { rebuildAdminSummary } from '@/lib/adminSummary'
import { refreshInterestInboxIfDue } from '@/lib/interestInbox'
import { syncListedTutors } from '@/lib/tutorLinkers'
import { refreshRankCacheIfStale } from '@/lib/rankCache'
import { runOtpAlerts } from '@/lib/otpAlerts'

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
  // The Parent interest inbox's stored copy (PR-11): every 10 minutes since
  // PR-15 (lib/interestInboxCore inboxCronDue); sends, Undo, holds and page
  // opens rebuild it themselves, so the cron is only the safety net.
  const inbox = await refreshInterestInboxIfDue().catch(() => null)
  // PR-16: a tutor who left the indexable set (any path — suspend, ban, hide,
  // erase, a rejected document) leaves the pages that linked to them within a
  // minute (lib/tutorLinkers). One slug-list read when nothing changed.
  const linkers = await syncListedTutors()
  // PR-17 Part A: the precomputed ranking + landing counts (migration 243).
  // PR-18 Part D: refreshed every minute by pg_cron inside the database; this
  // only steps in when that has not run for 3 minutes. rank_tutors() still
  // falls back to its live body by itself after 10 minutes.
  const rankCache = await refreshRankCacheIfStale()
  // PR-18 Part C: OTP-verified alerts still pending, or the 15-minute digest.
  const otpAlerts = await runOtpAlerts().catch(() => null)
  const r = await rebuildAdminSummary({ force })
  return NextResponse.json({ ...r, inbox, linkers, rankCache, otpAlerts }, { status: r.failed.length ? 500 : 200 })
}
