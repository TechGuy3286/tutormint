// lib/tutorCrawlCore.ts
//
// Tutor-profile crawlability (owner, 20 Nov 2026 — PR-11) — the PURE half.
// Google had found ~10 of ~150 indexable tutor profiles: they were linked only
// from the first page of /browse/tutors. These rules decide the extra links:
//
//   * a city tutor page (/tutors/<city>) for every city with at least 3
//     indexable tutors, and a female variant (/tutors/<city>/female) where at
//     least 3 of them are women; below that the page renders noindex, follow;
//   * on each open tuition: up to 6 matching indexable tutors — same city, then
//     the same subject or level, and the parent's gender preference;
//   * on each indexable tutor profile: up to 6 similar indexable tutors — the
//     same city and subject.
//
// "Indexable" = tutorProfileIndexable (fee paid + CNIC and profile photo
// approved; SQL listed_tutor_slugs()). The I/O is lib/tutorCrawl.ts.

import { citySegment } from '@/lib/slugs'

export const CITY_TUTOR_THRESHOLD = 3
export const RELATED_TUTORS_MAX = 6
/** Tutors per numbered page (the same window /browse/tutors uses). */
export const CITY_TUTORS_PAGE_SIZE = 12

export type CrawlGender = 'male' | 'female' | 'trans' | null

export type CrawlTutor = {
  id: string
  slug: string
  name: string
  city: string
  citySlug: string
  gender: CrawlGender
  /** The public photo (tutor_directory gates a hidden one to null), PR-15. */
  avatarUrl?: string | null
  /** taxonomy_master ids (subject × level). */
  masters: number[]
  /** Subject names, lower case ("mathematics"). */
  subjects: string[]
  /** Level names, lower case ("o levels"). */
  levels: string[]
}

export type TutorCity = { city: string; citySlug: string; indexable: number; female: number }

export function crawlGender(raw: string | null | undefined): CrawlGender {
  const g = (raw ?? '').trim().toLowerCase()
  return g === 'male' || g === 'female' || g === 'trans' ? g : null
}

/** Every city with its indexable tutors (and how many are women), busiest first. */
export function tutorCities(tutors: Pick<CrawlTutor, 'city' | 'citySlug' | 'gender'>[]): TutorCity[] {
  const by = new Map<string, TutorCity>()
  for (const t of tutors) {
    if (!t.citySlug || t.citySlug === 'pakistan') continue
    const c = by.get(t.citySlug) ?? { city: t.city, citySlug: t.citySlug, indexable: 0, female: 0 }
    c.indexable++
    if (t.gender === 'female') c.female++
    // The capitalised spelling wins ("Lahore" over "lahore").
    if (/^[A-Z]/.test(t.city) && !/^[A-Z]/.test(c.city)) c.city = t.city
    by.set(t.citySlug, c)
  }
  return [...by.values()].sort((a, b) => b.indexable - a.indexable || a.city.localeCompare(b.city))
}

export function cityTutorPageIndexable(c: Pick<TutorCity, 'indexable'> | null | undefined): boolean {
  return (c?.indexable ?? 0) >= CITY_TUTOR_THRESHOLD
}

export function femaleTutorPageIndexable(c: Pick<TutorCity, 'female'> | null | undefined): boolean {
  return (c?.female ?? 0) >= CITY_TUTOR_THRESHOLD
}

export function cityTutorPath(citySlug: string, female = false): string {
  return female ? `/tutors/${citySlug}/female` : `/tutors/${citySlug}`
}

/** How many numbered pages a list of `total` tutors takes. */
export function pageCount(total: number, size = CITY_TUTORS_PAGE_SIZE): number {
  return Math.max(1, Math.ceil(Math.max(0, total) / size))
}

/** A stable 32-bit FNV-1a hash — spreads the links over every tutor while
 *  keeping each page's list the same from one build to the next. */
export function spread(s: string): number {
  let h = 0x811c9dc5
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i)
    h = Math.imul(h, 0x01000193) >>> 0
  }
  return h >>> 0
}

const overlap = <T>(a: readonly T[], b: readonly T[]) => a.some((x) => b.includes(x))

export type CrawlTuition = {
  id: string
  city: string | null
  masters: number[]
  subjects: string[]
  levels: string[]
  /** The parent's preference ('male' | 'female' | 'trans'), or null for none. */
  genderPref: CrawlGender
}

/**
 * Up to 6 indexable tutors for a tuition: the same city only; then those who
 * teach one of its exact subject × levels, then the same subject or level,
 * then the rest of the city; a gender preference leaves out the other gender.
 */
export function tutorsForTuition(tutors: CrawlTutor[], job: CrawlTuition, max = RELATED_TUTORS_MAX): CrawlTutor[] {
  const city = job.city ? citySegment(job.city) : null
  if (!city || city === 'pakistan') return []
  const score = (t: CrawlTutor) => (overlap(t.masters, job.masters) ? 2 : overlap(t.subjects, job.subjects) || overlap(t.levels, job.levels) ? 1 : 0)
  return tutors
    .filter((t) => t.citySlug === city && (!job.genderPref || t.gender === job.genderPref))
    .map((t) => ({ t, s: score(t), h: spread(`${job.id}:${t.id}`) }))
    .sort((a, b) => b.s - a.s || a.h - b.h)
    .slice(0, max)
    .map((x) => x.t)
}

/**
 * Up to 6 similar indexable tutors for a tutor: the same city AND at least one
 * shared subject (most shared first). Never the tutor themself.
 */
export function similarTutors(tutors: CrawlTutor[], self: Pick<CrawlTutor, 'id' | 'citySlug' | 'subjects' | 'masters'>, max = RELATED_TUTORS_MAX): CrawlTutor[] {
  if (!self.citySlug) return []
  const shared = (t: CrawlTutor) => t.subjects.filter((s) => self.subjects.includes(s)).length + t.masters.filter((m) => self.masters.includes(m)).length
  return tutors
    .filter((t) => t.id !== self.id && t.citySlug === self.citySlug && overlap(t.subjects, self.subjects))
    .map((t) => ({ t, s: shared(t), h: spread(`${self.id}:${t.id}`) }))
    .sort((a, b) => b.s - a.s || a.h - b.h)
    .slice(0, max)
    .map((x) => x.t)
}
