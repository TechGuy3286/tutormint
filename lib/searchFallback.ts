import 'server-only'

// When a search finds NOTHING (owner, 8 Oct 2026): show the nearest match with
// a clear line — never an unrelated subject, never a blank page. In order:
//
//   1. Subject → its broader subject ("No Additional Mathematics tutors yet.
//      Showing Mathematics tutors.") — only a subject whose words are a strict
//      subset of the asked one; never a random one.
//   2. Level → the nearest level (Grade 4 → Grade 3 and Grade 5).
//   3. City → tutors who teach online first, then nearby cities by distance,
//      with the distance on each card ("No tutors in Sahiwal yet. Showing
//      nearby: Faisalabad (87 km), Lahore (152 km)").
//
// The same for tuitions. A step that still finds nothing falls through to the
// next; if every step is empty the page keeps its own empty state.

import { loadSearchDict } from '@/lib/smartSearch'
import { broaderSubject, nearestLevels, type Parsed } from '@/lib/smartSearchCore'
import { rankedTutors, type RankedTutor, type TutorFilters } from '@/lib/browseTutors'
import { browseJobs, type JobFilters } from '@/lib/jobFeed'
import { cityCoord, distanceKm } from '@/lib/cityDistance'
import { ONLINE_JOB_TITLE } from '@/lib/jobTitlesCore'
import type { JobCardData } from '@/components/JobCard'

export type FallbackLine = { en: string; ur: string }

const km = (from: string, to: string | null | undefined): number | null => {
  const a = cityCoord(from)
  const b = cityCoord(to ?? '')
  return a && b ? Math.round(distanceKm(a, b)) : null
}

function nearbyLine(kind: 'tutors' | 'tuitions', city: string, cities: { city: string; km: number }[]): FallbackLine {
  const list = cities.slice(0, 3).map((c) => `${c.city} (${c.km} km)`).join(', ')
  return {
    en: `No ${kind} in ${city} yet. Showing ${list ? `nearby: ${list}` : kind === 'tutors' ? 'tutors who teach online' : 'online tuitions'}.`,
    ur: `ابھی ${city} میں ${kind === 'tutors' ? 'ٹیوٹر' : 'ٹیوشن'} نہیں۔ ${list ? `قریبی شہر دکھا رہے ہیں: ${list}` : 'آن لائن دکھا رہے ہیں'}۔`,
  }
}

/** Sort: online first, then nearest city; stamp each with its note. */
function byNearness<T extends { city?: string | null }>(
  rows: T[],
  from: string,
  isOnline: (r: T) => boolean,
): { rows: (T & { distance_note: string })[]; cities: { city: string; km: number }[] } {
  const scored = rows.map((r) => {
    const online = isOnline(r)
    const d = km(from, r.city)
    return { r, online, d }
  })
  scored.sort((a, b) => (a.online === b.online ? (a.d ?? 1e9) - (b.d ?? 1e9) : a.online ? -1 : 1))
  const cities: { city: string; km: number }[] = []
  for (const s of scored) {
    if (s.d != null && s.r.city && !cities.some((c) => c.city === s.r.city)) cities.push({ city: s.r.city, km: s.d })
  }
  cities.sort((a, b) => a.km - b.km)
  return {
    rows: scored.map((s) => ({
      ...s.r,
      distance_note: s.online ? (s.d != null && s.d > 0 ? `Teaches online · ${s.d} km away` : 'Teaches online') : s.d != null ? `${s.d} km away` : '',
    })),
    cities,
  }
}

export async function tutorFallback(
  filters: TutorFilters,
  parsed: Parsed | null,
  limit = 12,
): Promise<{ line: FallbackLine; tutors: RankedTutor[] } | null> {
  const dict = await loadSearchDict()
  const city = filters.city || parsed?.city || ''
  const levelSet = new Set(parsed?.levels ?? [])
  const run = async (masterIds: number[] | null, withCity: boolean, n = limit) =>
    (
      await rankedTutors({
        filters: { ...filters, q: '', masterId: null, masterIds, city: withCity ? city : '', area: withCity ? filters.area : '' },
        limit: n,
      })
    ).tutors

  const subjectIds = (slug: string, levels: Set<string>) => {
    const all = dict.master.filter((m) => m.subject === slug)
    const scoped = levels.size ? all.filter((m) => levels.has(m.level)) : all
    return (scoped.length ? scoped : all).map((m) => m.id)
  }

  // 1. Subject → broader subject.
  if (parsed?.subject) {
    const b = broaderSubject(parsed.subject, dict.subjects)
    if (b) {
      const tutors = await run(subjectIds(b.slug, levelSet), !!city)
      if (tutors.length) {
        return {
          line: { en: `No ${parsed.subject.name} tutors yet. Showing ${b.name} tutors.`, ur: `ابھی ${parsed.subject.name} کے ٹیوٹر نہیں۔ ${b.name} کے ٹیوٹر دکھا رہے ہیں۔` },
          tutors,
        }
      }
    }
  }
  // 2. Level → nearest levels.
  if (parsed && levelSet.size) {
    const near = nearestLevels([...levelSet], dict.levels)
    if (near.length) {
      const nearSet = new Set(near)
      const ids = parsed.subject
        ? dict.master.filter((m) => m.subject === parsed.subject!.slug && nearSet.has(m.level)).map((m) => m.id)
        : dict.master.filter((m) => nearSet.has(m.level)).map((m) => m.id)
      if (ids.length) {
        const tutors = await run(ids, !!city)
        if (tutors.length) {
          const what = parsed.subject ? `${parsed.levelLabel} ${parsed.subject.name}` : parsed.levelLabel
          const shown = near.length <= 3 ? near.join(' and ') : 'nearby levels'
          return { line: { en: `No ${what} tutors yet. Showing ${shown}.`, ur: `ابھی ${what} کے ٹیوٹر نہیں۔ ${shown} دکھا رہے ہیں۔` }, tutors }
        }
      }
    }
  }
  // 3. City → online first, then nearby cities by distance.
  if (city) {
    const ids = parsed?.subject
      ? subjectIds(parsed.subject.slug, levelSet)
      : parsed?.school && !levelSet.size
        ? dict.master.filter((m) => m.subject === parsed.school!.slug).map((m) => m.id)
        : levelSet.size
          ? dict.master.filter((m) => levelSet.has(m.level)).map((m) => m.id)
          : filters.masterId
            ? [filters.masterId]
            : null
    const pool = (await run(ids, false, 60)).filter((t) => (t.city ?? '').toLowerCase() !== city.toLowerCase())
    if (pool.length) {
      const sorted = byNearness(pool, city, (t) => (t.job_types ?? []).includes(ONLINE_JOB_TITLE))
      return { line: nearbyLine('tutors', city, sorted.cities), tutors: sorted.rows.slice(0, limit) as RankedTutor[] }
    }
  }
  return null
}

export async function jobFallback(
  filters: JobFilters,
  parsed: Parsed | null,
  limit = 12,
): Promise<{ line: FallbackLine; jobs: JobCardData[] } | null> {
  const dict = await loadSearchDict()
  const city = filters.city || parsed?.city || ''
  const levelSet = new Set(parsed?.levels ?? [])
  const run = async (patch: Partial<JobFilters>, withCity: boolean, n = limit) =>
    (await browseJobs({ ...filters, q: null, masterId: null, masterIds: null, levels: null, ...patch, city: withCity && city ? city : null }, n)).jobs

  const subjectIds = (slug: string) => dict.master.filter((m) => m.subject === slug).map((m) => m.id)

  if (parsed?.subject) {
    const b = broaderSubject(parsed.subject, dict.subjects)
    if (b) {
      const jobs = await run({ masterIds: subjectIds(b.slug), levels: levelSet.size ? [...levelSet] : null }, !!city)
      if (jobs.length) {
        return { line: { en: `No ${parsed.subject.name} tuitions yet. Showing ${b.name} tuitions.`, ur: `ابھی ${parsed.subject.name} کی ٹیوشن نہیں۔ ${b.name} کی ٹیوشنز دکھا رہے ہیں۔` }, jobs }
      }
    }
  }
  if (parsed && levelSet.size) {
    const near = nearestLevels([...levelSet], dict.levels)
    if (near.length) {
      const jobs = await run({ masterIds: parsed.subject ? subjectIds(parsed.subject.slug) : null, levels: near }, !!city)
      if (jobs.length) {
        const what = parsed.subject ? `${parsed.levelLabel} ${parsed.subject.name}` : parsed.levelLabel
        const shown = near.length <= 3 ? near.join(' and ') : 'nearby levels'
        return { line: { en: `No ${what} tuitions yet. Showing ${shown}.`, ur: `ابھی ${what} کی ٹیوشن نہیں۔ ${shown} دکھا رہے ہیں۔` }, jobs }
      }
    }
  }
  if (city) {
    const patch: Partial<JobFilters> = parsed?.subject
      ? { masterIds: subjectIds(parsed.subject.slug), levels: levelSet.size ? [...levelSet] : null }
      : levelSet.size
        ? { levels: [...levelSet] }
        : filters.masterId
          ? { masterIds: [filters.masterId] }
          : {}
    const pool = (await run(patch, false, 60)).filter((j) => (j.city ?? '').toLowerCase() !== city.toLowerCase())
    if (pool.length) {
      const sorted = byNearness(pool, city, (j) => j.teaching_mode === ONLINE_JOB_TITLE)
      return { line: nearbyLine('tuitions', city, sorted.cities), jobs: sorted.rows.slice(0, limit) }
    }
  }
  return null
}
