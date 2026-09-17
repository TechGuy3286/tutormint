import { redirect } from 'next/navigation'

import { createClient } from '@/lib/supabase/server'
import { getSupportContact, whatsappHref, formatSupportWhatsApp } from '@/lib/support'
import { onboardingFacets } from '@/lib/openJobCounts'
import { smsDeliverable } from '@/lib/sms'
import CompleteProfileFlow from '@/components/tutor/CompleteProfileFlow'

// The tutor onboarding flow. ONE flow for every tutor now (PR 4 §1): this route
// (where new tutors land after verifying) and /tutor/complete-profile render the
// same gap-based CompleteProfileFlow. A brand-new tutor's gaps are everything, so
// they flow through all steps from city; an existing tutor sees only her gaps.

export const dynamic = 'force-dynamic'

export default async function TutorOnboardingPage() {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) redirect('/login?next=/tutor/onboarding')

  const { data: profile } = await supabase.from('profiles').select('role').eq('id', user.id).maybeSingle()
  if (profile?.role !== 'tutor') redirect('/')

  // Loop guard: a tutor who has finished or dismissed onboarding is never held
  // here again — they go to their dashboard (they can still edit via settings).
  const { data: tp } = await supabase.from('tutor_profiles').select('onboarded_at').eq('id', user.id).maybeSingle()
  if (tp?.onboarded_at) redirect('/tutor/dashboard')

  const support = await getSupportContact()
  const waHref = whatsappHref(
    support.whatsapp,
    "Assalam-o-Alaikum, I can't verify my mobile number on TutorMint. Please help.",
  )
  const facets = await onboardingFacets()

  return (
    <CompleteProfileFlow
      facets={facets}
      support={{
        waHref,
        waDisplay: support.whatsapp ? formatSupportWhatsApp(support.whatsapp) : null,
        email: support.email,
      }}
      seed={user.id}
      smsAvailable={smsDeliverable()}
    />
  )
}
