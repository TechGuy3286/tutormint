// lib/contentQueue/core.ts
//
// The PURE half of the content queue (CLAUDE.md 9.4): the types, the priority
// formula, the coarse evidence hash, and the fixed Pakistani academic calendar.
// No database, no server-only import — so it runs in the nightly build, in the
// admin screen's display, AND in the test runner. Same split, same reason, as
// lib/ai/blogBrief.ts.
//
// THE ONE RULE the priority obeys: the score is explainable. It is the product
// of four named components and every one of them is stored on the row, so a
// card can say WHY a topic ranks where it does instead of showing a bare number.

import { slugify } from '@/lib/slugs'

export type SuggestionCard = 'content' | 'recruitment'
export type SuggestionSource = 'search_gap' | 'calendar' | 'coverage_gap' | 'reports' | 'gsc' | 'recruitment'
export type Audience = 'parents' | 'tutors' | 'both'
export type Language = 'en' | 'ur'

/**
 * The four factors, stored so the number can be explained:
 *   demand         how many people want this (searches, listed tutors, reports)
 *   rankProximity  how close we already are to ranking (tutors ready, near a
 *                  threshold) — a topic we can win beats one we cannot
 *   seasonality    a calendar boost when the topic is timely, else 1
 *   gapAge         how long the gap has gone unfilled — an old gap is louder
 */
export type PriorityComponents = {
  demand: number
  rankProximity: number
  seasonality: number
  gapAge: number
}

export type Candidate = {
  fingerprint: string
  card: SuggestionCard
  source: SuggestionSource
  title: string
  cluster: string | null
  audience: Audience
  language: Language
  components: PriorityComponents
  /** Plain-word lines shown on the card. */
  evidence: string[]
  /** Structured figures behind the evidence, for the material-change test. */
  evidenceKey: Record<string, number | string>
  /** The editor fact-notes this suggestion pre-fills. */
  notes: string
}

/** priority = demand x rankProximity x seasonality x gapAge, rounded. */
export function priorityOf(c: PriorityComponents): number {
  return Math.round(
    Math.max(0, c.demand) *
      Math.max(0.1, c.rankProximity) *
      Math.max(0.1, c.seasonality) *
      Math.max(0.1, c.gapAge),
  )
}

/**
 * gapAge from how long a topic has been in the queue: 1 at first sight, rising
 * one step per fortnight, capped so an ancient gap does not swamp everything.
 */
export function gapAgeFactor(firstSeen: Date, now: Date): number {
  const days = Math.max(0, (now.getTime() - firstSeen.getTime()) / 86_400_000)
  return Math.min(4, 1 + Math.floor(days / 14))
}

/**
 * A COARSE hash of the evidence, so a dismissed topic returns only on a
 * MATERIAL change. Numbers are bucketed before hashing — a search count moving
 * 40 -> 43 produces the same hash and stays dismissed; 40 -> 90 crosses a
 * bucket and resurfaces. Strings hash as-is.
 */
export function evidenceHash(key: Record<string, number | string>): string {
  const parts = Object.keys(key)
    .sort()
    .map((k) => {
      const v = key[k]
      if (typeof v === 'number') {
        // Bucket to ~40% steps: log-scaled, so it is proportional rather than a
        // fixed width that is coarse for small counts and fine for large ones.
        const bucket = v <= 0 ? 0 : Math.round(Math.log(v) / Math.log(1.4))
        return `${k}=${bucket}`
      }
      return `${k}=${v}`
    })
  return parts.join('|')
}

// ------------------------------------------------------ academic calendar ---

type CalendarEvent = {
  id: string
  /** Month (1-12) and day the window opens — the point we count six weeks from. */
  month: number
  day: number
  cluster: string
  audience: Audience
  seasonality: number
  title: (year: number) => string
  notes: string
}

// The fixed Pakistani school year. Windows are the CLAUDE.md 9.4 schedule; each
// entry's (month, day) is where its window OPENS, which is what we count six
// weeks back from so a post is ready in time.
const CALENDAR: CalendarEvent[] = [
  {
    id: 'board-registration',
    month: 12,
    day: 1,
    cluster: 'boards-exams',
    audience: 'parents',
    seasonality: 2.5,
    title: (y) => `Board exam registration in Pakistan: what parents need to do (${y}–${y + 1})`,
    notes:
      'Board registration for Matric and Intermediate in Pakistan runs roughly December to January. Explain how registration works, the documents parents gather, and how a tutor helps a student who has fallen behind before it starts.',
  },
  {
    id: 'matric-inter-exams',
    month: 3,
    day: 1,
    cluster: 'boards-exams',
    audience: 'both',
    seasonality: 3,
    title: (y) => `Matric and Intermediate exam preparation, ${y}`,
    notes:
      'Matric and Intermediate board exams in Pakistan usually run March to May. Cover revision planning, past papers, and when a subject tutor makes the most difference. Do not invent pass rates or dates.',
  },
  {
    id: 'oa-level-summer',
    month: 5,
    day: 1,
    cluster: 'boards-exams',
    audience: 'both',
    seasonality: 3,
    title: (y) => `O and A Level May–June exam prep, ${y}`,
    notes:
      'The Cambridge and Edexcel O/A Level May–June session is a major exam window in Pakistan. Cover subject-by-subject prep, past-paper practice and timing, and how a tutor supports the last weeks.',
  },
  {
    id: 'oa-level-winter',
    month: 10,
    day: 1,
    cluster: 'boards-exams',
    audience: 'both',
    seasonality: 3,
    title: (y) => `O and A Level October–November exam prep, ${y}`,
    notes:
      'The O/A Level October–November session is the second major exam window. Cover revision, past papers and where tutoring helps most in the run-up.',
  },
  {
    id: 'results',
    month: 7,
    day: 15,
    cluster: 'boards-exams',
    audience: 'parents',
    seasonality: 2,
    title: (y) => `After the results: choosing the next step, ${y}`,
    notes:
      'Board and O/A Level results in Pakistan land around July to August. Cover reading a result, whether to re-sit, and how a tutor helps a student recover ground before the next year.',
  },
  {
    id: 'admissions',
    month: 8,
    day: 15,
    cluster: 'city-guides',
    audience: 'parents',
    seasonality: 2,
    title: (y) => `College and school admissions season, ${y}`,
    notes:
      'Admissions season in Pakistan runs roughly August to September. Cover entry tests, choosing between boards, and how tutoring supports an admission test. Do not invent merit percentages.',
  },
]

// Ramadan moves ~11 days earlier each year, so it cannot be a fixed month/day.
// Approximate Gregorian first days for the years this matters; a year without
// an entry simply produces no Ramadan suggestion rather than a wrong date.
const RAMADAN_START: Record<number, [number, number]> = {
  2026: [2, 18],
  2027: [2, 8],
  2028: [1, 28],
  2029: [1, 16],
}

/** Days from `now` to the next occurrence of (month, day), this year or next. */
function daysUntilNext(now: Date, month: number, day: number): { days: number; year: number } {
  const y = now.getFullYear()
  let target = new Date(Date.UTC(y, month - 1, day))
  if (target.getTime() < startOfDay(now)) target = new Date(Date.UTC(y + 1, month - 1, day))
  const days = Math.round((target.getTime() - startOfDay(now)) / 86_400_000)
  return { days, year: target.getUTCFullYear() }
}

function startOfDay(d: Date): number {
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate())
}

/** How many days ahead we begin suggesting a seasonal topic. */
export const CALENDAR_LEAD_DAYS = 42

/**
 * Seasonal candidates due within the lead window. Yearly by construction: the
 * fingerprint carries the occurrence year, so last year's row is a settled
 * decision and this year's is a fresh suggestion.
 */
export function calendarCandidates(now: Date): Candidate[] {
  const out: Candidate[] = []

  for (const e of CALENDAR) {
    const { days, year } = daysUntilNext(now, e.month, e.day)
    if (days < 0 || days > CALENDAR_LEAD_DAYS) continue
    const title = e.title(year)
    out.push({
      fingerprint: `calendar:${e.id}:${year}`,
      card: 'content',
      source: 'calendar',
      title,
      cluster: e.cluster,
      audience: e.audience,
      language: 'en',
      // Seasonal demand is a fixed base lifted by the seasonality factor; the
      // point of a calendar topic is timeliness, not raw search volume.
      components: { demand: 20, rankProximity: 1, seasonality: e.seasonality, gapAge: 1 },
      evidence: [
        `Seasonal: this window opens in about ${days} day${days === 1 ? '' : 's'}.`,
        'Publish ahead of the season so it ranks when parents start searching.',
      ],
      evidenceKey: { daysUntil: days, event: e.id, year },
      notes: e.notes,
    })
  }

  // Ramadan, if we have a date for the upcoming year.
  for (const [yStr, [m, d]] of Object.entries(RAMADAN_START)) {
    const year = Number(yStr)
    const start = Date.UTC(year, m - 1, d)
    const days = Math.round((start - startOfDay(now)) / 86_400_000)
    if (days < 0 || days > CALENDAR_LEAD_DAYS) continue
    out.push({
      fingerprint: `calendar:ramadan:${year}`,
      card: 'content',
      source: 'calendar',
      title: `Tutoring around the Ramadan timetable, ${year}`,
      cluster: 'safety-trust',
      audience: 'both',
      language: 'en',
      components: { demand: 18, rankProximity: 1, seasonality: 2, gapAge: 1 },
      evidence: [
        `Ramadan begins in about ${days} day${days === 1 ? '' : 's'} (approximate).`,
        'Families rearrange lesson times; cover how tutoring adapts.',
      ],
      evidenceKey: { daysUntil: days, event: 'ramadan', year },
      notes:
        'During Ramadan in Pakistan, tuition timings shift to before or after iftar and sehri. Cover how parents and tutors rearrange lesson times and keep momentum without exhausting a fasting student.',
    })
  }

  return out
}

/** A landing path from a city slug and subject slug, matching lib/landing. */
export function landingPath(kind: 'tutors' | 'tuitions', citySlug: string, subjectSlug: string): string {
  return `${kind}/${citySlug}/${subjectSlug}`
}

/** A safe slug fragment for a fingerprint from an arbitrary label. */
export function fpSlug(s: string): string {
  return slugify(s) || 'x'
}
