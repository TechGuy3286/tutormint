// lib/tutorMeta.ts
//
// A tutor profile's meta description (owner, 13 Oct 2026). PURE.
//
//   "<Name> — verified <subjects> tutor in <areas, city> (home/online).
//    Contact directly on TutorMint, no commission."
//
// "verified" is said only when the caller says the tutor IS verified (the page
// is indexable: fee paid and documents approved) — never as a blanket claim.
// The mode comes from the tutor's own Job Types: "Home Tutor" → home, "Online
// Tutor" → online; a tutor with neither has no bracket.

import { placeLabel } from '@/lib/place'

const HOME_TITLE = 'home tutor'
const ONLINE_TITLE = 'online tutor'

export function tutorModeWords(jobTypes: (string | null | undefined)[]): string[] {
  const set = new Set(jobTypes.map((t) => (t ?? '').trim().toLowerCase()))
  const out: string[] = []
  if (set.has(HOME_TITLE)) out.push('home')
  if (set.has(ONLINE_TITLE)) out.push('online')
  return out
}

export function tutorMetaDescription(t: {
  name: string
  subjects: string[]
  city: string | null
  areas: string[]
  jobTypes: (string | null | undefined)[]
  verified: boolean
}): string {
  const subjects = t.subjects.filter(Boolean).slice(0, 3).join(', ')
  const city = (t.city ?? '').trim()
  const areas = [...new Set(t.areas.map((a) => (a ?? '').trim()).filter(Boolean))].slice(0, 2)
  // "DHA & Gulberg, Lahore" — the city once, never repeated inside an area.
  const where =
    areas.length > 0 && city
      ? `${areas.map((a) => placeLabel(a, city).replace(new RegExp(`,\\s*${city}$`, 'i'), '')).join(' & ')}, ${city}`
      : city || areas.join(' & ') || 'Pakistan'
  const modes = tutorModeWords(t.jobTypes)
  const what = [t.verified ? 'verified' : '', subjects, 'tutor'].filter(Boolean).join(' ')
  return `${t.name} — ${what} in ${where}${modes.length ? ` (${modes.join('/')})` : ''}. Contact directly on TutorMint, no commission.`
}
