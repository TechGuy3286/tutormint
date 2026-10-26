import { NextResponse } from 'next/server'

import { exitViewAs } from '@/lib/viewAs'

// /api/admin/view-as/exit (owner, 26 Oct 2026) — ends "View as": the member
// session made for it is removed, the Owner's own session is put back, and the
// end is written to Audit. GET (the banner's Exit link, and the proxy when the
// 30 minutes are up) or POST. The only admin route the proxy lets through while
// viewing.

export const dynamic = 'force-dynamic'

async function end(request: Request) {
  const expired = new URL(request.url).searchParams.get('expired') === '1'
  const { redirect } = await exitViewAs(expired ? 'expired' : 'exit')
  return NextResponse.redirect(new URL(redirect, request.url), 303)
}

export async function GET(request: Request) {
  return end(request)
}

export async function POST(request: Request) {
  return end(request)
}
