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
import { addRefToUrl, waShareHref, withStaffRef } from './waLinkCore'

export const PUBLIC_PROFILE_ORIGIN = 'https://www.tutormint.org'

export type ProfileShare =
  | { url: string; disabledReason: null; message?: string | null }
  | { url: null; disabledReason: string; message?: string | null }

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

// ---------------------------------------------------------------------------
// The ready message "Share on WhatsApp" sends (owner, 28 Oct 2026). Editable in
// Team inbox → Templates → Share profile; simple English. For a tutor without
// the Verified badge the word "verified" is left out.

export const PROFILE_SHARE_TEMPLATE_KEY = 'profile_share' as const
export const PROFILE_SHARE_PLACEHOLDERS = ['tutor_name', 'city', 'subjects', 'profile_link'] as const
export const PROFILE_SHARE_DEFAULT = 'Meet {tutor_name}, a verified tutor in {city} for {subjects}.\nSee the profile:\n{profile_link}'

/** "English, Maths and Physics" — at most three, then "and more". */
export function shareSubjectsLine(names: readonly string[]): string {
  const list = [...new Set(names.map((n) => n.trim()).filter(Boolean))]
  if (list.length === 0) return ''
  if (list.length > 3) return `${list.slice(0, 3).join(', ')} and more`
  if (list.length === 1) return list[0]
  return `${list.slice(0, -1).join(', ')} and ${list[list.length - 1]}`
}

/** Fill the share template. An empty part drops its words cleanly; a tutor
 *  without the Verified badge is never called verified. */
export function fillShareMessage(
  body: string,
  f: { name: string; city: string | null; subjects: readonly string[]; link: string; verified: boolean },
): string {
  const template = body.trim() ? body : PROFILE_SHARE_DEFAULT
  const subjects = shareSubjectsLine(f.subjects)
  const city = (f.city ?? '').trim()
  let out = template
  if (!city) out = out.replace(/\s+in\s+\{city\}/g, '')
  if (!subjects) out = out.replace(/\s+for\s+\{subjects\}/g, '')
  out = out
    .replace(/\{tutor_name\}/g, f.name.trim() || 'this tutor')
    .replace(/\{city\}/g, city)
    .replace(/\{subjects\}/g, subjects)
    .replace(/\{profile_link\}/g, f.link)
  if (!f.verified) out = out.replace(/\bverified\s+/gi, '')
  return out
    .replace(/[ \t]+\n/g, '\n')
    .replace(/ {2,}/g, ' ')
    .trim()
}

/** The share link the WhatsApp button opens: the message (with the staff ref
 *  added to the profile link inside it), or the bare link when there is none. */
export function shareMessageHref(share: { url: string | null; message?: string | null }, refCode: string | null): string | null {
  if (!share.url) return null
  const text = share.message ? withStaffRef(share.message, refCode) : addRefToUrl(share.url, refCode)
  return waShareHref(text)
}

