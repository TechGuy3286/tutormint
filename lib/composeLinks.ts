// lib/composeLinks.ts
//
// PURE, client-safe. The one link a Team inbox template carries (owner,
// 28 Oct 2026 — the simple-English rewrite: every message ends with one link).
// The compose box and the Follow-ups signup box fill {link} / {continue_link} /
// {pay_link} with this page, chosen by the template and the member's role.
// Parents are never sent to a sign-in page or a dashboard: their posting
// action is the public /post-tuition page.

import { siteLink } from '@/lib/waLinkCore'
import { POST_TUITION_PUBLIC_PATH } from '@/lib/postTuitionPage'

export type ComposeRole = 'tutor' | 'parent' | null

export function composeLinkPath(key: string, role: ComposeRole): string {
  const tutor = role === 'tutor'
  switch (key) {
    case 'cnic_unclear':
      return tutor ? '/tutor/dashboard/settings#identity' : '/parent/verify'
    case 'address_untraceable':
      return tutor ? '/tutor/dashboard/settings' : '/parent/verify'
    case 'video_rerecord':
    case 'no_whatsapp':
      return '/tutor/dashboard/settings'
    case 'fee_not_paid':
      return '/pay/choose?plan=verified'
    case 'profile_completion_nudge':
    case 'signup_profile_unfinished':
    case 'signup_mobile_unverified':
      return tutor ? '/tutor/onboarding' : POST_TUITION_PUBLIC_PATH
    default:
      return tutor ? '/tutor/dashboard' : '/browse/tutors'
  }
}

export function composeLink(key: string, role: ComposeRole): string {
  return siteLink(composeLinkPath(key, role))
}
