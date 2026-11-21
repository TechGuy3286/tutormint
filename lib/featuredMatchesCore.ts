// lib/featuredMatchesCore.ts — tutor Featured: "Matched tuitions on your
// WhatsApp" (owner, 21 Nov 2026 — PR-14). PURE: the rules, tested by
// scripts/test-pr14.ts; lib/featuredMatches.ts does the I/O.
//
// Once a Pakistan day (the 5-minute cron, from 08:00 PKT) every active tutor
// Featured plan holder gets ONE item in People → WhatsApp updates → Today,
// labelled "Featured — matched tuitions": up to 5 open tuitions posted in the
// last 24 hours that match them — the same rule as their matching-tuitions
// alerts (subjects/levels are taxonomy ids that must overlap, same city and Job
// Type or an online tuition they teach, the gender preference), plus their
// chosen areas in that city. Nothing matching → no item. Staff send it by hand
// (Send opens WhatsApp with the message ready; Undo the same day). These items
// are NOT counted in the per-tutor caps (one a day, two a week) or the
// 50-unpaid-a-day cap: they live in their own table, featured_match_items.

import { jobMatches, type MatchJob, type MatchTutor } from '@/lib/tutorTeasersCore'

export const FEATURED_PLAN_CODE = 'featured'
/** Most tuitions in one item. */
export const FEATURED_MATCH_MAX = 5
/** How far back a tuition may have been posted. */
export const FEATURED_MATCH_WINDOW_MS = 24 * 60 * 60 * 1000
/** The Pakistan hour from which the day's items are made. */
export const FEATURED_MATCH_HOUR_PKT = 8
export const FEATURED_ITEM_KIND = 'featured_matches'
export const FEATURED_ITEM_LABEL = 'Featured — matched tuitions'
/** app_settings key: the Pakistan day the items were last made. */
export const FEATURED_DAY_SETTING = 'featured.items_day'

export type FeaturedJob = MatchJob & { title: string; area: string | null; url: string }

export type MatchRules = Parameters<typeof jobMatches>[2]

const norm = (s: string | null | undefined) => (s ?? '').trim().toLowerCase()

/** The tutor's chosen areas, by city (lower case). */
export type AreasByCity = ReadonlyMap<string, readonly string[]>

/** The area rule on top of the city rule: in a city where the tutor chose
 *  areas, an in-person tuition with an area must be in one of them. A tuition
 *  with no area, a city with no areas chosen, and an online tuition in another
 *  city all pass. */
export function areaAllows(job: { city: string | null; area: string | null }, tutor: MatchTutor, areas: AreasByCity, isOnline: (jobType: string | null) => boolean, jobType: string | null): boolean {
  if (isOnline(jobType)) return true
  const city = norm(job.city)
  if (!tutor.cities.some((c) => norm(c) === city)) return true // the city rule already decided
  const mine = areas.get(city) ?? []
  if (mine.length === 0 || !norm(job.area)) return true
  return mine.some((a) => norm(a) === norm(job.area))
}

/** The tuitions one item lists: matching, posted in the window, not sent to
 *  this tutor before, newest first, at most FEATURED_MATCH_MAX. */
export function pickFeaturedMatches(p: {
  jobs: readonly FeaturedJob[]
  tutor: MatchTutor
  areas: AreasByCity
  alreadySent: ReadonlySet<string>
  nowMs: number
  rules: MatchRules
  isOnline: (jobType: string | null) => boolean
}): FeaturedJob[] {
  const from = p.nowMs - FEATURED_MATCH_WINDOW_MS
  return p.jobs
    .filter((j) => {
      const t = Date.parse(j.createdAt)
      return Number.isFinite(t) && t > from && t <= p.nowMs
    })
    .filter((j) => !p.alreadySent.has(j.id))
    .filter((j) => jobMatches(j, p.tutor, p.rules))
    .filter((j) => areaAllows(j, p.tutor, p.areas, p.isOnline, j.jobType))
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt) || a.id.localeCompare(b.id))
    .slice(0, FEATURED_MATCH_MAX)
}

/** The prefilled WhatsApp text — plain English, each tuition's title and its
 *  own tutormint.org link, then the support line. No price, no emoji. */
export function featuredMatchMessage(p: { firstName: string; tuitions: readonly { title: string; area: string | null; city: string | null; url: string }[]; supportWhatsapp: string }): string {
  const name = p.firstName.trim()
  const n = p.tuitions.length
  const lines = [`Hi${name ? ` ${name}` : ''}, ${n === 1 ? 'a new tuition on TutorMint matches' : `${n} new tuitions on TutorMint match`} your profile:`]
  p.tuitions.slice(0, FEATURED_MATCH_MAX).forEach((t, i) => {
    const title = t.title.replace(/\s+/g, ' ').trim().slice(0, 80) || 'Tuition'
    const place = [t.area, t.city].map((x) => (x ?? '').trim()).filter(Boolean).join(', ')
    lines.push(`${i + 1}. ${title}${place ? ` (${place})` : ''}`, t.url)
  })
  lines.push('Open a link to see the tuition and apply.', `Need help? WhatsApp ${p.supportWhatsapp}`)
  return lines.join('\n')
}

export type FeaturedItemState = 'to_send' | 'sent'

/** Sent when the last send is not undone. */
export function featuredItemState(i: { sentAt: string | null; undoneAt: string | null }): FeaturedItemState {
  return i.sentAt && !i.undoneAt ? 'sent' : 'to_send'
}

/** True from 08:00 Pakistan time, once per Pakistan day (the stored day). */
export function featuredItemsDue(nowMs: number, lastDay: string | null): boolean {
  const local = new Date(nowMs + 5 * 3600_000)
  const day = local.toISOString().slice(0, 10)
  return local.getUTCHours() >= FEATURED_MATCH_HOUR_PKT && lastDay !== day
}

/** The Pakistan day (YYYY-MM-DD) of an instant. */
export function pkDay(nowMs: number): string {
  return new Date(nowMs + 5 * 3600_000).toISOString().slice(0, 10)
}
