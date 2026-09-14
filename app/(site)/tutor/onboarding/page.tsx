import { redirect } from 'next/navigation'

import { createClient } from '@/lib/supabase/server'
import { onboardingFacets } from '@/lib/openJobCounts'
import OnboardingClient from './OnboardingClient'

// The tutor onboarding flow — the screen that decides whether a signup becomes a
// listed tutor. Tap-only, bilingual, one question per screen, with a live count
// of open tuitions. New tutors are routed here after they verify (see the
// register/verify route); the flow ends on the tuition list matching their
// answers, not a dashboard.

export const dynamic = 'force-dynamic'

export default async function TutorOnboardingPage() {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) redirect('/login?next=/tutor/onboarding')

  const { data: profile } = await supabase.from('profiles').select('role').eq('id', user.id).maybeSingle()
  if (profile?.role !== 'tutor') redirect('/')

  const facets = await onboardingFacets()
  // Without the service role the counter and demand ordering cannot be built;
  // fall back to the full editor rather than a broken tap flow.
  if (!facets) redirect('/tutor/complete-profile')

  return <OnboardingClient facets={facets} seed={user.id} />
}
