import { NextResponse } from 'next/server'

import { createClient } from '@/lib/supabase/server'
import { onboardingCounts, type CountFilters } from '@/lib/openJobCounts'

// The live open-tuition counts for the onboarding counter. Signed-in tutors
// only (the flow is behind auth), and it returns aggregate counts only — no
// personal data — so it is safe to call after each answer.

export const dynamic = 'force-dynamic'

export async function POST(request: Request) {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Sign in first.' }, { status: 401 })

  const body = (await request.json().catch(() => ({}))) as CountFilters
  const filters: CountFilters = {
    city: typeof body.city === 'string' ? body.city : null,
    area: typeof body.area === 'string' ? body.area : null,
    subjectSlugs: Array.isArray(body.subjectSlugs) ? body.subjectSlugs.filter((s) => typeof s === 'string').slice(0, 50) : [],
    levelSlugs: Array.isArray(body.levelSlugs) ? body.levelSlugs.filter((s) => typeof s === 'string').slice(0, 50) : [],
  }

  const counts = await onboardingCounts(filters)
  return NextResponse.json(counts)
}
