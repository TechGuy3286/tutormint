import Link from 'next/link'
import { ArrowRight, Briefcase } from 'lucide-react'

import CompactJobCard from '@/components/blog/CompactJobCard'
import { browseJobs, NO_JOB_FILTERS, type JobFilters } from '@/lib/jobFeed'
import type { JobCardData } from '@/components/JobCard'
import { mastersForTopic } from '@/lib/blogRelevance'
import { postTopic, tuitionLevelConflicts, tuitionSteps, type TuitionStep } from '@/lib/blogRelevanceCore'
import { ONLINE_JOB_TITLE } from '@/lib/jobTitlesCore'
import { chooseLiveJobs, liveJobsAllHref } from '@/lib/liveJobsCore'

// Live open tuitions at the end of every blog post (owner, 5 Oct 2026): up to
// three OPEN tuitions, then "See all open tuitions…" into the board.
//
// Which tuitions (owner, 14 Oct 2026): the post's own topic — city, level and
// subject, read by the one relevance rule (lib/blogRelevanceCore) — tried in
// the order tuitionSteps() gives: subject + level + city, subject + level,
// level + city, level anywhere, subject + city, city, subject anywhere. A
// tuition whose level clearly conflicts with the post's (a KG tuition under an
// O / A Level post) is never shown. Only a post that names no level, subject
// or city at all gets the newest tuitions; any other post with nothing
// relevant gets no block at all.
//
// COMPACT CARDS, AT MOST 3 (owner, 24 Nov 2026 — PR-20 B.4): title, city, one
// short level / subject line and "View" (components/blog/CompactJobCard) — no
// descriptions or subject-chip grids. The matches are gathered across the
// steps, closest first (lib/liveJobsCore chooseLiveJobs); fewer than 3 shows
// only what matches. A {{live-jobs}} block with no match at all shows the 3
// newest open tuitions in its own scope (female / online for a tagged block).
// Rendered the same for every visitor. No membership prices appear here.

const LIMIT = 3
// Read a few more than shown, so the level check can drop a conflicting card
// and still fill the block.
const FETCH = 12

/** A "Live jobs" block placed inside a post ({{live-jobs}} — owner, 28 Oct
 *  2026) shows up to three (PR-20); the tag narrows to female or online tuitions. */
export type LiveJobsTag = 'female' | 'online' | null

async function pick(city: string | null, subject: string | null, title: string | null, limit = LIMIT, tag: LiveJobsTag = null, newestFallback = false) {
  const topic = postTopic({ city, subject, title })
  const steps = tuitionSteps(topic)
  const m = await mastersForTopic(topic).catch(() => ({ both: [] as number[], subject: [] as number[], levelNames: [] as string[] }))
  const filtersFor = (step: TuitionStep): Partial<JobFilters> | null => {
    switch (step) {
      case 'subject+level+city':
        return m.both.length > 0 ? { city, masterIds: m.both } : null
      case 'subject+level':
        return m.both.length > 0 ? { masterIds: m.both } : null
      case 'level+city':
        return m.levelNames.length > 0 ? { city, levels: m.levelNames } : null
      case 'level':
        return m.levelNames.length > 0 ? { levels: m.levelNames } : null
      case 'subject+city':
        return m.subject.length > 0 ? { city, masterIds: m.subject } : null
      case 'city':
        return city ? { city } : null
      case 'subject':
        return m.subject.length > 0 ? { masterIds: m.subject } : null
      case 'newest':
        return {}
    }
  }
  const levelsOf = (j: JobCardData) => (j.class_levels && j.class_levels.length > 0 ? j.class_levels : [j.class_level])
  const tagFilter: Partial<JobFilters> = tag === 'female' ? { femaleJobs: true } : tag === 'online' ? { mode: ONLINE_JOB_TITLE } : {}
  const byStep: JobCardData[][] = []
  let firstStep: TuitionStep | null = null
  let found = 0
  for (const step of steps) {
    if (found >= limit) break
    const f = filtersFor(step)
    if (!f) continue
    try {
      const { jobs } = await browseJobs({ ...NO_JOB_FILTERS, ...f, ...tagFilter }, Math.max(FETCH, limit * 2))
      const fit = jobs.filter((j) => !tuitionLevelConflicts(topic, levelsOf(j)))
      if (fit.length > 0) {
        if (!firstStep) firstStep = step
        byStep.push(fit)
        found += fit.length
      }
    } catch {
      /* try the next, broader step */
    }
  }
  // No match: a Live jobs block (or a post with no topic) shows the newest in
  // its own scope; the end-of-post block shows nothing rather than unrelated cards.
  let newest: JobCardData[] = []
  if (byStep.length === 0 && (newestFallback || steps.includes('newest'))) {
    try {
      newest = (await browseJobs({ ...NO_JOB_FILTERS, ...tagFilter }, limit)).jobs
    } catch {
      newest = []
    }
  }
  const chosen = chooseLiveJobs(byStep, newest, limit)
  return { jobs: chosen.jobs, step: chosen.matched ? firstStep : chosen.jobs.length > 0 ? ('newest' as const) : null }
}

export default async function OpenTuitionsBlock({
  city,
  subject,
  title = null,
  limit = LIMIT,
  tag = null,
  live = false,
}: {
  city: string | null
  subject: string | null
  title?: string | null
  /** How many cards — at most 3 (PR-20). */
  limit?: number
  tag?: LiveJobsTag
  /** A Live jobs block inside the post: its own heading id and wording. */
  live?: boolean
}) {
  const { jobs, step } = await pick(city, subject, title, Math.min(limit, LIMIT), tag, live)
  // Nothing relevant: no block, rather than unrelated cards.
  if (jobs.length === 0 || !step) return null

  // "…in <city>" only when the cards were chosen by the city.
  // Only when every card is in that city (the steps may have gathered wider ones).
  const byCity = !!city && step !== 'newest' && jobs.every((j) => (j.city ?? '').trim().toLowerCase() === city.trim().toLowerCase())
  const where = byCity ? ` in ${city}` : ''
  const allHref = liveJobsAllHref(byCity ? city : null, tag)
  const headingId = live ? 'live-jobs' : 'open-tuitions'
  const kind = tag === 'female' ? 'Female teaching jobs' : tag === 'online' ? 'Online tuition jobs' : live ? 'Live jobs' : 'Open tuitions'

  return (
    <section aria-labelledby={headingId} className="space-y-3">
      <div className="flex items-center gap-2">
        <Briefcase aria-hidden size={16} className="text-tm-navy" />
        <h2 id={headingId} className="text-sm font-black text-tm-navy">
          {step === 'newest' && !tag ? (live ? 'Live jobs' : 'Newest open tuitions') : `${kind}${where}`}
        </h2>
      </div>
      <div className="space-y-2">
        {jobs.map((job) => (
          <CompactJobCard key={job.id} job={job} />
        ))}
      </div>
      <Link
        href={allHref}
        className="inline-flex min-h-[44px] items-center gap-1.5 rounded-xl bg-tm-navy px-5 text-xs font-bold text-white transition-colors hover:bg-tm-navy-hover"
      >
        {tag === 'female' ? `See all female teaching jobs${where}` : tag === 'online' ? `See all online tuition jobs${where}` : `See all open tuitions${where}`}
        <ArrowRight aria-hidden size={14} />
      </Link>
    </section>
  )
}
