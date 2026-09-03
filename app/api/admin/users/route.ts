import { NextResponse } from 'next/server'

import { checkAdminRole, SCREEN_ACCESS } from '@/lib/adminAuth'
import { memberPage } from '@/lib/memberFeed'

// Load-more for /admin/users.
//
// Re-checks the permission rather than trusting the screen: the member
// directory carries email and phone for every account on the platform, and a
// route that assumed the caller had already passed the screen's guard would
// hand all of it to any signed-in admin whose role cannot open that screen.

export const dynamic = 'force-dynamic'

const PAGE_SIZE = 100

export async function GET(request: Request) {
  const gate = await checkAdminRole(...SCREEN_ACCESS.users)
  if (!gate.ok) return NextResponse.json({ error: gate.error }, { status: gate.status })

  const url = new URL(request.url)
  const get = (k: string) => (url.searchParams.get(k) ?? '').trim()

  const { rows, nextCursor } = await memberPage({
    filters: { q: get('q'), role: get('role') || 'all', status: get('status') || 'all' },
    limit: PAGE_SIZE,
    cursor: get('cursor') || null,
  })

  return NextResponse.json({ items: rows, cursor: nextCursor })
}
