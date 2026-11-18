import { NextResponse } from 'next/server'
import { getSessionUser } from '@/lib/auth'
import { createClient } from '@/lib/supabase/server'
import { pageAll } from '@/lib/pageAll'

// The signed-in parent's shortlisted tutor ids (PR-08, owner 18 Nov 2026).
// Browse pages stay cached and identical for everyone; the browser asks here
// after load and fills the hearts (lib/useShortlisted). Read with the caller's
// own client, so RLS (shortlists.user_id = auth.uid()) scopes it. Ids only —
// never a name. Never cached.
export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const NO_STORE = { headers: { 'Cache-Control': 'private, no-store' } }

export async function GET() {
  const session = await getSessionUser().catch(() => null)
  const userId = session?.user.id ?? null
  if (!userId) return NextResponse.json({ ids: [] }, NO_STORE)
  try {
    const supabase = await createClient()
    const rows = await pageAll<{ tutor_id: string }>((f, t) => supabase.from('shortlists').select('tutor_id').eq('user_id', userId).order('tutor_id').range(f, t) as never)
    return NextResponse.json({ ids: rows.map((r) => r.tutor_id) }, NO_STORE)
  } catch {
    return NextResponse.json({ ids: [] }, NO_STORE)
  }
}
