import { NextResponse } from 'next/server'

import { checkAdminRole, SCREEN_ACCESS } from '@/lib/adminAuth'
import { listAdminPosts } from '@/lib/blogFeed'

// Infinite-scroll endpoint for the admin blog list. Manager or support (support
// sees drafts too). Shape is Page<AdminPostRow> = { items, cursor }.

export const dynamic = 'force-dynamic'

export async function GET(request: Request) {
  const gate = await checkAdminRole(...SCREEN_ACCESS.blog)
  if (!gate.ok) return NextResponse.json({ error: gate.error }, { status: gate.status })

  const url = new URL(request.url)
  const { items, nextCursor } = await listAdminPosts({
    q: url.searchParams.get('q'),
    cluster: url.searchParams.get('cluster'),
    status: url.searchParams.get('status'),
    limit: 20,
    cursor: url.searchParams.get('cursor'),
  })
  return NextResponse.json({ items, cursor: nextCursor })
}
