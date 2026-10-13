import { cookies, headers } from 'next/headers'
import { NextResponse } from 'next/server'

import { createClient } from '@/lib/supabase/server'
import { ANON_COOKIE, ANON_MAX_AGE_SECONDS, isAnonId } from '@/lib/anonSession'
import { ANON_ID_HEADER } from '@/lib/searchBeaconCore'
import { recordBeaconSearch, verifyBeaconToken } from '@/lib/searchBeacon'

// POST /api/search/log — the search beacon (owner, 13 Oct 2026).
//
// The ONLY place a search row is written. A Browse page renders a signed ticket
// for the search it showed; a real browser that has loaded the page posts it
// here once. Rendering a page never writes, so a crawler — ours or anyone's —
// adds nothing unless it runs the page's script, and then the user-agent rule
// still applies (lib/searchCountCore).
//
// It answers 204 whatever happened: there is nothing for the page to do with
// the answer, and a different answer for "counted" and "not counted" would only
// tell a script which disguise works.

export const dynamic = 'force-dynamic'

const DONE = () => new NextResponse(null, { status: 204 })

export async function POST(request: Request) {
  let token: unknown = null
  try {
    const body = (await request.json()) as { t?: unknown }
    token = body?.t
  } catch {
    return DONE()
  }
  const payload = verifyBeaconToken(token)
  if (!payload) return DONE()

  let userId: string | null = null
  try {
    const supabase = await createClient()
    const {
      data: { user },
    } = await supabase.auth.getUser()
    userId = user?.id ?? null
  } catch {
    /* treated as a guest */
  }

  // The visitor: the cookie the browser sent, else the id the proxy is setting
  // on THIS response (the browser blocked or lost the page's cookie) — so a
  // first visit is one visitor, counted once.
  const jar = await cookies()
  const sent = jar.get(ANON_COOKIE)?.value
  const minted = (await headers()).get(ANON_ID_HEADER)
  const anonId = isAnonId(sent) ? sent : isAnonId(minted) ? minted : null

  try {
    await recordBeaconSearch(payload, { userId, anonId })
  } catch {
    /* logging must never fail a request */
  }

  const res = DONE()
  if (!isAnonId(sent) && isAnonId(minted)) {
    res.cookies.set(ANON_COOKIE, minted, {
      maxAge: ANON_MAX_AGE_SECONDS,
      httpOnly: true,
      sameSite: 'lax',
      secure: process.env.NODE_ENV === 'production',
      path: '/',
    })
  }
  return res
}
