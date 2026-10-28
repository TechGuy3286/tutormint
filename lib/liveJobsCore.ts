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

export const LIVE_JOBS_LIMIT = 6
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

/** Where "See all" goes: the city's tuition-jobs page (female / online page for a tag). */
export function liveJobsAllHref(city: string | null, tag: LiveJobsTagValue): string {
  if (!city) return '/browse/tuitions'
  const base = `/tuition-jobs/${citySegment(city)}`
  return tag ? `${base}/${tag}` : base
}
