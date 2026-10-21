// lib/social/templates.ts
//
// The social-post template catalogue and the Shuffle rule (owner, 21 Oct 2026 —
// PR C3). PURE — the admin screen, the render route and the tests read it.

import { SOCIAL_TEMPLATES, type SocialFormat, type SocialTemplate } from '@/lib/social/copy'

export type TemplateInfo = {
  label: string
  blurb: string
  /** How many colour looks the template has (0..n-1). */
  variants: number
  /** Looks good with the grey silhouette (a tutor who hid their photo). */
  photoFree: boolean
  /** Needs the tutor's own profile headline. */
  needsTutorHeadline?: boolean
  /** Several tutors from one city (picked separately). */
  multi?: boolean
  /** Uses the Headline field. */
  usesHeadline: boolean
}

export const TEMPLATE_INFO: Record<SocialTemplate, TemplateInfo> = {
  verified: { label: "I'm a Verified Tutor", blurb: 'Clean and light — the default', variants: 1, photoFree: false, usesHeadline: true },
  spotlight: { label: 'Spotlight', blurb: 'Light background, photo-led', variants: 1, photoFree: false, usesHeadline: true },
  bold: { label: 'Bold', blurb: 'Dark background, high contrast for feeds', variants: 1, photoFree: false, usesHeadline: true },
  success: { label: 'Success story', blurb: '“Congratulations” — verified or hired', variants: 1, photoFree: false, usesHeadline: true },
  announcement: { label: 'Announcement', blurb: 'Navy, for roundups and events', variants: 1, photoFree: false, usesHeadline: true },
  split: { label: 'Split card', blurb: 'Big photo beside the words — magazine profile', variants: 2, photoFree: false, usesHeadline: true },
  idcard: { label: 'Verified ID card', blurb: 'A tutor card with a seal and the profile QR', variants: 2, photoFree: true, usesHeadline: true },
  quote: { label: "Tutor's own words", blurb: 'Their profile headline as a quote', variants: 2, photoFree: true, needsTutorHeadline: true, usesHeadline: false },
  subject: { label: 'Subject spotlight', blurb: 'Their top subject as a huge word', variants: 2, photoFree: true, usesHeadline: false },
  group: { label: 'Meet our verified tutors', blurb: '4–6 verified tutors from one city', variants: 2, photoFree: true, multi: true, usesHeadline: false },
  justverified: { label: 'Just verified', blurb: 'Text only — no photo at all', variants: 2, photoFree: true, usesHeadline: false },
  polaroid: { label: 'Polaroid', blurb: 'A tilted print with a handwritten name', variants: 2, photoFree: false, usesHeadline: true },
  profile: { label: 'Profile preview', blurb: 'Link preview for a tutor who is not verified', variants: 1, photoFree: true, usesHeadline: false },
}

export function variantCount(t: SocialTemplate): number {
  return TEMPLATE_INFO[t].variants
}

/** A colour look within the template's range (anything odd → 0). */
export function clampVariant(t: SocialTemplate, v: unknown): number {
  const n = Math.round(Number(v))
  return Number.isFinite(n) && n >= 0 && n < variantCount(t) ? n : 0
}

/** Why a template cannot be used for this tutor, or null. */
export function templateUnavailable(t: SocialTemplate, tutor: { headline: string | null | undefined }): string | null {
  if (TEMPLATE_INFO[t].needsTutorHeadline && !(tutor.headline ?? '').trim()) return 'No headline on profile'
  return null
}

export type Pick = { template: SocialTemplate; variant: number }

/**
 * Shuffle: a random template for this tutor, and for Square / Story a random
 * colour look. Never the same template as the previous pick for this tutor.
 * Group posts are left out (they need a city and several tutors). A tutor who
 * hid their photo only gets templates that work without one — Just verified
 * among them. `rand` returns [0, 1) and is injected so the rule is testable.
 */
export function shufflePick(opts: {
  format: SocialFormat
  photoHidden: boolean
  hasHeadline: boolean
  previous: SocialTemplate | null
  rand?: () => number
}): Pick {
  const rand = opts.rand ?? Math.random
  const pool = SOCIAL_TEMPLATES.filter((t) => {
    const info = TEMPLATE_INFO[t]
    if (info.multi) return false
    if (info.needsTutorHeadline && !opts.hasHeadline) return false
    if (opts.photoHidden && !info.photoFree) return false
    return true
  })
  const fresh = pool.filter((t) => t !== opts.previous)
  const choices = fresh.length ? fresh : pool
  const template = choices[Math.min(choices.length - 1, Math.floor(rand() * choices.length))]
  const variant = opts.format === 'wide' ? 0 : Math.min(variantCount(template) - 1, Math.floor(rand() * variantCount(template)))
  return { template, variant }
}

/** The group post's limits. */
export const GROUP_MIN = 4
export const GROUP_MAX = 6

/** The default tutors for a group post: the most recently verified, up to six. */
export function defaultGroup<T extends { verifiedAt: string | null }>(tutors: T[]): T[] {
  return [...tutors].sort((a, b) => (b.verifiedAt ?? '').localeCompare(a.verifiedAt ?? '')).slice(0, GROUP_MAX)
}
