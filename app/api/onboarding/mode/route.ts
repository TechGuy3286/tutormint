import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { getOnboardingMode } from '@/lib/onboardingModeServer'
import { showNewOnboarding } from '@/lib/onboardingMode'

// Does THIS viewer get the new onboarding / new payment surfaces? (PR106-G4b §3)
// The apply-gate upgrade modal is a global CLIENT component, so it reads the
// staff-switch decision here rather than making the static root layout async.
// Resolves the same way the server pages do: the app_settings mode + the
// viewer's admin_role. Signed-out / read failure → false (today's screen).

export async function GET() {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  let isStaff = false
  if (user) {
    const { data } = await supabase.from('profiles').select('admin_role').eq('id', user.id).maybeSingle()
    isStaff = !!data?.admin_role
  }
  const mode = await getOnboardingMode()
  return NextResponse.json({ staffNew: showNewOnboarding(mode, isStaff) })
}
