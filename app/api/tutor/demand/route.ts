import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { tutorDemand } from '@/lib/openJobCounts'

// Open-job demand for the tutor settings pickers (PR 3b §2.3 job type, §2.4
// subjects). Aggregate counts only, no personal data; requires a signed-in user
// so it is not an open scraping endpoint.

export const runtime = 'nodejs'

export async function GET() {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'You must be signed in.' }, { status: 401 })

  const demand = await tutorDemand()
  return NextResponse.json(demand, { headers: { 'Cache-Control': 'private, max-age=60' } })
}
