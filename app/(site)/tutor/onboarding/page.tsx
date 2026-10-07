import { redirect } from 'next/navigation'

import { createClient } from '@/lib/supabase/server'
import { getSupportContact, whatsappHref, formatSupportWhatsApp } from '@/lib/support'
import { onboardingFacets } from '@/lib/openJobCounts'
import { manualInstructions } from '@/lib/payments/manual'
import { smsDeliverable } from '@/lib/sms'
import { getOnboardingMode } from '@/lib/onboardingModeServer'
import { showNewOnboarding } from '@/lib/onboardingMode'
import CompleteProfileFlow from '@/components/tutor/CompleteProfileFlow'
import NewOnboardingFlow from '@/components/tutor/NewOnboardingFlow'

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

  const { data: profile } = await supabase.from('profiles').select('role, admin_role').eq('id', user.id).maybeSingle()
  if (profile?.role !== 'tutor') redirect('/')

  // PR106-G3 §1: the new flow is shown per the owner switch — "staff only" (the
  // default) gives it to owner/staff, "everyone" to all tutors, "off" to none.
  const newFlow = showNewOnboarding(await getOnboardingMode(), !!profile?.admin_role)

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
  const manual = await manualInstructions()

  if (newFlow) {
    return <NewOnboardingFlow seed={user.id} smsAvailable={smsDeliverable()} helpWaHref={whatsappHref(support.whatsapp, "Assalam-o-Alaikum, I need help choosing my subjects on TutorMint.")} />
  }

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
      manual={manual}
      newFlow={newFlow}
    />
  )
}
