// lib/social/copy.ts
//
// Every word on a social creative — PURE (no next/og, no DB) — so the render
// module and the caption box read the SAME strings, and scripts/test-social.ts
// can scan a template's text without importing the satori pipeline.
//
// THE BRAND BAND is fixed on all four templates and all three formats: the
// one-word wordmark, the tagline exactly once, the site, the handle line and a
// QR. The word "commission" appears ONLY in the tagline — the test asserts a
// single occurrence across each template's whole text.

import { levelLabel, jobType } from '@/lib/display'
import { isOnlineType } from '@/lib/matchChip'

export type SocialTemplate = 'verified' | 'spotlight' | 'bold' | 'success' | 'announcement'
export type SocialFormat = 'square' | 'story' | 'wide'

export const SOCIAL_TEMPLATES: SocialTemplate[] = ['verified', 'spotlight', 'bold', 'success', 'announcement']

/** The template the generator opens on (owner, 21 Oct 2026). */
export const DEFAULT_SOCIAL_TEMPLATE: SocialTemplate = 'verified'
export const SOCIAL_FORMATS: SocialFormat[] = ['square', 'story', 'wide']

export function isSocialTemplate(v: string): v is SocialTemplate {
  return (SOCIAL_TEMPLATES as string[]).includes(v)
}
export function isSocialFormat(v: string): v is SocialFormat {
  return (SOCIAL_FORMATS as string[]).includes(v)
}

export type SocialData = {
  slug: string
  name: string
  /** The tutor's own profile headline (spotlight / bold sub-line fallback). */
  tutorHeadline?: string | null
  badges: string[]
  /** Already "Level Subject" display strings (levelLabel applied by the resolver). */
  subjects: string[]
  ratingAvg: number | null
  ratingCount: number | null
  experienceYears: number | null
  /** Canonical teaching_mode: 'in_person' | 'online' | 'both'. */
  teachingMode: string | null
  city: string | null
  area: string | null
  profileUrl: string
  /** success only: what the card celebrates. */
  successKind?: 'verified' | 'hired'
  /** The admin's Headline field (max 90). */
  headline?: string | null
  /** announcement only: the detail / venue line. */
  subhead?: string | null
}

// ---- the band -------------------------------------------------------------

export const WORDMARK = 'TutorMint'
export const TAGLINE = 'Free to join. No commission. No middleman.'
export const SITE = 'tutormint.org'
export const HANDLE = '@tutormint.official'
export const X_HANDLE = 'X: @TutorMint5'

/** The band's text, in order — the single source both the render and the test read. */
export function bandTextLines(): string[] {
  return [WORDMARK, TAGLINE, SITE, HANDLE, X_HANDLE]
}

// ---- the "I'm a Verified Tutor" template (owner, 21 Oct 2026) -------------
//
// The big headline is drawn as two runs, "I'm a " and "Verified Tutor", the
// second in green, with a drawn tick after it (a ✓ glyph is not in the render
// font, so it is an inline SVG — the same reason the star is).

export const VERIFIED_HEADLINE_LEAD = "I'm a "
export const VERIFIED_HEADLINE_ACCENT = 'Verified Tutor'
export const VERIFIED_SUBLINE = 'Verified tutors get trusted by more parents.'
export const VERIFIED_CTA = 'Get your profile verified'
export const VERIFIED_CTA_SITE = 'tutormint.org'

/** The line under the big headline: the admin's Headline field when filled
 *  (max 90 characters, as for every template), else the standard line. */
export function verifiedSubline(headline: string | null | undefined): string {
  const h = (headline ?? '').trim().slice(0, 90)
  return h || VERIFIED_SUBLINE
}

// ---- the body -------------------------------------------------------------

/** Up to three subjects, singular level labels applied. */
export function subjectLabels(subjects: string[], limit = 3): string[] {
  return subjects
    .map((s) => levelLabel(s).trim())
    .filter(Boolean)
    .slice(0, limit)
}

/** The Job Type chip. An online tutor reads "Suitable for online"; the others
 *  read their Job Type (Home Tuition / School Job). */
export function teachingChip(mode: string | null | undefined): string | null {
  if (!mode) return null
  if (isOnlineType(mode)) return 'Suitable for online'
  return jobType(mode)
}

/** "4.9 (27)" when there are reviews, else null. */
export function ratingText(avg: number | null, count: number | null): string | null {
  if (!avg || !count || count <= 0) return null
  return `${avg.toFixed(1)} (${count})`
}

/** "5+ years experience" / "1 year experience", or null. */
export function experienceText(years: number | null): string | null {
  if (!years || years <= 0) return null
  return years === 1 ? '1 year experience' : `${years}+ years experience`
}

/** "DHA Phase 5 · Lahore", or whichever half is present, or null. */
export function placeText(area: string | null, city: string | null): string | null {
  return [area?.trim(), city?.trim()].filter(Boolean).join(' · ') || null
}

// ---- the headline, sub-line and CTA of each template (PR C2) -------------
//
// Every template has the same structure: a heavy headline with its key words in
// green, an optional sub-line, the tutor, and a CTA pill "<label> → tutormint.org".

export type Headline = {
  text: string
  /** How many words at the END are the green key words (0 = none). */
  accentWords: number
  /** The whole headline is the key word. */
  accentAll?: boolean
  /** Drawn after the last word: the verified tick or the party popper. */
  tail?: 'tick' | 'confetti'
}

export const ANNOUNCEMENT_DEFAULT = 'New on TutorMint'
export const SPOTLIGHT_HEADLINE = 'Meet your next tutor'
export const BOLD_HEADLINE = 'Hire a Verified Tutor'
export const SUCCESS_HEADLINE = 'Congratulations'
export const HIRE_CTA = 'Hire verified tutors'

const clip90 = (s: string | null | undefined) => (s ?? '').trim().slice(0, 90)

export function headlineFor(template: SocialTemplate, data: SocialData): Headline {
  switch (template) {
    case 'verified':
      return { text: VERIFIED_HEADLINE_LEAD + VERIFIED_HEADLINE_ACCENT, accentWords: 2, tail: 'tick' }
    case 'spotlight':
      return { text: SPOTLIGHT_HEADLINE, accentWords: 2 }
    case 'bold':
      return { text: BOLD_HEADLINE, accentWords: 2 }
    case 'success':
      return { text: SUCCESS_HEADLINE, accentWords: 0, accentAll: true, tail: 'confetti' }
    case 'announcement':
      return { text: clip90(data.headline) || ANNOUNCEMENT_DEFAULT, accentWords: 1 }
  }
}

/** The smaller line under the headline, or null. */
export function subLineFor(template: SocialTemplate, data: SocialData): string | null {
  if (template === 'verified') return verifiedSubline(data.headline)
  if (template === 'spotlight' || template === 'bold') return clip90(data.headline) || clip90(data.tutorHeadline) || null
  if (template === 'announcement') return clip90(data.subhead) || null
  return null
}

/** Success only: the occasion under "Congratulations". */
export function occasionFor(template: SocialTemplate, data: SocialData): string | null {
  if (template !== 'success') return null
  return clip90(data.headline) || (data.successKind === 'hired' ? 'You got hired!' : "You're Verified!")
}

/** The CTA pill: a label, an arrow, and tutormint.org in bold. */
export function ctaParts(template: SocialTemplate, data: SocialData): { label: string; site: string } {
  if (template === 'verified') return { label: VERIFIED_CTA, site: VERIFIED_CTA_SITE }
  if (template === 'success') {
    return { label: data.successKind === 'hired' ? 'Hired through TutorMint' : 'Verified on TutorMint', site: SITE }
  }
  return { label: HIRE_CTA, site: SITE }
}

/** The CTA as one line of text. */
export function ctaText(template: SocialTemplate, data: SocialData): string {
  const c = ctaParts(template, data)
  return `${c.label} → ${c.site}`
}

/** Every BODY string a template renders (no footer), for the text scans. */
export function bodyTextLines(template: SocialTemplate, data: SocialData): string[] {
  const occasion = occasionFor(template, data)
  const sub = subLineFor(template, data)
  return [
    headlineFor(template, data).text,
    ...(occasion ? [occasion] : []),
    ...(sub ? [sub] : []),
    data.name,
    ...data.badges.filter((b) => b !== 'Verified'),
    ...subjectLabels(data.subjects),
    ...(data.city?.trim() ? [data.city.trim()] : []),
    ctaText(template, data),
  ]
}

/** The whole creative's text: band + body. What test-social.ts scans. */
export function socialText(template: SocialTemplate, data: SocialData): string[] {
  return [...bandTextLines(), ...bodyTextLines(template, data)]
}

// ---- the caption ----------------------------------------------------------

function sanitizeTag(s: string): string {
  return s.replace(/[^a-z0-9]/gi, '')
}

/** Exactly five hashtags: brand, city, subject, and two evergreen. */
export function hashtags(data: SocialData): string[] {
  const subjects = subjectLabels(data.subjects)
  const cityTag = data.city ? `#${sanitizeTag(data.city)}Tutors` : null
  // The subject word (last token of "Level Subject"), e.g. "O Level Physics" → Physics.
  const subjectWord = subjects[0] ? sanitizeTag(subjects[0].split(/\s+/).pop() ?? '') : ''
  const subjectTag = subjectWord ? `#${subjectWord}Tutor` : null
  const pool = [
    '#TutorMint',
    cityTag,
    subjectTag,
    '#VerifiedTutors',
    '#OnlineTutoring',
    '#Tuition',
    '#Pakistan',
    '#HomeTutor',
  ]
  const out: string[] = []
  for (const t of pool) {
    if (t && !out.includes(t)) out.push(t)
    if (out.length === 5) break
  }
  return out
}

/** A ready-to-paste caption: one line about the tutor, the tagline once, the
    profile URL, the handles, and five hashtags. Announcement leads with the
    admin's headline. */
export function buildCaption(template: SocialTemplate, data: SocialData): string {
  const subjects = subjectLabels(data.subjects)
  const lead =
    template === 'announcement' && (data.headline ?? '').trim()
      ? (data.headline as string).trim()
      : `Meet ${data.name} — a verified ${subjects[0] ? subjects[0] + ' ' : ''}tutor${
          data.city ? ' in ' + data.city : ''
        } on TutorMint.`
  return [
    lead,
    TAGLINE,
    data.profileUrl,
    `${HANDLE} · ${X_HANDLE}`,
    hashtags(data).join(' '),
  ].join('\n')
}
