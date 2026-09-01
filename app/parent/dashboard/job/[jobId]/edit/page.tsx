import Link from 'next/link'
import { notFound, redirect } from 'next/navigation'
import { getSessionUser } from '@/lib/auth'
import { createClient } from '@/lib/supabase/server'
import JobForm from '../../../post-job/JobForm'

// Edit an open tuition.
//
// The same form as posting, in edit mode. Editing does not spend quota -- the
// post was already paid for -- and a closed or filled job cannot be edited at
// all, which is checked here and again in lib/jobs.ts.
//
// The subject cascade cannot be pre-selected from stored master ids without a
// reverse lookup through the taxonomy, so the category/level/subject step
// starts empty and must be re-chosen. That is deliberate for now rather than
// silently keeping stale subjects: the form always submits what is on screen.

export const dynamic = 'force-dynamic'

export default async function EditJobPage({ params }: { params: Promise<{ jobId: string }> }) {
  const { jobId } = await params
  const session = await getSessionUser()
  const userId = session!.user.id
  const supabase = await createClient()

  const isUuid = /^[0-9a-f-]{36}$/i.test(jobId)
  const { data: job } = await supabase
    .from('jobs')
    .select(
      'id, job_tx_id, parent_id, title, class_level, city, area, teaching_mode, budget_pkr, timings, description, status, child_id',
    )
    .eq(isUuid ? 'id' : 'job_tx_id', jobId)
    .maybeSingle()

  if (!job || job.parent_id !== userId) notFound()
  if (job.status !== 'open') redirect(`/parent/dashboard/job/${job.job_tx_id ?? job.id}`)

  const { data: children } = await supabase
    .from('children')
    .select('id, name, class_level')
    .eq('parent_id', userId)
    .order('created_at')

  return (
    <main className="min-h-screen bg-[#F8FAFC] px-4 py-6 text-[#334155] sm:px-6 sm:py-8 lg:px-8">
      <div className="mx-auto max-w-2xl space-y-4">
        <header className="space-y-1">
          <Link
            href={`/parent/dashboard/job/${job.job_tx_id ?? job.id}`}
            className="text-xs font-bold text-[#d60008] hover:underline"
          >
            ← Back to the job
          </Link>
          <h1 className="text-xl font-black text-[#0F172A] sm:text-2xl">Edit tuition</h1>
          <p className="text-xs text-gray-500">
            Editing does not use another job post from your monthly allowance.
          </p>
        </header>

        <JobForm
          mode="edit"
          children={children ?? []}
          initial={{
            jobId: job.id as string,
            title: (job.title as string) ?? '',
            classLevel: (job.class_level as string) ?? '',
            city: (job.city as string) ?? '',
            area: (job.area as string) ?? '',
            teachingMode: (job.teaching_mode as string) ?? '',
            budgetPkr: job.budget_pkr ? String(job.budget_pkr) : '',
            schedule: (job.timings as string) ?? '',
            description: (job.description as string) ?? '',
            childId: (job.child_id as string) ?? '',
          }}
        />
      </div>
    </main>
  )
}
