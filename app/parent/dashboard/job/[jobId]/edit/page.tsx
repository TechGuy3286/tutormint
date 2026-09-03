import Breadcrumbs from '@/components/Breadcrumbs'
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
// The subject cascade opens on the job's current subjects: the stored
// taxonomy_master ids are resolved back into category / level / subject by
// selectionForMasterIds(). Before that, the step opened empty, so a parent
// editing only the budget had to re-pick their subjects -- and if they did not
// notice, the form submitted whatever was on screen.

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
      'id, job_tx_id, parent_id, title, class_level, city, area, teaching_mode, budget_pkr, budget_min_pkr, budget_max_pkr, timings, description, status, child_id',
    )
    .eq(isUuid ? 'id' : 'job_tx_id', jobId)
    .maybeSingle()

  if (!job || job.parent_id !== userId) notFound()
  if (job.status !== 'open') redirect(`/parent/dashboard/job/${job.job_tx_id ?? job.id}`)

  const [{ data: children }, { data: subjectLinks }] = await Promise.all([
    supabase
      .from('children')
      .select('id, name, class_level')
      .eq('parent_id', userId)
      .order('created_at'),
    supabase.from('job_subjects').select('master_id').eq('job_id', job.id),
  ])

  return (
    <main className="min-h-screen bg-tm-bg px-4 py-6 text-slate-700 sm:px-6 sm:py-8 lg:px-8">
      <div className="mx-auto max-w-2xl space-y-4">
        <Breadcrumbs
          items={[
            { label: 'Parent dashboard', href: '/parent/dashboard' },
            { label: job.title, href: `/parent/dashboard/job/${job.job_tx_id ?? job.id}` },
            { label: 'Edit' },
          ]}
        />
        <header className="space-y-1">
          <h1 className="text-xl font-black text-tm-navy sm:text-2xl">Edit tuition</h1>
          <p className="text-xs text-gray-500">
            Editing does not use another job post from your monthly allowance.
          </p>
        </header>

        <JobForm
          mode="edit"
          children={children ?? []}
          initial={{
            jobId: job.id as string,
            masterIds: (subjectLinks ?? []).map((l) => l.master_id as number),
            title: (job.title as string) ?? '',
            classLevel: (job.class_level as string) ?? '',
            city: (job.city as string) ?? '',
            area: (job.area as string) ?? '',
            teachingMode: (job.teaching_mode as string) ?? '',
            // The band, so the select reopens on the one the parent chose.
            // A job posted before migration 37 has neither end stored, and
            // `bandFor` maps that to "Any budget" rather than inventing a band
            // from the single figure -- which would silently change what the
            // job says the next time anything else is edited.
            budgetMin: job.budget_min_pkr ? String(job.budget_min_pkr) : '',
            budgetMax: job.budget_max_pkr ? String(job.budget_max_pkr) : '',
            schedule: (job.timings as string) ?? '',
            description: (job.description as string) ?? '',
            childId: (job.child_id as string) ?? '',
          }}
        />
      </div>
    </main>
  )
}
