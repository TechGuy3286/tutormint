// lib/tutorCrawl.ts — the I/O of lib/tutorCrawlCore (owner, 20 Nov 2026 — PR-11).
//
// Every indexable tutor (listed_tutor_slugs(), the sitemap's own list) with the
// facts the crawl links need: city, gender, subjects and levels. Public data
// only (the anon client), read on cached public pages — no header, cookie or
// write. Held in memory for 5 minutes and cleared with the landing pages
// (LANDING_TAG) whenever a listing changes.

import { memoize } from '@/lib/memoCache'
import { pageAll, pageAllIn, READ_CONCURRENCY } from '@/lib/pageAll'
import { createPublicClient } from '@/lib/supabase/public'
import { formatName } from '@/lib/formatName'
import { citySegment } from '@/lib/slugs'
import { LANDING_LIVE_REVALIDATE, LANDING_TAG, subjectMetaByMaster } from '@/lib/landing'
import { crawlGender, similarTutors, tutorCities, tutorsForTuition, type CrawlTutor, type TutorCity } from '@/lib/tutorCrawlCore'

export type CrawlSet = { tutors: CrawlTutor[]; cities: TutorCity[] }

async function readCrawlSet(): Promise<CrawlSet> {
  const db = createPublicClient()
  const listed = (await pageAll((from, to) => db.rpc('listed_tutor_slugs').order('slug').range(from, to))) as { slug: string }[]
  const slugs = [...new Set(listed.map((r) => r.slug).filter(Boolean))]
  if (slugs.length === 0) return { tutors: [], cities: [] }
  const rows = await pageAllIn<
    { id: string; slug: string; full_name: string | null; city: string | null; gender: string | null; avatar_url: string | null; rating_avg: number | string | null; rating_count: number | null },
    string
  >(
    slugs,
    (part, from, to) =>
      db.from('tutor_directory').select('id, slug, full_name, city, gender, avatar_url, rating_avg, rating_count').in('slug', part).order('slug').range(from, to),
    100,
    READ_CONCURRENCY,
  )
  const ids = rows.map((r) => r.id)
  const [links, meta] = await Promise.all([
    pageAllIn<{ tutor_id: string; master_id: number }, string>(
      ids,
      (part, from, to) => db.from('tutor_subjects').select('tutor_id, master_id').in('tutor_id', part).order('tutor_id').order('master_id').range(from, to),
      100,
      READ_CONCURRENCY,
    ),
    subjectMetaByMaster(),
  ])
  const masters = new Map<string, number[]>()
  for (const l of links) masters.set(l.tutor_id, [...(masters.get(l.tutor_id) ?? []), Number(l.master_id)])
  const tutors: CrawlTutor[] = rows
    .filter((r) => r.slug && (r.city ?? '').trim())
    .map((r) => {
      const ms = masters.get(r.id) ?? []
      const subjects = new Set<string>()
      const levels = new Set<string>()
      for (const m of ms) {
        const s = meta.get(m)
        if (s?.subject) subjects.add(s.subject.trim().toLowerCase())
        if (s?.level) levels.add(s.level.trim().toLowerCase())
      }
      const city = (r.city ?? '').trim().replace(/\s+/g, ' ')
      return {
        id: r.id,
        slug: r.slug,
        name: formatName(r.full_name) || 'Tutor',
        city,
        citySlug: citySegment(city),
        gender: crawlGender(r.gender),
        avatarUrl: r.avatar_url ?? null,
        ratingAvg: r.rating_avg == null ? null : Number(r.rating_avg),
        ratingCount: r.rating_count ?? 0,
        masters: ms,
        subjects: [...subjects],
        levels: [...levels],
      }
    })
    .sort((a, b) => a.slug.localeCompare(b.slug))
  return { tutors, cities: tutorCities(tutors) }
}

/** The indexable tutors and their cities (cached 5 minutes; cleared with the landing pages). */
export const loadCrawlSet = memoize(readCrawlSet, ['tutor-crawl-set-v3'], { revalidate: LANDING_LIVE_REVALIDATE, tags: [LANDING_TAG] })

/** Read now, no cache — the sitemap (its entries must match the pages' robots tags). */
export async function loadCrawlSetUncached(): Promise<CrawlSet> {
  return readCrawlSet()
}

/** One city's facts, or null when no indexable tutor lists it. */
export async function tutorCityBySlug(citySlug: string): Promise<TutorCity | null> {
  return (await loadCrawlSet()).cities.find((c) => c.citySlug === citySlug) ?? null
}

/** Up to 6 indexable tutors for an open tuition (same city → subject/level → gender rule). */
export async function tutorLinksForTuition(job: { id: string; city: string | null; masterIds: number[]; genderPref: string | null }): Promise<CrawlTutor[]> {
  const [set, meta] = await Promise.all([loadCrawlSet().catch(() => null), subjectMetaByMaster().catch(() => new Map())])
  if (!set) return []
  const subjects = new Set<string>()
  const levels = new Set<string>()
  for (const m of job.masterIds) {
    const s = meta.get(m)
    if (s?.subject) subjects.add(s.subject.trim().toLowerCase())
    if (s?.level) levels.add(s.level.trim().toLowerCase())
  }
  return tutorsForTuition(set.tutors, { id: job.id, city: job.city, masters: job.masterIds, subjects: [...subjects], levels: [...levels], genderPref: crawlGender(job.genderPref) })
}

/** Up to 6 similar indexable tutors for a tutor profile (same city and subject). */
export async function similarTutorLinks(tutorId: string): Promise<CrawlTutor[]> {
  const set = await loadCrawlSet().catch(() => null)
  const self = set?.tutors.find((t) => t.id === tutorId)
  return set && self ? similarTutors(set.tutors, self) : []
}
