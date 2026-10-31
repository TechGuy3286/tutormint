// lib/templateRetireCore.ts — PURE (owner, 31 Oct 2026).
//
// RETIRED TEMPLATES: a template no code path sends any more is marked retired
// (admin_message_templates.retired_at, migration 215) — never deleted. Team
// inbox → Templates shows it under a collapsed "Retired (n)" section, read only,
// and it is never offered in the compose box or sent.
//
// The compose box also never offers a template that only a screen can fill:
// the parent situation messages (pf_*, sent from the parent's WhatsApp button
// with their tuition and tutor links), the Applications and Follow-ups
// messages, the forward list and the seeded-tuition message.

export type RetirableTemplate = { key: string; retired?: boolean | null }

/** The keys migration 215 retired (deep scan, 31 Oct 2026). */
export const RETIRED_TEMPLATE_KEYS = [
  'job_under_review',
  'payment_received',
  'payment_approved',
  'consent_ask',
  'signup_email_unconfirmed',
  'signup_profile_unfinished',
] as const

/** Templates a screen fills with its own data — never hand-picked in compose. */
const SCREEN_ONLY = new Set(['seeded_tuition_live', 'applicants_forward', 'profile_share', 'status_image_verified', 'city_hiring_post'])

export function isRetired(t: RetirableTemplate): boolean {
  return !!t.retired
}

export function splitRetired<T extends RetirableTemplate>(templates: T[]): { live: T[]; retired: T[] } {
  const live: T[] = []
  const retired: T[] = []
  for (const t of templates) (isRetired(t) ? retired : live).push(t)
  return { live, retired }
}

/** May staff pick this template in the Team inbox compose box? */
export function composeOffers(t: RetirableTemplate): boolean {
  if (isRetired(t)) return false
  const k = t.key
  if (k.startsWith('pf_') || k.startsWith('app_') || k.startsWith('fu_')) return false
  return !SCREEN_ONLY.has(k)
}

export const RETIRED_SEND_REFUSAL = 'This template is retired and is no longer sent.'
