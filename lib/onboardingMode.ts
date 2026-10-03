// lib/onboardingMode.ts
//
// The "New onboarding" rollout switch (PR106-G3 §1), kept PURE so the routing
// decision is unit-tested and client-safe. The mode lives in app_settings under
// `onboarding.new_mode`; the server reader is lib/onboardingModeServer.ts.
//
//   off      → nobody sees the new flow (instant fallback to the current one)
//   staff    → owner + staff accounts see the new flow; everyone else the current
//   everyone → every tutor sees the new flow
//
// Default is "staff" (unset / unreadable → staff), so a brand-new or misread
// setting never exposes the new flow to a real tutor.

export type OnboardingMode = 'off' | 'staff' | 'everyone'

export const ONBOARDING_MODE_KEY = 'onboarding.new_mode'

export function parseOnboardingMode(v: string | null | undefined): OnboardingMode {
  return v === 'off' || v === 'everyone' ? v : 'staff'
}

/** Does THIS viewer get the new flow? `isStaff` = owner or any admin_role. */
export function showNewOnboarding(mode: OnboardingMode, isStaff: boolean): boolean {
  if (mode === 'everyone') return true
  if (mode === 'staff') return isStaff
  return false
}
