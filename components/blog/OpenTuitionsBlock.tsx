import Link from 'next/link'
import { ArrowRight, Briefcase } from 'lucide-react'

import JobCard from '@/components/JobCard'
import { applyBlocksFor, type ApplyBlockMap } from '@/lib/applyBlockServer'
import { getSessionUser } from '@/lib/auth'
import { getEntitlements } from '@/lib/entitlements'
import { browseJobs, NO_JOB_FILTERS, type JobFilters } from '@/lib/jobFeed'
import { mastersForTopic } from '@/lib/blogRelevance'
import { postTopic } from '@/lib/blogRelevanceCore'

// Live open tuitions at the end of every blog post (owner, 5 Oct 2026): up to
// three OPEN tuitions, then "See all open tuitions in <city>" into the filtered
// board. From 13 Oct 2026 the cards PREFER the post's own topic, by the one
// relevance rule (lib/blogRelevanceCore): subject + level + city, then subject
// + city, then level + city, then the city, then the subject anywhere. With no
// match, the three newest open tuitions — the block is never empty (and never
// rendered empty: a board with zero open tuitions renders nothing at all).
//
// Apply uses the existing gated flow on the card: a guest gets the sign-in
// modal, a tutor gets the real button with the shared "why inactive" line, a
// parent sees no Apply. No membership prices appear anywhere here.

const LIMIT = 3

async function pick(city: string | null, subject: string | null, title: string | null) {
  const topic = postTopic({ city, subject, title })
  const m = await mastersForTopic(topic).catch(() => ({ both: [] as number[], subject: [] as number[], levelNames: [] as string[] }))
  const attempts: Partial<JobFilters>[] = []
  if (city && m.both.length > 0) attempts.push({ city, masterIds: m.both })
  if (city && m.subject.length > 0) attempts.push({ city, masterIds: m.subject })
  if (city && m.levelNames.length > 0) attempts.push({ city, levels: m.levelNames })
  if (city) attempts.push({ city })
  if (m.both.length > 0) attempts.push({ masterIds: m.both })
  if (m.subject.length > 0) attempts.push({ masterIds: m.subject })
  for (const a of attempts) {
    try {
      const { jobs } = await browseJobs({ ...NO_JOB_FILTERS, ...a }, LIMIT)
      if (jobs.length > 0) return { jobs, matched: true }
    } catch {
      /* try the next, broader scope */
    }
  }
  // The fallback that was always here: the newest open tuitions.
  try {
    const { jobs } = await browseJobs({ ...NO_JOB_FILTERS }, LIMIT)
    return { jobs, matched: false }
  } catch {
    return { jobs: [], matched: false }
  }
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
  const [{ jobs, matched }, session] = await Promise.all([pick(city, subject, title), getSessionUser()])
  if (jobs.length === 0) return null

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

  // A subject match with no city on the post is "Open tuitions", not "…in <city>".
  const where = city ? ` in ${city}` : ''
  const allHref = city ? `/browse/tuitions?city=${encodeURIComponent(city)}` : '/browse/tuitions'

  return (
    <section aria-labelledby="open-tuitions" className="space-y-3">
      <div className="flex items-center gap-2">
        <Briefcase aria-hidden size={16} className="text-tm-navy" />
        <h2 id="open-tuitions" className="text-sm font-black text-tm-navy">
          {matched ? `Open tuitions${where}` : 'Newest open tuitions'}
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
