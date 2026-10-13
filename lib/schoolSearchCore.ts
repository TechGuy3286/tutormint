// lib/schoolSearchCore.ts
//
// "Is this search a SCHOOL's name?" (owner, 13 Oct 2026). Parents type school
// names into the tutor search ("Beaconhouse School" was searched as a subject).
// A school is never a subject: when the typed text names a school we know, the
// search shows a row linking to that school's page instead.
//
// PURE — no I/O — so the suggest route, the Browse page, Unmet searches and the
// tests share one matcher (scripts/test-school-search.ts). The dictionary is the
// one the school hubs use (lib/schoolJobsCore knownSchools) plus the short names
// people actually type.

import type { KnownSchool } from '@/lib/schoolJobsCore'

/** Short names people type, by the school's dictionary name. Whole words only. */
export const SCHOOL_SHORT_NAMES: Record<string, string[]> = {
  'Beaconhouse School': ['beaconhouse', 'beacon house', 'bss'],
  'Lahore Grammar School': ['lgs'],
  'Karachi Grammar School': ['kgs'],
  'The City School': ['city school', 'tcs'],
  'Roots International Schools': ['roots'],
  'Allied School': ['allied'],
  'The Educators': ['educators'],
  'Army Public School': ['aps'],
  'The Smart School': ['smart school'],
  'Aitchison College': ['aitchison'],
  'Dar-e-Arqam School': ['dar e arqam', 'arqam'],
}

const norm = (s: string | null | undefined) =>
  (s ?? '')
    .toLowerCase()
    .replace(/[’'`.]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()

/** Levenshtein distance, stopping early past `max`. */
function distance(a: string, b: string, max: number): number {
  if (Math.abs(a.length - b.length) > max) return max + 1
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i)
  for (let i = 1; i <= a.length; i++) {
    const cur = [i]
    let rowMin = i
    for (let j = 1; j <= b.length; j++) {
      const v = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1))
      cur.push(v)
      if (v < rowMin) rowMin = v
    }
    if (rowMin > max) return max + 1
    prev = cur
  }
  return prev[b.length]
}

/** Every phrase that means this school, normalised. */
function phrasesFor(school: KnownSchool): string[] {
  const out = new Set<string>()
  const add = (v: string) => {
    const n = norm(v)
    if (n.length >= 3) out.add(n)
    // "The City School" is also typed "City School".
    if (n.startsWith('the ') && n.length >= 7) out.add(n.slice(4))
  }
  add(school.name)
  for (const a of school.aliases) add(a)
  for (const a of SCHOOL_SHORT_NAMES[school.name] ?? []) add(a)
  return [...out]
}

export type SchoolHit = { name: string; matched: string; fuzzy: boolean }

/**
 * The school a search names, or null. A phrase counts when it appears in the
 * search as WHOLE words ("lgs johar town" names LGS; "lgsx" does not); the
 * longest phrase wins. Failing that, one typed word within a letter or two of a
 * one-word school name of six letters or more ("beconhouse" → Beaconhouse).
 */
export function matchSchool(query: string | null | undefined, known: KnownSchool[]): SchoolHit | null {
  const q = norm(query)
  if (q.length < 3) return null
  const hay = ` ${q} `
  let best: SchoolHit | null = null
  for (const school of known) {
    for (const p of phrasesFor(school)) {
      if (hay.includes(` ${p} `) && (!best || p.length > best.matched.length)) best = { name: school.name, matched: p, fuzzy: false }
    }
  }
  if (best) return best

  const words = q.split(' ').filter((w) => w.length >= 6)
  let fuzzy: (SchoolHit & { d: number }) | null = null
  for (const school of known) {
    for (const p of phrasesFor(school)) {
      if (p.includes(' ') || p.length < 6) continue
      for (const w of words) {
        const max = p.length >= 9 ? 2 : 1
        const d = distance(w, p, max)
        if (d <= max && (!fuzzy || d < fuzzy.d)) fuzzy = { name: school.name, matched: p, fuzzy: true, d }
      }
    }
  }
  return fuzzy ? { name: fuzzy.name, matched: fuzzy.matched, fuzzy: true } : null
}

/** The suggestion row's words. */
export function schoolRowLabel(name: string): string {
  return `Tutors and tuitions for ${name}`
}
