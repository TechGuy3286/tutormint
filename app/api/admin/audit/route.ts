import { NextResponse } from 'next/server'

import { auditPage } from '@/lib/auditFeed'
import { checkAdminRole, SCREEN_ACCESS } from '@/lib/adminAuth'

// Load-more for /admin/audit.
//
// The screen re-checks the permission, and so does this: hiding a nav link is
// presentation, and a route that trusted the screen would let a verifier read
// the whole audit trail by calling it directly. SCREEN_ACCESS.audit is the same
// entry both of them read.

export const dynamic = 'force-dynamic'

const PAGE_SIZE = 100

export async function GET(request: Request) {
  const gate = await checkAdminRole(...SCREEN_ACCESS.audit)
  if (!gate.ok) return NextResponse.json({ error: gate.error }, { status: gate.status })

  const url = new URL(request.url)
  const { entries, nextCursor } = await auditPage({
    filters: {
      action: (url.searchParams.get('action') ?? 'all').trim() || 'all',
      actor: (url.searchParams.get('actor') ?? '').trim(),
    },
    limit: PAGE_SIZE,
    cursor: (url.searchParams.get('cursor') ?? '').trim() || null,
  })

  return NextResponse.json({ items: entries, cursor: nextCursor })
}
