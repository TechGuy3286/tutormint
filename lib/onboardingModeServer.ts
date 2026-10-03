import 'server-only'

import { createClient } from '@/lib/supabase/server'
import { ONBOARDING_MODE_KEY, parseOnboardingMode, type OnboardingMode } from '@/lib/onboardingMode'

// Server reader for the "New onboarding" switch (PR106-G3 §1). Reads the
// app_settings row through the cookie-backed client; a missing row or a read
// failure falls back to the safe default ("staff") via parseOnboardingMode.

export async function getOnboardingMode(): Promise<OnboardingMode> {
  try {
    const supabase = await createClient()
    const { data } = await supabase
      .from('app_settings')
      .select('value')
      .eq('key', ONBOARDING_MODE_KEY)
      .maybeSingle()
    return parseOnboardingMode(data?.value as string | null | undefined)
  } catch {
    return 'staff'
  }
}
