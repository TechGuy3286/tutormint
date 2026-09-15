import { redirect } from 'next/navigation'

import { getSupportContact, whatsappHref } from '@/lib/support'
import { onboardingFacets } from '@/lib/openJobCounts'
import { createClient } from '@/lib/supabase/server'
import CompleteProfileFlow from '@/components/tutor/CompleteProfileFlow'

// The tutor completion flow (PR 4 §1). The old step-tab form is retired; this is
// the SAME tap-tap gap flow /tutor/onboarding renders. A server component only so
// it can read the demand facets (service role) and the support contact
// (app_settings + env, never hardcoded) — the Mobile step needs the SAME
// WhatsApp/email fallback /verify-phone has, so a tutor who cannot receive a code
// is never stuck. Everything interactive lives in CompleteProfileFlow.

export const dynamic = 'force-dynamic'

export default async function CompleteProfilePage() {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) redirect('/login?next=/tutor/complete-profile')

  const { data: profile } = await supabase.from('profiles').select('role').eq('id', user.id).maybeSingle()
  if (profile?.role !== 'tutor') redirect('/')

  const support = await getSupportContact()
  const waHref = whatsappHref(
    support.whatsapp,
    "Assalam-o-Alaikum, I can't verify my mobile number on TutorMint while completing my profile. Please help.",
  )
  // Demand ordering for the chips; null (no service role) degrades to the curated
  // city/area/job-title lists inside the flow, not a broken screen.
  const facets = await onboardingFacets()

  return <CompleteProfileFlow facets={facets} support={{ waHref, email: support.email }} seed={user.id} />
}
