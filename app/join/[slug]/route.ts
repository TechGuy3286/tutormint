import { NextResponse } from 'next/server'

import { recordJoinVisit } from '@/lib/staffSignups'
import { CREDIT_MS, STAFF_REF_COOKIE } from '@/lib/staffSignupsCore'
import { isBotUserAgent, isOwnCrawler } from '@/lib/searchCountCore'
import { safeReturnTo } from '@/lib/returnTo'

// /join/<slug> — a staff member's personal join link (owner, 15 Oct 2026).
//
// Records a first-touch credit (a server row + the httpOnly tm_staff_ref cookie,
// 30 days) and sends the visitor on to /register, keeping any return-to and
// role. A credit that is still valid is never replaced by a different link
// (first link wins). An unknown slug goes to /register with no credit — never an
// error page. A crawler is sent on without a credit being recorded.

export const dynamic = 'force-dynamic'

export async function GET(request: Request, { params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params
  const url = new URL(request.url)

  const dest = new URL('/register', url.origin)
  const next = safeReturnTo(url.searchParams.get('next'))
  if (next) dest.searchParams.set('next', next)
  const role = url.searchParams.get('role')
  if (role === 'tutor' || role === 'parent') dest.searchParams.set('role', role)

  const res = NextResponse.redirect(dest, 307)
  res.headers.set('Cache-Control', 'no-store')
  res.headers.set('X-Robots-Tag', 'noindex')

  const ua = request.headers.get('user-agent')
  if (isOwnCrawler(ua) || isBotUserAgent(ua)) return res

  const cookieValue = request.headers
    .get('cookie')
    ?.split(';')
    .map((c) => c.trim())
    .find((c) => c.startsWith(`${STAFF_REF_COOKIE}=`))
    ?.slice(STAFF_REF_COOKIE.length + 1)

  try {
    const { visit, recorded } = await recordJoinVisit(slug, cookieValue ? decodeURIComponent(cookieValue) : null)
    if (visit && recorded) {
      res.cookies.set(STAFF_REF_COOKIE, visit.id, {
        httpOnly: true,
        sameSite: 'lax',
        secure: process.env.NODE_ENV === 'production',
        path: '/',
        maxAge: Math.floor(CREDIT_MS / 1000),
      })
    }
  } catch (e) {
    console.error('[join] could not record the visit:', e instanceof Error ? e.message : e)
  }
  return res
}
