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

import { levelLabel, teachingMode } from '@/lib/display'
import { allowsOnline } from '@/lib/matchChip'

export type SocialTemplate = 'spotlight' | 'bold' | 'success' | 'announcement'
export type SocialFormat = 'square' | 'story' | 'wide'

export const SOCIAL_TEMPLATES: SocialTemplate[] = ['spotlight', 'bold', 'success', 'announcement']
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
  /** announcement only: the admin's headline. */
  headline?: string | null
}

// ---- the band -------------------------------------------------------------

export const WORDMARK = 'TutorMint'
export const TAGLINE = 'No fee. No commission. No middleman.'
export const SITE = 'tutormint.org'
export const HANDLE = '@tutormint.official'
export const X_HANDLE = 'X: @TutorMint5'

/** The band's text, in order — the single source both the render and the test read. */
export function bandTextLines(): string[] {
  return [WORDMARK, TAGLINE, SITE, HANDLE, X_HANDLE]
}

// ---- the body -------------------------------------------------------------

/** Up to three subjects, singular level labels applied. */
export function subjectLabels(subjects: string[], limit = 3): string[] {
  return subjects
    .map((s) => levelLabel(s).trim())
    .filter(Boolean)
    .slice(0, limit)
}

/** The teaching-mode chip. Online-capable tutors read "Suitable for online". */
export function teachingChip(mode: string | null | undefined): string | null {
  if (!mode) return null
  if (allowsOnline(mode)) return 'Suitable for online'
  return teachingMode(mode)
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

/** The template-specific call to action. */
export function ctaText(template: SocialTemplate, data: SocialData): string {
  if (template === 'success') {
    return data.successKind === 'hired'
      ? 'Congratulations — hired through TutorMint'
      : 'Congratulations — verified on TutorMint'
  }
  if (template === 'announcement') return (data.headline ?? '').trim() || 'Announcement'
  return 'Hire verified tutors on tutormint.org'
}

/** Every BODY string a template renders (no band), for the commission scan. */
export function bodyTextLines(template: SocialTemplate, data: SocialData): string[] {
  const lines: string[] = [data.name, ...data.badges, ...subjectLabels(data.subjects)]
  const r = ratingText(data.ratingAvg, data.ratingCount)
  if (r) lines.push(r)
  const e = experienceText(data.experienceYears)
  if (e) lines.push(e)
  const chip = teachingChip(data.teachingMode)
  if (chip) lines.push(chip)
  const place = placeText(data.area, data.city)
  if (place) lines.push(place)
  lines.push(ctaText(template, data))
  return lines
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
