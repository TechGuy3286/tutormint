import Breadcrumbs from '@/components/Breadcrumbs'
import { Info } from 'lucide-react'
import { getSessionUser } from '@/lib/auth'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { getEntitlements } from '@/lib/entitlements'
import { browseJobs, NO_JOB_FILTERS } from '@/lib/jobFeed'
import JobCard from '@/components/JobCard'
import MoreOpenJobs from './MoreOpenJobs'
import MyApplications, { type MyApplication } from './MyApplications'

// Every open tuition, featured first, plus the tutor's own applications.
//
// Applying is real from T5: the button posts to /api/applications, which
// checks that the tutor is listed, not blocked, that the job is open, that
// they have not already applied, and that they have quota left. Withdrawal is
// here too, with the no-refund rule stated rather than discovered.

export const dynamic = 'force-dynamic'

const PAGE_SIZE = 12

export default async function TutorJobsPage() {
  const session = await getSessionUser()
  const userId = session!.user.id
  const supabase = await createClient()

  // The first window only. This page used to render every open tuition up to
  // a 50-row cap in one go -- 18,672px on production, and silently nothing at
  // all beyond the 51st. The rest arrives through /api/tutor/jobs on the same
  // keyset cursor the browse pages use.
  const [{ jobs, total, nextCursor }, ent] = await Promise.all([
    browseJobs(NO_JOB_FILTERS, PAGE_SIZE, 0, null),
    getEntitlements(userId),
  ])

  const { data: mine } = await supabase
    .from('applications')
    .select('id, job_id, status, message, withdrawn_at, created_at')
    .eq('tutor_id', userId)
    .order('created_at', { ascending: false })

  const appliedIds = new Set((mine ?? []).map((a) => a.job_id as string))

  // Job titles for the tutor's own applications, including jobs that have
  // since closed and therefore no longer appear in the open list.
  const admin = createAdminClient()
  const titles = new Map<string, { title: string; status: string }>()
  const myJobIds = Array.from(new Set((mine ?? []).map((a) => a.job_id as string)))

  if (admin && myJobIds.length > 0) {
    const { data: jobRows } = await admin.from('jobs').select('id, title, status').in('id', myJobIds)
    for (const j of jobRows ?? []) {
      titles.set(j.id as string, {
        title: (j.title as string) ?? 'Tuition',
        status: (j.status as string) ?? 'open',
      })
    }
  }

  const applications: MyApplication[] = (mine ?? []).map((a) => ({
    id: a.id as string,
    jobId: a.job_id as string,
    jobTitle: titles.get(a.job_id as string)?.title ?? 'Tuition',
    jobStatus: titles.get(a.job_id as string)?.status ?? 'open',
    status: a.status as MyApplication['status'],
    withdrawn: !!a.withdrawn_at,
    createdAt: a.created_at as string,
  }))

  const firstName = (session?.profile?.full_name ?? 'there').split(' ')[0]

  return (
    <main className="min-h-screen bg-tm-bg px-4 py-6 text-slate-700 sm:px-6 sm:py-8 lg:px-8">
      <div className="mx-auto max-w-3xl space-y-5">
        <Breadcrumbs items={[{ label: 'Tutor dashboard', href: '/tutor/dashboard' }, { label: 'Jobs for you' }]} />
        <header className="space-y-1">
          <h1 className="text-xl font-black text-tm-navy sm:text-2xl">Open tuitions</h1>
          <p className="text-xs text-gray-500">
            {total === 0 ? `No open tuitions right now, ${firstName}.` : `${total} open`}
            {ent.plan ? ` · ${ent.quotaLeft} of ${ent.displayedQuota} applications left` : ''}
          </p>
        </header>

        <p className="flex items-start gap-2 rounded-2xl border border-gray-200 bg-white p-3 text-[11px] leading-relaxed text-slate-700">
          <Info size={14} className="mt-px shrink-0 text-gray-500" />
          Only Featured parents can complete a hire. Each card says which kind of parent posted it,
          so you know before you spend an application.
        </p>

        {applications.length > 0 && <MyApplications applications={applications} />}

        <section className="space-y-3">
          <h2 className="text-sm font-black text-tm-navy">All open tuitions</h2>
          {jobs.length === 0 ? (
            <p className="rounded-2xl border border-gray-200 bg-white p-8 text-center text-xs text-gray-500">
              Nothing posted yet. Keep your profile complete so parents find you in search.
            </p>
          ) : (
            <>
              <div className="space-y-3">
                {jobs.map((job) => (
                  <div key={job.id} id={job.id} className="scroll-mt-20">
                    <JobCard
                      job={job}
                      signedIn
                      showApply
                      applied={appliedIds.has(job.id)}
                    />
                  </div>
                ))}
              </div>
              <MoreOpenJobs
                initialCursor={nextCursor}
                total={total}
                serverCount={jobs.length}
              />
            </>
          )}
        </section>
      </div>
    </main>
  )
}
