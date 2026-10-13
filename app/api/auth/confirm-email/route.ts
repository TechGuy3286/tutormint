import { NextResponse } from 'next/server'

import { confirmEmailFromLink } from '@/lib/emailConfirm'
import { homeForRole } from '@/lib/authRoutes'

// GET /api/auth/confirm-email?u=<account>&e=<email>&s=<signature>
//
// Our own "confirm your email" link (owner, 13 Oct 2026). The signature is an
// HMAC over the account and the address, so the link confirms only that address
// on only that account, and only we can make one. It does not sign anybody in:
// a signed-in tutor lands on the dashboard with the "email confirmed" toast; a
// signed-out one is sent to sign in first by the proxy.

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET(request: Request) {
  const url = new URL(request.url)
  const out = await confirmEmailFromLink({
    userId: url.searchParams.get('u') ?? '',
    email: url.searchParams.get('e') ?? '',
    sig: url.searchParams.get('s') ?? '',
  })
  if (!out.ok) return NextResponse.redirect(new URL('/login?confirm=invalid', url.origin))
  let home = '/'
  try {
    home = homeForRole(out.role as never)
  } catch {
    home = '/'
  }
  return NextResponse.redirect(new URL(`${home}?verified=email`, url.origin))
}
