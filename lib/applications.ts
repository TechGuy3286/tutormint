// lib/applications.ts
//
// Applying to a tuition, withdrawing, and the parent's shortlist / reject.
//
// The gates on applying, all checked server-side and in this order so the
// cheapest refusals happen first:
//
//   1. the tutor is LISTED (100% profile, not suspended) -- an unlisted tutor
//      applying would put a profile in front of a parent that the directory
//      has decided is not ready to be seen
//   2. the pair is not blocked
//   3. the job is still open
//   4. they have not already applied (a unique index backs this up)
//   5. quota: 10 / 25 / 100 by plan
//
// Quota is spent only after the row exists, and withdrawal never refunds it
// (the owner's rule) -- the application still cost a slot, which is what stops
// apply-everything-then-withdraw.

import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { getEntitlements } from '@/lib/entitlements'
import { checkQuota, consumeQuota } from '@/lib/quota'
import { logActivity } from '@/lib/activityLog'
import { notify } from '@/lib/notifications'

type Fail = { ok: false; status: number; error: string; upgrade?: string }

export async function applyToJob(params: {
  tutorId: string
  jobId: string
  message?: string | null
}): Promise<{ ok: true; applicationId: string } | Fail> {
  const supabase = await createClient()

  const { data: job } = await supabase
    .from('jobs')
    .select('id, parent_id, status, title, job_tx_id')
    .eq('id', params.jobId)
    .maybeSingle()

  if (!job) return { ok: false, status: 404, error: 'Job not found.' }
  if (job.status !== 'open') {
    return { ok: false, status: 400, error: 'This job is no longer accepting applications.' }
  }

  // 0. A parent pressing Apply is not an edge case worth a tutor-shaped
  //    error. Told plainly what happened rather than "complete your profile".
  const ent = await getEntitlements(params.tutorId)
  if (ent.audience !== 'tutor') {
    return { ok: false, status: 403, error: 'Only tutor accounts can apply for tuitions.' }
  }

  // 0b. Suspension is checked BEFORE the listing check, because a suspended
  //     tutor is also unlisted -- and being told to "complete your profile" when
  //     it is already at 100% sends someone to fix a thing that is not broken.
  if (ent.suspended) {
    return {
      ok: false,
      status: 403,
      error: 'Your account is suspended, so you cannot apply for jobs. Contact support.',
      upgrade: '/support',
    }
  }

  const admin = createAdminClient()

  // 1. Listed?
  if (admin) {
    const { data: listed } = await admin
      .from('tutor_directory')
      .select('id')
      .eq('id', params.tutorId)
      .maybeSingle()

    if (!listed) {
      return {
        ok: false,
        status: 403,
        error:
          'Complete your profile to 100% before applying — parents only see tutors who are listed.',
        upgrade: '/tutor/complete-profile',
      }
    }

    // 2. Blocked either way?
    const { data: blocked } = await admin.rpc('is_blocked_pair', {
      a: params.tutorId,
      b: job.parent_id as string,
    })
    if (blocked) {
      return { ok: false, status: 403, error: 'You cannot apply to this job.' }
    }
  }

  // 4. Already applied? Checked before quota so a repeat press does not cost
  //    an application.
  const { data: already } = await supabase
    .from('applications')
    .select('id, withdrawn_at')
    .eq('job_id', job.id)
    .eq('tutor_id', params.tutorId)
    .maybeSingle()

  if (already) {
    return {
      ok: false,
      status: 409,
      error: already.withdrawn_at
        ? 'You withdrew from this job and cannot apply again.'
        : 'You have already applied for this job.',
    }
  }

  // 5. Quota
  const quota = checkQuota(ent, 'job_application')
  if (!quota.ok) return quota

  const { data: created, error } = await supabase
    .from('applications')
    .insert({
      job_id: job.id,
      tutor_id: params.tutorId,
      message: params.message?.trim() || null,
      status: 'applied',
    })
    .select('id')
    .single()

  if (error) return { ok: false, status: 400, error: error.message }

  await consumeQuota(params.tutorId, 'job_application')

  await notify({
    userId: job.parent_id as string,
    kind: 'application_received',
    title: 'New application',
    body: `A tutor applied for "${job.title}".`,
    href: `/parent/dashboard/job/${job.job_tx_id ?? job.id}`,
  })

  await logActivity({
    userId: params.tutorId,
    event: 'application_submitted',
    targetType: 'application',
    targetId: created.id as string,
    meta: { jobId: job.id },
  })

  return { ok: true, applicationId: created.id as string }
}

export async function withdrawApplication(
  tutorId: string,
  applicationId: string,
): Promise<{ ok: true } | Fail> {
  const supabase = await createClient()

  const { data: application } = await supabase
    .from('applications')
    .select('id, tutor_id, job_id, status, withdrawn_at')
    .eq('id', applicationId)
    .maybeSingle()

  if (!application || application.tutor_id !== tutorId) {
    return { ok: false, status: 404, error: 'Application not found.' }
  }
  if (application.withdrawn_at) return { ok: true }
  if (application.status === 'hired') {
    return {
      ok: false,
      status: 400,
      error: 'You have been hired for this job. Message the parent to discuss.',
    }
  }

  const { error } = await supabase
    .from('applications')
    .update({ withdrawn_at: new Date().toISOString() })
    .eq('id', applicationId)

  if (error) return { ok: false, status: 400, error: error.message }

  const admin = createAdminClient()
  if (admin) {
    const { data: job } = await admin
      .from('jobs')
      .select('parent_id, title, job_tx_id, id')
      .eq('id', application.job_id as string)
      .maybeSingle()

    if (job) {
      await notify({
        userId: job.parent_id as string,
        kind: 'application_withdrawn',
        title: 'An applicant withdrew',
        body: job.title as string,
        href: `/parent/dashboard/job/${job.job_tx_id ?? job.id}`,
      })
    }
  }

  // No quota refund: the slot was spent when the application was made.
  await logActivity({
    userId: tutorId,
    event: 'application_withdrawn',
    targetType: 'application',
    targetId: applicationId,
    meta: { jobId: application.job_id, quotaRefunded: false },
  })

  return { ok: true }
}

/** Parent-side shortlist / reject. Hiring is deliberately NOT here. */
export async function setApplicationStatus(params: {
  parentId: string
  applicationId: string
  status: 'shortlisted' | 'rejected' | 'applied'
}): Promise<{ ok: true } | Fail> {
  const supabase = await createClient()

  const { data: application } = await supabase
    .from('applications')
    .select('id, job_id, tutor_id, status, withdrawn_at')
    .eq('id', params.applicationId)
    .maybeSingle()

  if (!application) return { ok: false, status: 404, error: 'Application not found.' }

  const { data: job } = await supabase
    .from('jobs')
    .select('id, parent_id, title, job_tx_id')
    .eq('id', application.job_id as string)
    .maybeSingle()

  if (!job || job.parent_id !== params.parentId) {
    return { ok: false, status: 404, error: 'Application not found.' }
  }
  if (application.status === 'hired') {
    return { ok: false, status: 400, error: 'This tutor is already hired.' }
  }

  const { error } = await supabase
    .from('applications')
    .update({ status: params.status })
    .eq('id', params.applicationId)

  if (error) return { ok: false, status: 400, error: error.message }

  if (params.status === 'shortlisted' || params.status === 'rejected') {
    await notify({
      userId: application.tutor_id as string,
      kind: params.status === 'shortlisted' ? 'application_shortlisted' : 'application_rejected',
      title:
        params.status === 'shortlisted'
          ? 'You have been shortlisted'
          : 'An application was not taken forward',
      body: job.title as string,
      href: '/tutor/dashboard/jobs',
    })
  }

  return { ok: true }
}
