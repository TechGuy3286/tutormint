import Link from 'next/link'
import { ArrowRight, Briefcase } from 'lucide-react'

import JobCard from '@/components/JobCard'
import { applyBlocksFor, type ApplyBlockMap } from '@/lib/applyBlockServer'
import { getSessionUser } from '@/lib/auth'
import { getEntitlements } from '@/lib/entitlements'
import { browseJobs, NO_JOB_FILTERS, type JobFilters } from '@/lib/jobFeed'
import type { JobCardData } from '@/components/JobCard'
import { mastersForTopic } from '@/lib/blogRelevance'
import { postTopic, tuitionLevelConflicts, tuitionSteps, type TuitionStep } from '@/lib/blogRelevanceCore'

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
// Apply uses the existing gated flow on the card: a guest gets the sign-in
// modal, a tutor gets the real button with the shared "why inactive" line, a
// parent sees no Apply. No membership prices appear anywhere here.

const LIMIT = 3
// Read a few more than shown, so the level check can drop a conflicting card
// and still fill the block.
const FETCH = 12

async function pick(city: string | null, subject: string | null, title: string | null) {
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
  for (const step of steps) {
    const f = filtersFor(step)
    if (!f) continue
    try {
      const { jobs } = await browseJobs({ ...NO_JOB_FILTERS, ...f }, FETCH)
      const fit = jobs.filter((j) => !tuitionLevelConflicts(topic, levelsOf(j))).slice(0, LIMIT)
      if (fit.length > 0) return { jobs: fit, step }
    } catch {
      /* try the next, broader step */
    }
  }
  return { jobs: [] as JobCardData[], step: null }
}

export default async function OpenTuitionsBlock({
  city,
  subject,
  title = null,
}: {
  city: string | null
  subject: string | null
  title?: string | null
}) {
  const [{ jobs, step }, session] = await Promise.all([pick(city, subject, title), getSessionUser()])
  // Nothing relevant: no block, rather than unrelated cards.
  if (jobs.length === 0 || !step) return null

  const role = session?.profile?.role ?? null
  const signedIn = !!session
  const isTutor = role === 'tutor'
  let blocks: ApplyBlockMap = {}
  let viewerCity: string | null = null
  if (session && isTutor) {
    const ent = await getEntitlements(session.user.id)
    const { createClient } = await import('@/lib/supabase/server')
    blocks = await applyBlocksFor(await createClient(), session.user.id, ent, jobs)
    viewerCity = session.profile?.city ?? null
  }

  // "…in <city>" only when the cards were chosen by the city.
  const byCity = !!city && step.endsWith('city')
  const where = byCity ? ` in ${city}` : ''
  const allHref = byCity ? `/browse/tuitions?city=${encodeURIComponent(city as string)}` : '/browse/tuitions'

  return (
    <section aria-labelledby="open-tuitions" className="space-y-3">
      <div className="flex items-center gap-2">
        <Briefcase aria-hidden size={16} className="text-tm-navy" />
        <h2 id="open-tuitions" className="text-sm font-black text-tm-navy">
          {step === 'newest' ? 'Newest open tuitions' : `Open tuitions${where}`}
        </h2>
      </div>
      <div className="space-y-4">
        {jobs.map((job) => (
          <JobCard
            key={job.id}
            job={job}
            signedIn={signedIn}
            showApply={!signedIn || isTutor}
            applyBlock={blocks[job.id] ?? null}
            viewerCity={viewerCity}
          />
        ))}
      </div>
      <Link
        href={allHref}
        className="inline-flex min-h-[44px] items-center gap-1.5 rounded-xl bg-tm-navy px-5 text-xs font-bold text-white transition-colors hover:bg-tm-navy-hover"
      >
        See all open tuitions{where}
        <ArrowRight aria-hidden size={14} />
      </Link>
    </section>
  )
}
