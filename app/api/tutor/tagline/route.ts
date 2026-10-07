import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { rateLimit, tooManyRequests } from '@/lib/rateLimit'
import { selectionForMasterIdsServer } from '@/lib/taxonomyServer'
import { EXPERIENCE_BANDS, type OnboardingAnswers } from '@/lib/onboarding/copy'
import { generateTagline } from '@/lib/ai/taglineCopy'

// AI tagline & bio for the new onboarding (PR106-G4a §3). Writes a tagline and a
// short bio from the tutor's OWN saved data (gender/city/areas/subjects/levels/
// work/experience), never inventing facts and never leaking phone/CNIC/address/
// exact fee. Falls back to the deterministic composer on any failure, so the
// tutor is never blocked. Generating writes nothing — the tutor reviews/edits
// and the onboarding save publishes it.

export const runtime = 'nodejs'
export const maxDuration = 30

export async function POST() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Please sign in first, then try again.\nپہلے سائن ان کریں، پھر دوبارہ کوشش کریں۔' }, { status: 401 })

  const limit = await rateLimit('ai_generate', user.id)
  if (!limit.allowed) return tooManyRequests(limit.retryAfterSeconds, 'requests')

  const [{ data: tp }, { data: p }, subj] = await Promise.all([
    supabase.from('tutor_profiles').select('city, area, experience_years, job_types').eq('id', user.id).maybeSingle(),
    supabase.from('profiles').select('city, address').eq('id', user.id).maybeSingle(),
    supabase.from('tutor_subjects').select('master_id').eq('tutor_id', user.id),
  ])
  const ids = (subj.data ?? []).map((r) => r.master_id as number)
  // Server-side lookup (never the browser-only lib/taxonomy). A lookup failure
  // writes a tagline without subject names rather than failing the request.
  const sel = ids.length
    ? await selectionForMasterIdsServer(ids).catch((e) => {
        console.error('[tutor/tagline] subject lookup failed:', e instanceof Error ? e.message : e)
        return { levels: [] as string[], subjects: [] as string[] }
      })
    : { levels: [] as string[], subjects: [] as string[] }

  // Areas (fail-open if the table is missing).
  let areas: string[] = (tp?.area as string) ? [tp!.area as string] : []
  try {
    const { data: ar } = await supabase.from('tutor_areas').select('area').eq('tutor_id', user.id)
    const list = (ar ?? []).map((r) => r.area as string).filter(Boolean)
    if (list.length) areas = list
  } catch { /* pre-migration */ }

  const answers: OnboardingAnswers = {
    city: (tp?.city as string) ?? (p?.city as string) ?? null,
    areas,
    subjectNames: sel.subjects ?? [],
    levelNames: sel.levels ?? [],
    jobTypes: (tp?.job_types as string[] | null) ?? [],
    experienceBand: EXPERIENCE_BANDS.find((b) => b.years === (tp?.experience_years as number | null))?.label ?? null,
  }

  const result = await generateTagline(answers, { seed: user.id, address: (p?.address as string) ?? null })
  return NextResponse.json(result)
}
