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
import { withArticle } from '@/lib/article'

export type SocialTemplate =
  | 'verified'
  | 'spotlight'
  | 'bold'
  | 'success'
  | 'announcement'
  // PR C3 (owner, 21 Oct 2026) — seven layouts of their own.
  | 'split'
  | 'idcard'
  | 'quote'
  | 'subject'
  | 'group'
  | 'justverified'
  | 'polaroid'
  // INTERNAL — the neutral link-preview card for a tutor who is not verified
  // ('Tutor on TutorMint'; never says Verified). Not offered on Social posts.
  | 'profile'
export type SocialFormat = 'square' | 'story' | 'wide'

/** The twelve templates the admin can pick (the internal 'profile' look is not one). */
export const SOCIAL_TEMPLATES: SocialTemplate[] = [
  'verified',
  'spotlight',
  'bold',
  'success',
  'announcement',
  'split',
  'idcard',
  'quote',
  'subject',
  'group',
  'justverified',
  'polaroid',
]

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
  /** The tutor's subjects as level + subject (the subject template's big word). */
  subjectParts?: { level: string; subject: string | null }[]
  /** group only: the city and the 4–6 tutors on the post. */
  group?: { city: string; tutors: { name: string; subject: string | null }[] } | null
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
// second in green. No tick after it (PR C3): the ✓ badge on the photo ring is
// the one tick on the post.

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

// ---- the headline, sub-line and CTA of each template (PR C2 + C3) --------
//
// Every C2 template has the same structure: a heavy headline with its key words
// in green, an optional sub-line, the tutor, and a CTA pill "<label> →
// tutormint.org". The seven C3 templates have layouts of their own
// (app/api/admin/social/image/layouts.tsx) but read their words from here too.

export type Headline = {
  text: string
  /** How many words at the END are the green key words (0 = none). */
  accentWords: number
  /** The whole headline is the key word. */
  accentAll?: boolean
  /** Drawn after the last word: a tick or the party popper. The "I'm a
   *  Verified Tutor" headline has NO tick (owner, 21 Oct 2026 — PR C3: the ✓
   *  badge on the photo ring is the one tick). */
  tail?: 'tick' | 'confetti'
}

export const ANNOUNCEMENT_DEFAULT = 'New on TutorMint'
export const SPOTLIGHT_HEADLINE = 'Meet your next tutor'
export const BOLD_HEADLINE = 'Hire a Verified Tutor'
export const SUCCESS_HEADLINE = 'Congratulations'
export const HIRE_CTA = 'Hire verified tutors'

// PR C3 — the seven new templates.
export const SPLIT_HEADLINE = 'Learn with a verified tutor'
export const IDCARD_HEADLINE = 'Meet a verified tutor'
/** The card's own title. Deliberately NOT "identity card" or anything that reads
 *  like a government document. */
export const IDCARD_TITLE = 'TutorMint Tutor'
export const IDCARD_SEAL = 'Verified by TutorMint'
export const POLAROID_HEADLINE = 'Meet your next tutor'
export const JUST_VERIFIED_LEAD = 'Another tutor just got verified'
export const GROUP_LEAD = 'Verified tutors in'
/** The neutral link-preview card for a tutor who is not verified. */
export const PROFILE_HEADLINE = 'Tutor on TutorMint'
export const PROFILE_CTA = 'View profile'
export const VERIFY_CTA = 'Get your profile verified'

const clip90 = (s: string | null | undefined) => (s ?? '').trim().slice(0, 90)
const words = (s: string) => s.trim().split(/\s+/).filter(Boolean).length

/** The tutor's own profile headline, exactly as written (trimmed). Null when
 *  there is none — the "Tutor's own words" template is then unavailable. */
export function ownWords(data: Pick<SocialData, 'tutorHeadline'>): string | null {
  const t = (data.tutorHeadline ?? '').replace(/\s+/g, ' ').trim()
  return t || null
}

/** What the picker says when "Tutor's own words" cannot be used. */
export const NO_HEADLINE_MESSAGE = 'No headline on profile'

/** The tutor's top subject as level + subject, from the profile. */
export function topSubject(data: SocialData): { level: string; subject: string | null } | null {
  const p = data.subjectParts?.find((x) => (x.subject ?? x.level).trim())
  if (p) return { level: levelLabel(p.level).trim(), subject: p.subject?.trim() || null }
  const label = subjectLabels(data.subjects, 1)[0]
  return label ? { level: '', subject: label } : null
}

/** The huge background word of the subject template: the subject's own name in
 *  capitals (the level's name when the subject is a level, e.g. Holy Quran). */
export function subjectWord(data: SocialData): string {
  const t = topSubject(data)
  return (t?.subject ?? t?.level ?? 'TUTOR').toUpperCase()
}

/** "<level> <subject> tutor in <city>", from the profile. */
export function subjectLine(data: SocialData): string {
  const t = topSubject(data)
  const what = t ? [t.level, t.subject].filter(Boolean).join(' ') : ''
  const city = data.city?.trim()
  return `${what ? what + ' tutor' : 'Tutor'}${city ? ` in ${city}` : ''}`
}

export function headlineFor(template: SocialTemplate, data: SocialData): Headline {
  const city = data.city?.trim() || ''
  switch (template) {
    case 'verified':
      return { text: VERIFIED_HEADLINE_LEAD + VERIFIED_HEADLINE_ACCENT, accentWords: 2 }
    case 'spotlight':
      return { text: SPOTLIGHT_HEADLINE, accentWords: 2 }
    case 'bold':
      return { text: BOLD_HEADLINE, accentWords: 2 }
    case 'success':
      return { text: SUCCESS_HEADLINE, accentWords: 0, accentAll: true, tail: 'confetti' }
    case 'announcement':
      return { text: clip90(data.headline) || ANNOUNCEMENT_DEFAULT, accentWords: 1 }
    case 'split':
      return clip90(data.headline) ? { text: clip90(data.headline), accentWords: 0 } : { text: SPLIT_HEADLINE, accentWords: 2 }
    case 'idcard':
      return clip90(data.headline) ? { text: clip90(data.headline), accentWords: 0 } : { text: IDCARD_HEADLINE, accentWords: 2 }
    case 'polaroid':
      return clip90(data.headline) ? { text: clip90(data.headline), accentWords: 0 } : { text: POLAROID_HEADLINE, accentWords: 2 }
    case 'quote':
      return { text: ownWords(data) ?? '', accentWords: 0 }
    case 'subject':
      return { text: subjectLine(data), accentWords: 0 }
    case 'group': {
      const c = data.group?.city?.trim() || city
      return c ? { text: `${GROUP_LEAD} ${c}`, accentWords: words(c) } : { text: 'Verified tutors', accentWords: 1 }
    }
    case 'justverified':
      return city
        ? { text: `${JUST_VERIFIED_LEAD} in ${city}`, accentWords: words(city), tail: 'tick' }
        : { text: JUST_VERIFIED_LEAD, accentWords: 1, tail: 'tick' }
    case 'profile':
      return { text: PROFILE_HEADLINE, accentWords: 1 }
  }
}

/** The smaller line under the headline, or null. */
export function subLineFor(template: SocialTemplate, data: SocialData): string | null {
  if (template === 'verified') return verifiedSubline(data.headline)
  if (template === 'spotlight' || template === 'bold') return clip90(data.headline) || clip90(data.tutorHeadline) || null
  if (template === 'announcement') return clip90(data.subhead) || null
  if (template === 'split') return clip90(data.tutorHeadline) || null
  // The neutral preview never says Verified — not even in the tutor's own words.
  if (template === 'profile') return /verif/i.test(data.tutorHeadline ?? '') ? null : clip90(data.tutorHeadline) || null
  return null
}

/** Success only: the occasion under "Congratulations". */
export function occasionFor(template: SocialTemplate, data: SocialData): string | null {
  if (template !== 'success') return null
  return clip90(data.headline) || (data.successKind === 'hired' ? 'You got hired!' : "You're Verified!")
}

/** The CTA pill: a label, an arrow, and tutormint.org in bold. */
export function ctaParts(template: SocialTemplate, data: SocialData): { label: string; site: string } {
  if (template === 'verified' || template === 'justverified') return { label: VERIFIED_CTA, site: VERIFIED_CTA_SITE }
  if (template === 'profile') return { label: PROFILE_CTA, site: SITE }
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
  const city = data.city?.trim() ? [data.city.trim()] : []
  const head = headlineFor(template, data).text
  const tail = ctaText(template, data)
  switch (template) {
    case 'group':
      return [
        head,
        ...(data.group?.tutors ?? []).flatMap((t) => [t.name, ...(t.subject ? [levelLabel(t.subject)] : [])]),
        tail,
      ]
    case 'justverified':
      return [head, data.name, ...subjectLabels(data.subjects), tail]
    case 'quote':
      return [head, data.name, ...city, tail]
    case 'subject':
      return [subjectWord(data), head, data.name, tail]
    case 'idcard':
      return [head, IDCARD_TITLE, data.name, ...subjectLabels(data.subjects), ...city, IDCARD_SEAL, tail]
    default:
      return [
        head,
        ...(occasion ? [occasion] : []),
        ...(sub ? [sub] : []),
        data.name,
        ...data.badges.filter((b) => b !== 'Verified'),
        ...subjectLabels(data.subjects),
        ...city,
        tail,
      ]
  }
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
  const subjects = data.group ? data.group.tutors.map((t) => t.subject).filter(Boolean).map((s) => levelLabel(s as string)) : subjectLabels(data.subjects)
  const city = data.group?.city ?? data.city
  const cityTag = city ? `#${sanitizeTag(city)}Tutors` : null
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

/** The tutors-in-a-city page a group post links to. */
export function cityTutorsUrl(city: string): string {
  return `https://www.tutormint.org/browse/tutors?city=${encodeURIComponent(city.trim())}`
}

/** "A, B and C". */
function listNames(names: string[]): string {
  if (names.length <= 1) return names[0] ?? ''
  return `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`
}

/**
 * THREE caption leads per template (owner, 21 Oct 2026 — PR C3): the same facts
 * in different words. Every fact comes from the live profile (name, subjects,
 * city, the tutor's own headline) or the admin's Headline field; nothing is
 * invented, no price, no superlative.
 */
export function captionLeads(template: SocialTemplate, data: SocialData): [string, string, string] {
  const subjects = subjectLabels(data.subjects)
  const s = subjects[0] ? subjects[0] + ' ' : ''
  const inCity = data.city?.trim() ? ` in ${data.city.trim()}` : ''
  const name = data.name
  const teaches = subjects.length ? `${name} teaches ${listNames(subjects)}${inCity}.` : `${name} teaches${inCity || ' on TutorMint'}.`
  const generic: [string, string, string] = [
    `Meet ${name} — a verified ${s}tutor${inCity} on TutorMint.`,
    `Looking for ${withArticle(s + 'tutor')}${inCity}? ${name} is verified on TutorMint.`,
    `${teaches} Verified on TutorMint — see the profile.`,
  ]
  const h = (data.headline ?? '').trim()
  switch (template) {
    case 'announcement':
      return h ? [h, `${h} — meet ${name}${inCity}.`, `News from TutorMint: ${h}`] : generic
    case 'success':
      return data.successKind === 'hired'
        ? [`${name} got hired through TutorMint${inCity}!`, `Congratulations to ${name} on being hired through TutorMint${inCity}.`, `Hired through TutorMint: ${name}, ${s}tutor${inCity}.`]
        : [`${name} is now verified on TutorMint${inCity}!`, `Congratulations to ${name} — verified on TutorMint${inCity}.`, `Verified on TutorMint: ${name}, ${s}tutor${inCity}.`]
    case 'justverified':
      return [
        `Another tutor just got verified${inCity}: ${name}.`,
        `Welcome ${name} — now verified on TutorMint${inCity}.`,
        `${name} is now a verified ${s}tutor${inCity}.`,
      ]
    case 'quote': {
      const q = ownWords(data)
      if (!q) return generic
      return [`“${q}” — ${name}${inCity ? ',' + inCity.replace(' in', '') : ''}`, `In ${name}'s own words: “${q}”`, `${name}, verified ${s}tutor${inCity}: “${q}”`]
    }
    case 'subject': {
      const line = subjectLine(data)
      const top = topSubject(data)
      if (!top) return generic
      const what = [top.level, top.subject].filter(Boolean).join(' ')
      return [`${line}: meet ${name}, verified on TutorMint.`, `Need ${withArticle(what + ' tutor')}${inCity}? ${name} is verified on TutorMint.`, `${name} — ${line}. Verified on TutorMint.`]
    }
    case 'group': {
      const g = data.group
      const city = g?.city ?? data.city ?? ''
      const names = (g?.tutors ?? []).map((t) => t.name)
      const where = city ? ` in ${city}` : ''
      return [
        `Verified tutors${where}: ${listNames(names)}.`,
        `Meet ${names.length} verified tutors${where} — ${listNames(names)}.`,
        `Looking for a tutor${where}? ${listNames(names)} are verified on TutorMint.`,
      ]
    }
    case 'profile':
      return [`${name} — ${s}tutor${inCity} on TutorMint.`, `${teaches}`, `See ${name}'s profile on TutorMint.`]
    default:
      return generic
  }
}

/** The three ready-to-paste captions: a lead, the tagline once, the link, the
    handles and five hashtags. The link and the hashtags are the same on all
    three; only the lead's wording changes. */
export function captionVariants(template: SocialTemplate, data: SocialData): [string, string, string] {
  const link = template === 'group' && data.group?.city ? cityTutorsUrl(data.group.city) : data.profileUrl
  const tail = [TAGLINE, link, `${HANDLE} · ${X_HANDLE}`, hashtags(data).join(' ')]
  return captionLeads(template, data).map((lead) => [lead, ...tail].join('\n')) as [string, string, string]
}

/** A ready-to-paste caption — the first of the three versions. */
export function buildCaption(template: SocialTemplate, data: SocialData): string {
  return captionVariants(template, data)[0]
}
