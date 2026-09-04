import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'

// One post view. The client fires this once per session (sessionStorage
// guarded); the atomic increment lives in the DB function, which only touches
// published rows. Not rate-limited — a view count is a low-stakes vanity metric
// and the session guard covers ordinary double-fires; the numbers that matter
// for advertisers (ad_events) are the ones that are locked down.

export const dynamic = 'force-dynamic'

export async function POST(request: Request) {
  let id = ''
  try {
    id = String((await request.json())?.id ?? '')
  } catch {
    return NextResponse.json({ ok: false }, { status: 400 })
  }
  if (!/^[0-9a-f-]{36}$/i.test(id)) return NextResponse.json({ ok: false }, { status: 400 })

  const admin = createAdminClient()
  if (!admin) return NextResponse.json({ ok: false }, { status: 503 })
  await admin.rpc('increment_post_metric', { p_id: id, p_metric: 'views' })
  return NextResponse.json({ ok: true })
}
