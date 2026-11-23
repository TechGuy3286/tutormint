// lib/liveJobsCore.ts
//
// The "Live jobs" block a blog post can include (owner, 28 Oct 2026). Pure — the
// markdown parser, the post page, the queue drafter and the tests read it.
//
// A line that is exactly {{live-jobs}} becomes up to LIVE_JOBS_LIMIT current
// open tuitions chosen by the post's own city, subject and level (the same
// relevance rule as the cards at the end of a post), refreshed on every view,
// with a link to all of them. {{live-jobs:female}} narrows to tuitions asking
// for a female teacher, {{live-jobs:online}} to online tuitions. Drafts the
// content queue writes include the block by default.

import { citySegment } from '@/lib/slugs'

// At most 3, as compact cards (PR-20 B.4).
export const LIVE_JOBS_LIMIT = 3
export const LIVE_JOBS_RE = /^\{\{live-jobs(?::(female|online))?\}\}$/

export type LiveJobsTagValue = 'female' | 'online' | null

/** The tag of a {{live-jobs…}} line, or undefined when the line is not one. */
export function parseLiveJobsLine(line: string): LiveJobsTagValue | undefined {
  const m = line.trim().match(LIVE_JOBS_RE)
  if (!m) return undefined
  return (m[1] as 'female' | 'online' | undefined) ?? null
}

/** The marker line for a tag. */
export function liveJobsMarker(tag: LiveJobsTagValue = null): string {
  return tag ? `{{live-jobs:${tag}}}` : '{{live-jobs}}'
}

/** Whether a body already carries a Live jobs block. */
export function hasLiveJobs(body: string): boolean {
  return body.split(/\r?\n/).some((l) => parseLiveJobsLine(l) !== undefined)
}

/**
 * Add the block to a draft: after the second section when there are enough
 * sections, else at the end. Never twice.
 */
export function withLiveJobs(body: string, tag: LiveJobsTagValue = null): string {
  if (hasLiveJobs(body)) return body
  const marker = liveJobsMarker(tag)
  const lines = body.split('\n')
  const h2 = lines.map((l, i) => (/^## /.test(l) ? i : -1)).filter((i) => i >= 0)
  if (h2.length >= 3) {
    const at = h2[2]
    return [...lines.slice(0, at), marker, '', ...lines.slice(at)].join('\n')
  }
  return `${body.trimEnd()}\n\n${marker}\n`
}

/**
 * Which tuitions a Live jobs block shows (PR-20 B.4): the matches for the
 * post's city / subject / level, closest step first, no repeats, at most
 * LIVE_JOBS_LIMIT. Fewer matches → only those (never padded with unrelated
 * ones); no match at all → the newest in the block's own scope.
 */
export function chooseLiveJobs<J extends { id: string }>(matchesByStep: J[][], newest: J[], limit = LIVE_JOBS_LIMIT): { jobs: J[]; matched: boolean } {
  const out: J[] = []
  const seen = new Set<string>()
  for (const step of matchesByStep) {
    for (const j of step) {
      if (out.length >= limit) break
      if (seen.has(j.id)) continue
      seen.add(j.id)
      out.push(j)
    }
  }
  if (out.length > 0) return { jobs: out, matched: true }
  return { jobs: newest.slice(0, limit), matched: false }
}

/** The compact card's one short line: "Grade 9 · Physics, Chemistry +2". */
export function compactLevelSubjectLine(levels: string, subjects: (string | null | undefined)[], maxSubjects = 2): string {
  const subs = [...new Set(subjects.map((s) => (s ?? '').trim()).filter(Boolean))]
  const shown = subs.slice(0, maxSubjects).join(', ')
  const more = subs.length > maxSubjects ? ` +${subs.length - maxSubjects}` : ''
  return [levels.trim(), shown ? `${shown}${more}` : ''].filter(Boolean).join(' · ')
}

/** The compact card's title: the stored headline, else the card title's first part. */
export function compactJobTitle(job: { headline?: string | null; title: string }): string {
  const h = (job.headline ?? '').trim()
  if (h) return h
  return job.title.split('|')[0].trim() || job.title.trim()
}

/** Where "See all" goes: the city's tuition-jobs page (female / online page for a tag). */
export function liveJobsAllHref(city: string | null, tag: LiveJobsTagValue): string {
  if (!city) return '/browse/tuitions'
  const base = `/tuition-jobs/${citySegment(city)}`
  return tag ? `${base}/${tag}` : base
}
