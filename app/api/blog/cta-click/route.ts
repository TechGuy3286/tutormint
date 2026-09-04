import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'

// One CTA click on a post. Beaconed from the reader CTA so the admin list can
// show which posts actually move someone to post a tuition or sign up. Same
// atomic, published-only increment as the view counter.

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
  await admin.rpc('increment_post_metric', { p_id: id, p_metric: 'cta' })
  return NextResponse.json({ ok: true })
}
