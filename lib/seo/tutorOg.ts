// lib/seo/tutorOg.ts
//
// What a shared tutor profile link shows (owner, 21 Oct 2026 — PR C3). PURE.
//
// The old og:title was seoTitle("<Name> — <three subjects> tutor in <City>"),
// cut at a word when too long — which left "…English, General Knowledge,
// General". Now the title is the first of a list of WHOLE forms that fits about
// 60 characters: two subjects, one subject, the level range, then the first name
// instead of the full name, then no subject at all. Nothing is ever cut inside a
// word or a subject.

import { collapseLevels } from '@/lib/levelDisplay'
import { TITLE_MAX, DESCRIPTION_MAX, clampWords } from '@/lib/seo'

export const OG_TAGLINE = 'Free to join. No commission. No middleman.'
const BRAND = 'TutorMint'

const clean = (s: string | null | undefined) => (s ?? '').replace(/\s+/g, ' ').trim()

/** The distinct subject names, in profile order. */
export function distinctSubjects(subjects: (string | null | undefined)[]): string[] {
  const out: string[] = []
  for (const s of subjects.map(clean).filter(Boolean)) if (!out.some((x) => x.toLowerCase() === s.toLowerCase())) out.push(s)
  return out
}

export function tutorOgTitle(t: { name: string; subjects: (string | null | undefined)[]; levels: (string | null | undefined)[]; city: string | null | undefined }): string {
  const name = clean(t.name) || 'Tutor'
  const first = name.split(' ')[0]
  const city = clean(t.city)
  const subjects = distinctSubjects(t.subjects)
  const levels = collapseLevels(t.levels.map(clean).filter(Boolean))
  const where = city ? ` in ${city}` : ''
  const summaries: string[] = []
  // Many subjects read best as their level range ("Grade 1–5"); two as a pair.
  if (subjects.length > 2 && levels) summaries.push(levels)
  if (subjects.length >= 2) summaries.push(`${subjects[0]}, ${subjects[1]}`)
  if (subjects.length >= 1) summaries.push(subjects[0])
  if (levels && !summaries.includes(levels)) summaries.push(levels)
  const candidates: string[] = []
  for (const who of first === name ? [name] : [name, first]) {
    for (const s of summaries) candidates.push(`${who} — ${s} tutor${where} | ${BRAND}`)
    candidates.push(`${who} — Tutor${where} | ${BRAND}`)
  }
  candidates.push(`${first} | ${BRAND}`)
  return candidates.find((c) => c.length <= TITLE_MAX) ?? clampWords(first, TITLE_MAX)
}

/** Up to 155 characters: the tutor's own headline (else what they teach), then
 *  the tagline. The lead is shortened at a word, never the tagline. */
export function tutorOgDescription(t: { headline: string | null | undefined; subjects: (string | null | undefined)[]; city: string | null | undefined }): string {
  const city = clean(t.city)
  const subjects = distinctSubjects(t.subjects).slice(0, 3)
  const head = clean(t.headline)
  let lead = head || (subjects.length ? `Teaches ${subjects.join(', ')}${city ? ` in ${city}` : ''}.` : `Tutor${city ? ` in ${city}` : ''} on TutorMint.`)
  if (!/[.!?]$/.test(lead)) lead += '.'
  const room = DESCRIPTION_MAX - OG_TAGLINE.length - 1
  if (lead.length > room) lead = clampWords(lead, room - 1).replace(/[.!?,;:]+$/, '') + '…'
  return `${lead} ${OG_TAGLINE}`
}

/**
 * The share image's version: a short hash of everything the image draws (the
 * photo or whether it is hidden, the name, verification, city, subjects). It is
 * part of the image URL, so a change to any of them gives a new URL — and
 * WhatsApp / Facebook fetch the new picture — while an unchanged profile keeps a
 * long-cached one.
 */
export function shareImageVersion(f: { avatar: string | null; photoShown: boolean; name: string; verified: boolean; city: string | null; subjects: string[]; headline?: string | null }): string {
  const key = JSON.stringify([f.photoShown ? f.avatar ?? '' : 'hidden', clean(f.name), f.verified, clean(f.city), f.subjects.map(clean), clean(f.headline)])
  let h = 0x811c9dc5
  for (let i = 0; i < key.length; i++) {
    h ^= key.charCodeAt(i)
    h = Math.imul(h, 0x01000193) >>> 0
  }
  return h.toString(36)
}

export function shareImagePath(slug: string, version: string): string {
  return `/og/tutor/${encodeURIComponent(slug)}?v=${version}`
}
