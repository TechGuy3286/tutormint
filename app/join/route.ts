import { NextResponse } from 'next/server'

import { refLinkVisit } from '@/lib/staffSignups'
import { REF_PARAM, STAFF_REF_COOKIE, normaliseStaffCode, staffRefCookieOptions } from '@/lib/staffSignupsCore'
import { isBotUserAgent, isOwnCrawler } from '@/lib/searchCountCore'
import { safeReturnTo } from '@/lib/returnTo'

// /join?ref=<staff code> — a staff member's personal link (owner, 23 Oct 2026).
//
// A short entry page: stores the first-touch credit (as /join/<slug> does) and
// sends the visitor to /register, keeping ?ref, next and role. With no code,
// or an unknown one, it simply goes to /register. Never indexed.

export const dynamic = 'force-dynamic'

function cookieFrom(request: Request): string | null {
  const v = request.headers
    .get('cookie')
    ?.split(';')
    .map((c) => c.trim())
    .find((c) => c.startsWith(`${STAFF_REF_COOKIE}=`))
    ?.slice(STAFF_REF_COOKIE.length + 1)
  return v ? decodeURIComponent(v) : null
}

export async function GET(request: Request) {
  const url = new URL(request.url)
  const code = normaliseStaffCode(url.searchParams.get(REF_PARAM))

  const dest = new URL('/register', url.origin)
  if (code) dest.searchParams.set(REF_PARAM, code)
  const next = safeReturnTo(url.searchParams.get('next'))
  if (next) dest.searchParams.set('next', next)
  const role = url.searchParams.get('role')
  if (role === 'tutor' || role === 'parent') dest.searchParams.set('role', role)

  const res = NextResponse.redirect(dest, 307)
  res.headers.set('Cache-Control', 'no-store')
  res.headers.set('X-Robots-Tag', 'noindex')
  const ua = request.headers.get('user-agent')
  if (!code || isOwnCrawler(ua) || isBotUserAgent(ua)) return res
  try {
    const { visit, recorded } = await refLinkVisit(code, cookieFrom(request))
    if (visit && recorded) res.cookies.set(STAFF_REF_COOKIE, visit.id, staffRefCookieOptions())
  } catch (e) {
    console.error('[join] could not record the visit:', e instanceof Error ? e.message : e)
  }
  return res
}
