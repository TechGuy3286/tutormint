import Link from 'next/link'
import { ArrowRight, Briefcase } from 'lucide-react'

import JobCard from '@/components/JobCard'
import { applyBlocksFor, type ApplyBlockMap } from '@/lib/applyBlockServer'
import { getSessionUser } from '@/lib/auth'
import { getEntitlements } from '@/lib/entitlements'
import { browseJobs, NO_JOB_FILTERS } from '@/lib/jobFeed'

// Live open tuitions at the end of every blog post (owner, 5 Oct 2026): up to
// three OPEN tuitions matching the post's city and/or subject, then "See all
// open tuitions in <city>" into the filtered board. With no match, the three
// newest open tuitions — the block is never empty (and never rendered empty: a
// board with zero open tuitions renders nothing at all rather than a hole).
//
// Apply uses the existing gated flow on the card: a guest gets the sign-in
// modal, a tutor gets the real button with the shared "why inactive" line, a
// parent sees no Apply. No membership prices appear anywhere here.

const LIMIT = 3

async function pick(city: string | null, subject: string | null) {
  const attempts: { city: string | null; q: string | null }[] = []
  if (city && subject) attempts.push({ city, q: subject })
  if (city) attempts.push({ city, q: null })
  if (subject) attempts.push({ city: null, q: subject })
  attempts.push({ city: null, q: null })
  for (const a of attempts) {
    try {
      const { jobs } = await browseJobs({ ...NO_JOB_FILTERS, city: a.city, q: a.q }, LIMIT)
      if (jobs.length > 0) return { jobs, matched: a.city !== null || a.q !== null }
    } catch {
      /* try the next, broader scope */
    }
  }
  return { jobs: [], matched: false }
}

export default async function OpenTuitionsBlock({ city, subject }: { city: string | null; subject: string | null }) {
  const [{ jobs, matched }, session] = await Promise.all([pick(city, subject), getSessionUser()])
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
