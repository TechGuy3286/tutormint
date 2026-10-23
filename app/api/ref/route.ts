import { NextResponse } from 'next/server'
import { cookies } from 'next/headers'

import { refLinkVisit } from '@/lib/staffSignups'
import { STAFF_REF_COOKIE, normaliseStaffCode, staffRefCookieOptions } from '@/lib/staffSignupsCore'
import { isBotUserAgent, isOwnCrawler } from '@/lib/searchCountCore'

// POST /api/ref { code } — a page was opened with ?ref=<staff code> (owner,
// 23 Oct 2026). Stores a first-touch credit for 30 days: a credit that is
// still valid is kept (first link wins); an unknown or inactive code is ignored.
// Always 204, so the page learns nothing about which codes exist.

export const dynamic = 'force-dynamic'

export async function POST(request: Request) {
  const done = new NextResponse(null, { status: 204, headers: { 'Cache-Control': 'no-store' } })
  const ua = request.headers.get('user-agent')
  if (isOwnCrawler(ua) || isBotUserAgent(ua)) return done
  let raw: unknown = null
  try {
    raw = ((await request.json()) as { code?: unknown })?.code
  } catch {
    return done
  }
  const code = normaliseStaffCode(typeof raw === 'string' ? raw : null)
  if (!code) return done
  try {
    const jar = await cookies()
    const { visit, recorded } = await refLinkVisit(code, jar.get(STAFF_REF_COOKIE)?.value ?? null)
    if (visit && recorded) done.cookies.set(STAFF_REF_COOKIE, visit.id, staffRefCookieOptions())
  } catch (e) {
    console.error('[ref] could not record the visit:', e instanceof Error ? e.message : e)
  }
  return done
}
