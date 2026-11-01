// lib/retiredAdminCore.ts
//
// Admin screens retired or merged on 31 Oct 2026 (owner-approved deep-scan
// recommendations). Retiring = off the sidebar and every screen, the address
// redirects, the DATA IS KEPT. Pure: the redirect pages, the retired API
// answers and scripts/test-push1.ts read this one list.
//
// Each retired page is a page file that calls permanentRedirect, not a
// next.config redirect: the proxy's sign-in check runs first, so a signed-out
// visitor is sent to /login once instead of hopping through the new address.

import { memberEditHref } from '@/lib/memberEditCore'
import { paymentSettingsHref } from '@/lib/paymentSettingsCore'

export const RETIRED_ADMIN_PAGES: Record<string, string> = {
  // Retired (data kept)
  '/admin/ads': '/admin',
  '/admin/users/featured-whatsapp': '/admin/follow-ups',
  '/admin/team-activity/claims': '/admin/team-activity',
  '/admin/overview/todo-featured': '/admin',
  // Merged
  '/admin/payments/settings/gateways': paymentSettingsHref('bank-transfer'),
  '/admin/payments/bank-details': paymentSettingsHref('bank-transfer'),
  '/admin/finance/settings': paymentSettingsHref('fee-match-and-reader'),
  '/admin/settings/email': '/admin/settings/messaging#email',
  '/admin/settings/email-usage': '/admin/settings/messaging#usage',
  '/admin/settings/sms': '/admin/settings/messaging#sms',
}

/** /admin/tutors/<id> → the member page's Edit tab (the videos list keeps its own page). */
export function tutorRecordRedirect(path: string): string | null {
  const m = /^\/admin\/tutors\/([0-9a-f-]{36})\/?$/i.exec(path)
  return m ? memberEditHref(m[1]) : null
}

/** Retired admin API routes answer 410 with this, and change nothing. */
export const RETIRED_API_MESSAGE = 'This feature has been retired. Nothing was changed.'
export const RETIRED_ADMIN_APIS = [
  '/api/admin/ads',
  '/api/admin/outreach/featured',
  '/api/admin/staff-signups/claims',
  '/api/admin/staff-signups/claims/decide',
] as const
