// lib/profileShareCore.ts
//
// "Copy profile link" and "Share on WhatsApp" (owner, 20 Oct 2026) — on the
// admin member page and every admin tutor card. Both send the clean public
// profile address (https://www.tutormint.org/tutor/<slug>, no query string).
//
// A profile is PUBLIC when the tutor is in the public directory (the
// tutor_directory view — the same rule "Open public profile" has used since
// PR39) and has a profile address. Otherwise both buttons are disabled and say
// why, from the directory's own reasons (lib/tutorListingStatus BLOCKER_LABEL),
// never guessed. The Verification Fee is NOT a listing condition (removed in
// PR16), so "fee not paid" is never given as a reason here.
//
// PURE — unit-tested by scripts/test-admin-cleanup.ts.

import { BLOCKER_LABEL, type ListingBlocker } from '@/lib/tutorListingStatus'
import { waShareHref } from './waLinkCore'

export const PUBLIC_PROFILE_ORIGIN = 'https://www.tutormint.org'

export type ProfileShare =
  | { url: string; disabledReason: null }
  | { url: null; disabledReason: string }

export function publicProfileUrl(slug: string): string {
  return `${PUBLIC_PROFILE_ORIGIN}/tutor/${encodeURIComponent(slug)}`
}

/** WhatsApp with the link ready to send to any contact. */
export function whatsappShareHref(url: string): string {
  return waShareHref(url)
}

const lowerFirst = (s: string) => (s ? s[0].toLowerCase() + s.slice(1) : s)

export function profileShareState(f: {
  slug: string | null | undefined
  listed: boolean
  blockers: ListingBlocker[]
}): ProfileShare {
  const slug = (f.slug ?? '').trim()
  if (f.listed && slug) return { url: publicProfileUrl(slug), disabledReason: null }
  if (f.listed) return { url: null, disabledReason: 'Profile not public yet: no profile address' }
  const reasons = f.blockers.map((b) => lowerFirst(BLOCKER_LABEL[b]))
  return {
    url: null,
    disabledReason: reasons.length ? `Profile not public yet: ${reasons.join(', ')}` : 'Profile not public yet',
  }
}
