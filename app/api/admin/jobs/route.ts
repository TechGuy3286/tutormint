import { NextResponse } from 'next/server'

import { checkAdminRole, SCREEN_ACCESS } from '@/lib/adminAuth'
import { adminJobPage } from '@/lib/adminJobs'

// Load-more for /admin/jobs.
//
// Re-checks the permission rather than trusting the screen. This list reaches
// through the service role and returns closed jobs, hired jobs and jobs by
// suspended parents -- everything the public board deliberately hides -- so a
// route that assumed the caller had already passed the screen's guard would
// hand all of it to any signed-in admin whose role cannot open that screen.

export const dynamic = 'force-dynamic'

const PAGE_SIZE = 40

export async function GET(request: Request) {
  const gate = await checkAdminRole(...SCREEN_ACCESS.jobs)
  if (!gate.ok) return NextResponse.json({ error: gate.error }, { status: gate.status })

  const url = new URL(request.url)
  const get = (k: string) => (url.searchParams.get(k) ?? '').trim()

  const { rows, nextCursor } = await adminJobPage({
    filters: {
      q: get('q'),
      status: get('status'),
      city: get('city'),
      subject: get('subject'),
      featured: get('featured'),
    },
    limit: PAGE_SIZE,
    cursor: get('cursor') || null,
  })

  return NextResponse.json({ items: rows, cursor: nextCursor })
}
