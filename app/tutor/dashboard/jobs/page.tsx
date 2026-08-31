import Link from 'next/link'
import { Info } from 'lucide-react'
import { getSessionUser } from '@/lib/auth'
import { openJobs } from '@/lib/jobFeed'
import JobCard from '@/components/JobCard'

// Every open tuition, featured first.
//
// Server-rendered from the canonical `jobs` table. The version this replaced
// read a hardcoded array of invented jobs and stored "applied" state in
// localStorage, so an application survived nowhere and nobody was ever
// notified.
//
// Applying is T5: it needs the applications table, quota accounting against
// usage_counters and the block list. Until that exists this page shows the
// work honestly and offers no Apply button, rather than a disabled one.

export const dynamic = 'force-dynamic'

export default async function TutorJobsPage() {
  const session = await getSessionUser()
  const jobs = await openJobs()
  const firstName = (session?.profile?.full_name ?? 'there').split(' ')[0]

  return (
    <main className="min-h-screen bg-[#F8FAFC] px-4 py-6 text-[#334155] sm:px-6 sm:py-8 lg:px-8">
      <div className="mx-auto max-w-3xl space-y-4">
        <header className="space-y-1">
          <Link href="/tutor/dashboard" className="text-xs font-bold text-[#d60008] hover:underline">
            ← Dashboard
          </Link>
          <h1 className="text-xl font-black text-[#0F172A] sm:text-2xl">Open tuitions</h1>
          <p className="text-xs text-gray-500">
            {jobs.length === 0
              ? 'No open tuitions right now.'
              : `${jobs.length} open right now, ${firstName}.`}
          </p>
        </header>

        <p className="flex items-start gap-2 rounded-2xl border border-gray-200 bg-white p-3 text-[11px] leading-relaxed text-[#334155]">
          <Info size={14} className="mt-px shrink-0 text-gray-400" />
          Only Featured parents can complete a hire. Each card says which kind of parent posted it.
          Applying opens in the next release.
        </p>

        {jobs.length === 0 ? (
          <p className="rounded-2xl border border-gray-200 bg-white p-8 text-center text-xs text-gray-400">
            Nothing posted yet. Keep your profile complete so parents find you in search.
          </p>
        ) : (
          <div className="space-y-3">
            {jobs.map((job) => (
              <div key={job.id} id={job.id} className="scroll-mt-20">
                <JobCard job={job} href={`/browse/tuitions?job=${job.job_tx_id ?? job.id}`} />
              </div>
            ))}
          </div>
        )}
      </div>
    </main>
  )
}
