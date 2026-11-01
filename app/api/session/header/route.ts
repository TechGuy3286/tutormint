import { NextResponse } from 'next/server'
import { loadHeaderSession } from '@/lib/headerSession'

// The signed-in part of the site header (push 3, owner 1 Nov 2026). Public pages
// are cached without it; the browser asks here only when a sign-in cookie is
// present. Never cached — it is one person's header.
export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET() {
  const body = await loadHeaderSession().catch(() => ({ signedIn: false as const }))
  return NextResponse.json(body, { headers: { 'Cache-Control': 'private, no-store' } })
}
