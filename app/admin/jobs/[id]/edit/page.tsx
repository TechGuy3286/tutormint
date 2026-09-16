import Link from 'next/link'
import { notFound, redirect } from 'next/navigation'

import { requireAdminRole, SCREEN_ACCESS } from '@/lib/adminAuth'
import { createAdminClient } from '@/lib/supabase/admin'
import { teamParentId } from '@/lib/teamAccount'
import type { PostTuitionValues } from '@/components/forms/PostTuitionForm'
import AdminJobEditForm from './AdminJobEditForm'

// Edit a team-posted tuition (owner PR9 §2). Only a team-posted job is editable
// here; a parent's own job is close/remove-only (§2.3), so it redirects back to
// the detail. The form is the same one used to post, prefilled from this job.

export const dynamic = 'force-dynamic'

export default async function AdminJobEditPage({ params }: { params: Promise<{ id: string }> }) {
  await requireAdminRole(...SCREEN_ACCESS.jobsPost)
  const { id } = await params

  const admin = createAdminClient()
  if (!admin) notFound()

  const isUuid = /^[0-9a-f-]{36}$/i.test(id)
  const { data: job } = await admin
    .from('jobs')
    .select(
      'id, ref_id, parent_id, title, class_level, class_levels, city, area, teaching_mode, budget_min_pkr, budget_max_pkr, timings, description, gender_preference, status',
    )
    .eq(isUuid ? 'id' : 'job_tx_id', id)
    .maybeSingle()

  if (!job) notFound()

  const teamId = await teamParentId()
  // §2.3: parent-posted tuitions are not editable by admin.
  if (!teamId || job.parent_id !== teamId) {
    redirect(`/admin/jobs/${job.id}`)
  }

  const [{ data: subjects }, { data: contact }] = await Promise.all([
    admin.from('job_subjects').select('master_id').eq('job_id', job.id),
    admin
      .from('job_contacts')
      .select('contact_name, contact_phone, contact_whatsapp, contact_email, contact_address, contact_social')
      .eq('job_id', job.id)
      .maybeSingle(),
  ])

  const initial: Partial<PostTuitionValues> = {
    title: (job.title as string) ?? '',
    masterIds: (subjects ?? []).map((s) => s.master_id as number),
    classLevel: (job.class_level as string) ?? '',
    city: (job.city as string) ?? '',
    area: (job.area as string) ?? '',
    teachingMode: (job.teaching_mode as string) ?? '',
    budgetMin: job.budget_min_pkr != null ? String(job.budget_min_pkr) : '',
    budgetMax: job.budget_max_pkr != null ? String(job.budget_max_pkr) : '',
    schedule: (job.timings as string) ?? '',
    description: (job.description as string) ?? '',
    genderPreference: (job.gender_preference as string) ?? '',
    contactName: (contact?.contact_name as string) ?? '',
    contactPhone: (contact?.contact_phone as string) ?? '',
    contactWhatsapp: (contact?.contact_whatsapp as string) ?? '',
    contactEmail: (contact?.contact_email as string) ?? '',
    contactAddress: (contact?.contact_address as string) ?? '',
    contactSocial: (contact?.contact_social as string) ?? '',
  }

  return (
    <div className="max-w-2xl space-y-4">
      <header className="space-y-1">
        <div className="flex flex-wrap items-center gap-2">
          {job.ref_id && (
            <span className="rounded-md bg-tm-tint-navy px-2 py-0.5 text-xs font-black tabular-nums text-tm-navy">
              {job.ref_id as string}
            </span>
          )}
          <h1 className="text-lg font-black text-tm-navy">Edit team tuition</h1>
        </div>
        <p className="text-xs text-gray-500">
          Saves to the same tuition — the reference, public URL and applications stay the same.{' '}
          <Link href={`/admin/jobs/${job.id}`} className="font-bold text-tm-red hover:underline">
            Cancel
          </Link>
        </p>
      </header>

      <AdminJobEditForm jobId={job.id as string} initial={initial} />
    </div>
  )
}
