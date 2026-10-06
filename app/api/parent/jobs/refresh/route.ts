import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { refreshTuition } from '@/lib/tuitionMerge'
import { parseBody, z } from '@/lib/validate'

// Refresh the poster's own tuition (owner, 6 Oct 2026, item 16): to the top of
// Browse with a fresh 15 days, same URL, Indexing API URL_UPDATED — at most once
// every 3 days per tuition. Ownership and the limit are checked in
// lib/tuitionMerge.refreshTuition.

const Body = z.object({
  jobId: z.string().min(1, 'Missing tuition.').max(64),
})

export async function POST(request: Request) {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Sign in to refresh your tuition.\nاپنی ٹیوشن ریفریش کرنے کے لیے سائن ان کریں۔' }, { status: 401 })

  const parsed = await parseBody(request, Body)
  if (!parsed.ok) return parsed.response

  const r = await refreshTuition(parsed.data.jobId, { id: user.id, kind: 'parent' }, user.id)
  if (!r.ok) return NextResponse.json({ error: r.error, nextAt: r.nextAt ?? null }, { status: r.status })
  return NextResponse.json({ success: true })
}
