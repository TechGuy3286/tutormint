// lib/jobs.ts
//
// Posting, editing, closing and filling a tuition.
//
// The gates, all server-side:
//
//   * Only a VERIFIED parent (CNIC + address approved) may post. That is the
//     owner's rule and it is checked here, not in the form.
//   * Quota comes from the plan: 5/month free-verified, 100/month featured
//     shown as "Unlimited". Spent only after the insert succeeds.
//   * is_featured is stamped from the parent's plan AT POST TIME, so a job
//     posted while Featured keeps its tag for its life and a job posted on the
//     free tier does not gain one when the parent upgrades later.
//   * HIRING is restricted to parent_featured. A free parent sees an upgrade
//     path, never a disabled button -- and the route refuses regardless of
//     what the page rendered.

import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { getEntitlements } from '@/lib/entitlements'
import { checkQuota, consumeQuota } from '@/lib/quota'
import { upgradeHref } from '@/lib/upgradePath'
import { buildGate, type Gate } from '@/lib/gate'
import { logActivity } from '@/lib/activityLog'
import { notify, notifyMany } from '@/lib/notifications'
import { tuitionPath } from '@/lib/slugs'
import { deliverEmail } from '@/lib/notify'
import { revalidateLanding } from '@/lib/landingRevalidate'

export type JobInput = {
  title: string
  masterIds: number[]
  classLevel: string | null
  city: string | null
  area: string | null
  /**
   * '' or null means the parent left the Mode select on "Any", which is
   * 'both' -- coerced at both write sites rather than stored as NULL. NULL is
   * exactly what made fifty-one jobs invisible to the mode filter before
   * migration 35, and the column is NOT NULL now, so an explicit null would
   * fail the insert rather than quietly reproduce the bug.
   */
  teachingMode: string | null
  budgetPkr: number | null
  /**
   * The budget BAND the parent chose (migration 37). A band has two ends and
   * `budget_pkr` is one integer, so both are stored: the range is what the
   * parent actually said, and `budget_pkr` stays the single figure every
   * existing query, index and card already reads.
   */
  budgetMin?: number | null
  budgetMax?: number | null
  schedule: string | null
  description: string | null
  childId: string | null
}

type Fail = { ok: false; status: number; error: string; upgrade?: string; gate?: Gate }

function newJobTxId(): string {
  return `JOB-TX-${Math.random().toString(36).slice(2, 9).toUpperCase()}`
}

function validate(input: JobInput): string | null {
  if (!input.title || input.title.trim().length < 6) {
    return 'Give the job a title of at least 6 characters.'
  }
  if (input.masterIds.length === 0) {
    return 'Choose at least one subject.'
  }
  if (!input.city) return 'Choose a city.'
  if (input.budgetPkr !== null && (input.budgetPkr < 0 || input.budgetPkr > 10_000_000)) {
    return 'Enter a realistic monthly budget.'
  }
  // The band's own ends, held to the same range. The form only ever sends one
  // of five fixed pairs, but this is a request body and the CHECK constraint
  // behind it only asserts min <= max -- it would happily store a nine-figure
  // "budget" that no card could render sensibly.
  for (const end of [input.budgetMin, input.budgetMax]) {
    if (end !== null && end !== undefined && (end < 0 || end > 10_000_000)) {
      return 'Enter a realistic monthly budget.'
    }
  }
  if (
    input.budgetMin !== null &&
    input.budgetMin !== undefined &&
    input.budgetMax !== null &&
    input.budgetMax !== undefined &&
    input.budgetMin > input.budgetMax
  ) {
    return 'That budget range runs backwards.'
  }
  return null
}

export async function createJob(
  parentId: string,
  input: JobInput,
): Promise<{ ok: true; id: string; jobTxId: string } | Fail> {
  const problem = validate(input)
  if (problem) return { ok: false, status: 400, error: problem }

  const supabase = await createClient()

  const { data: profile } = await supabase
    .from('profiles')
    .select('cnic_verified_at, address_verified_at, verification_state')
    .eq('id', parentId)
    .maybeSingle()

  if (!profile?.cnic_verified_at || !profile?.address_verified_at) {
    return {
      ok: false,
      status: 403,
      error:
        profile?.verification_state === 'submitted'
          ? 'Your verification is still being reviewed. You can post once it is approved.'
          : 'Verify your CNIC and address before posting a job.',
      upgrade: '/parent/verify',
    }
  }

  const ent = await getEntitlements(parentId)

  // A suspended parent has no entitlements at all, so checkQuota would tell
  // them to buy a plan. They do not need a plan; they need the suspension
  // lifted, and an upsell here would be both useless and insulting.
  if (ent.suspended) {
    return {
      ok: false,
      status: 403,
      error: 'Your account is suspended, so you cannot post jobs. Contact support.',
      upgrade: '/support',
      gate: await buildGate('suspended', ent),
    }
  }

  const quota = checkQuota(ent, 'job_post')
  if (!quota.ok) {
    return { ...quota, gate: await buildGate('parent_post_quota', ent) }
  }

  // A child must belong to the parent posting the job.
  if (input.childId) {
    const { data: child } = await supabase
      .from('children')
      .select('id')
      .eq('id', input.childId)
      .eq('parent_id', parentId)
      .maybeSingle()
    if (!child) return { ok: false, status: 400, error: 'That child is not on your account.' }
  }

  const labels = await subjectLabels(input.masterIds)
  const jobTxId = newJobTxId()

  const { data: job, error } = await supabase
    .from('jobs')
    .insert({
      job_tx_id: jobTxId,
      parent_id: parentId,
      title: input.title.trim(),
      class_level: input.classLevel,
      city: input.city,
      area: input.area ?? '',
      teaching_mode: input.teachingMode || 'both',
      budget_pkr: bandFigure(input),
      budget_min_pkr: input.budgetMin ?? null,
      budget_max_pkr: input.budgetMax ?? null,
      description: input.description,
      child_id: input.childId,
      status: 'open',
      is_featured: !!ent.tagLabel,
      // Denormalised copy for listings that have not moved to job_subjects.
      subjects: labels,
      // Legacy NOT NULL columns, mirrored until T8 removes them.
      subject: labels.join(', ') || 'Tuition',
      grade: input.classLevel ?? '',
      budget: bandFigure(input) === null ? '' : String(bandFigure(input)),
      timings: input.schedule ?? '',
    })
    .select('id, job_tx_id, public_slug')
    .single()

  if (error) return { ok: false, status: 400, error: error.message }

  const { error: linkError } = await supabase
    .from('job_subjects')
    .insert(input.masterIds.map((master_id) => ({ job_id: job.id, master_id })))

  if (linkError) {
    // Without its subjects a job cannot be matched to anyone, so it is worse
    // than useless. Remove it rather than leave an unmatchable post behind.
    await supabase.from('jobs').delete().eq('id', job.id)
    return { ok: false, status: 400, error: linkError.message }
  }

  await consumeQuota(parentId, 'job_post')

  await logActivity({
    userId: parentId,
    event: 'job_posted',
    targetType: 'job',
    targetId: job.id,
    meta: { jobTxId, city: input.city, masterIds: input.masterIds, featured: !!ent.tagLabel },
  })

  // Tell the tutors this job actually matches.
  //
  // Deliberately sent to tutors who CANNOT apply as well as those who can. The
  // point of the funnel is that a tutor sees the work they are missing; hiding
  // it from them until they pay would be selling something they have no reason
  // to want. The wording says plainly who can act on it, so it informs rather
  // than teases, and it carries no price -- that arrives only if they press
  // Apply.
  await notifyMatchingTutors(
    job.id as string,
    (job.public_slug as string) ?? null,
    input,
  )

  // A new open tuition can open a (city, subject) tuition landing page.
  revalidateLanding()

  return { ok: true, id: job.id as string, jobTxId: job.job_tx_id as string }
}

export async function updateJob(
  parentId: string,
  jobId: string,
  input: JobInput,
): Promise<{ ok: true } | Fail> {
  const problem = validate(input)
  if (problem) return { ok: false, status: 400, error: problem }

  const supabase = await createClient()

  const { data: existing } = await supabase
    .from('jobs')
    .select('id, parent_id, status')
    .eq('id', jobId)
    .maybeSingle()

  if (!existing || existing.parent_id !== parentId) {
    return { ok: false, status: 404, error: 'Job not found.' }
  }
  if (existing.status !== 'open') {
    return { ok: false, status: 400, error: 'This job is closed and can no longer be edited.' }
  }

  const labels = await subjectLabels(input.masterIds)

  const { error } = await supabase
    .from('jobs')
    .update({
      title: input.title.trim(),
      class_level: input.classLevel,
      city: input.city,
      area: input.area ?? '',
      teaching_mode: input.teachingMode || 'both',
      budget_pkr: bandFigure(input),
      budget_min_pkr: input.budgetMin ?? null,
      budget_max_pkr: input.budgetMax ?? null,
      description: input.description,
      child_id: input.childId,
      subjects: labels,
      subject: labels.join(', ') || 'Tuition',
      grade: input.classLevel ?? '',
      budget: bandFigure(input) === null ? '' : String(bandFigure(input)),
      timings: input.schedule ?? '',
    })
    .eq('id', jobId)

  if (error) return { ok: false, status: 400, error: error.message }

  // Editing does not re-check quota: the post was already paid for. Subjects
  // are replaced wholesale so a removed subject really is removed.
  await supabase.from('job_subjects').delete().eq('job_id', jobId)
  await supabase
    .from('job_subjects')
    .insert(input.masterIds.map((master_id) => ({ job_id: jobId, master_id })))

  await logActivity({
    userId: parentId,
    event: 'job_edited',
    targetType: 'job',
    targetId: jobId,
    meta: { masterIds: input.masterIds },
  })

  return { ok: true }
}

export async function closeJob(parentId: string, jobId: string): Promise<{ ok: true } | Fail> {
  const supabase = await createClient()

  const { data: job } = await supabase
    .from('jobs')
    .select('id, parent_id, status, title')
    .eq('id', jobId)
    .maybeSingle()

  if (!job || job.parent_id !== parentId) {
    return { ok: false, status: 404, error: 'Job not found.' }
  }
  if (job.status !== 'open') return { ok: true }

  const { error } = await supabase
    .from('jobs')
    .update({ status: 'closed', closed_at: new Date().toISOString() })
    .eq('id', jobId)

  if (error) return { ok: false, status: 400, error: error.message }

  // Everyone who applied deserves to know the job is gone rather than being
  // left waiting on a post that will never be answered.
  const admin = createAdminClient()
  if (admin) {
    const { data: applicants } = await admin
      .from('applications')
      .select('tutor_id')
      .eq('job_id', jobId)
      .is('withdrawn_at', null)

    await notifyMany(
      (applicants ?? []).map((a) => a.tutor_id as string),
      {
        kind: 'job_closed',
        title: 'A job you applied for was closed',
        body: job.title as string,
        // Not the tuition's own page: a closed tuition answers 410. The
        // tutor's applications list is where this application still exists.
        href: '/tutor/dashboard/applications',
      },
    )
  }

  await logActivity({ userId: parentId, event: 'job_closed', targetType: 'job', targetId: jobId })

  // A closed tuition can close its landing pages (drop the count below the
  // threshold), so refresh the landing cache.
  revalidateLanding()

  return { ok: true }
}

/**
 * Mark an applicant hired.
 *
 * parent_featured only. This is the single most valuable thing Featured buys,
 * so the check is here, in the code path, and the UI merely reflects it.
 */
export async function hireApplicant(
  parentId: string,
  applicationId: string,
): Promise<{ ok: true; tutorId: string } | Fail> {
  const supabase = await createClient()

  const { data: application } = await supabase
    .from('applications')
    .select('id, job_id, tutor_id, status, withdrawn_at')
    .eq('id', applicationId)
    .maybeSingle()

  if (!application) return { ok: false, status: 404, error: 'Application not found.' }
  if (application.withdrawn_at) {
    return { ok: false, status: 400, error: 'That tutor has withdrawn their application.' }
  }

  const { data: job } = await supabase
    .from('jobs')
    .select('id, parent_id, status, title, job_tx_id')
    .eq('id', application.job_id as string)
    .maybeSingle()

  if (!job || job.parent_id !== parentId) {
    return { ok: false, status: 404, error: 'Job not found.' }
  }
  if (job.status === 'hired') {
    return { ok: false, status: 400, error: 'This job already has a hired tutor.' }
  }

  const ent = await getEntitlements(parentId)

  // Suspension first, and separately from canHire.
  //
  // getEntitlements() turns every power off for a suspended member, canHire
  // included, so without this the branch below tells them to buy Featured --
  // selling a plan to somebody a moderator has stopped, for a problem no plan
  // fixes. createJob, applyToJob and canStartThread were already ordered this
  // way; hire was the one that was not.
  if (ent.suspended) {
    return {
      ok: false,
      status: 403,
      error: 'Your account is suspended, so you cannot hire. Contact support.',
      upgrade: '/support',
      gate: await buildGate('suspended', ent),
    }
  }
  if (!ent.canHire) {
    return {
      ok: false,
      status: 403,
      error: 'Completing a hire is a Featured feature. Upgrade to hire this tutor.',
      upgrade: upgradeHref('parent', ent.plan, 'parent_featured'),
      gate: await buildGate('parent_hire', ent),
    }
  }

  const now = new Date().toISOString()

  const { error: appError } = await supabase
    .from('applications')
    .update({ status: 'hired', status_changed_at: now })
    .eq('id', applicationId)
  if (appError) return { ok: false, status: 400, error: appError.message }

  const { error: jobError } = await supabase
    .from('jobs')
    .update({
      status: 'hired',
      hired_tutor_id: application.tutor_id,
      hired_at: now,
      closed_at: now,
    })
    .eq('id', job.id)
  if (jobError) return { ok: false, status: 400, error: jobError.message }

  const admin = createAdminClient()
  if (admin) {
    // Everyone else is rejected in one statement, and told. Leaving other
    // applicants on "applied" forever is how a marketplace loses its tutors.
    const { data: others } = await admin
      .from('applications')
      .select('id, tutor_id')
      .eq('job_id', job.id)
      .neq('id', applicationId)
      .is('withdrawn_at', null)
      .in('status', ['applied', 'shortlisted'])

    if ((others ?? []).length > 0) {
      await admin
        .from('applications')
        .update({ status: 'rejected', status_changed_at: now })
        .in(
          'id',
          (others ?? []).map((o) => o.id as string),
        )

      await notifyMany(
        (others ?? []).map((o) => o.tutor_id as string),
        {
          kind: 'job_filled',
          title: 'A job you applied for has been filled',
          body: job.title as string,
          href: '/tutor/dashboard/applications',
        },
      )

      for (const o of others ?? []) {
        await logActivity({
          userId: o.tutor_id as string,
          event: 'verification_decision_received',
          targetType: 'application',
          targetId: o.id as string,
          meta: { outcome: 'job_filled', jobId: job.id },
        })
      }
    }
  }

  await notify({
    userId: application.tutor_id as string,
    kind: 'hired',
    title: 'You have been hired',
    body: job.title as string,
    href: '/tutor/dashboard/applications',
  })

  // Being hired is the whole point of the platform for a tutor, and it can
  // happen while they are nowhere near the site. Essential mail.
  {
    const { data: tutor } = await supabase
      .from('profiles')
      .select('full_name')
      .eq('id', application.tutor_id as string)
      .maybeSingle()

    await deliverEmail(
      { userId: application.tutor_id as string },
      {
        id: 'application_progress',
        name: (tutor?.full_name as string) ?? 'there',
        outcome: 'hired',
        jobTitle: job.title as string,
        href: '/tutor/dashboard/applications',
      },
    )
  }

  await logActivity({
    userId: parentId,
    event: 'job_closed',
    targetType: 'job',
    targetId: job.id as string,
    meta: { outcome: 'hired', tutorId: application.tutor_id },
  })
  await logActivity({
    userId: application.tutor_id as string,
    event: 'application_submitted',
    targetType: 'application',
    targetId: applicationId,
    meta: { outcome: 'hired', jobId: job.id },
  })

  // Hiring closes the tuition, so it may close a landing page.
  revalidateLanding()

  return { ok: true, tutorId: application.tutor_id as string }
}

/** Display labels for taxonomy_master ids, in taxonomy order. */
/**
 * The one figure that represents a band, for `jobs.budget_pkr`.
 *
 * The band's lower bound, or its upper bound for the band that has no lower
 * one ("Under Rs 5,000"). Chosen so every band round-trips through the
 * EXISTING browse filter, which compares budget_pkr with >= budgetMin and
 * <= budgetMax -- see the table in migration 37. That is why /browse/tuitions
 * needed no change to find jobs posted through the new select.
 */
function bandFigure(input: JobInput): number | null {
  if (input.budgetMin !== null && input.budgetMin !== undefined) return input.budgetMin
  if (input.budgetMax !== null && input.budgetMax !== undefined) return input.budgetMax
  return input.budgetPkr
}

export async function subjectLabels(masterIds: number[]): Promise<string[]> {
  if (masterIds.length === 0) return []

  const supabase = await createClient()
  const { data: master } = await supabase
    .from('taxonomy_master')
    .select('id, level_slug, subject_slug')
    .in('id', masterIds)

  const levelSlugs = Array.from(new Set((master ?? []).map((m) => m.level_slug as string)))
  const subjectSlugs = Array.from(
    new Set((master ?? []).map((m) => m.subject_slug as string | null).filter(Boolean) as string[]),
  )

  const [{ data: levels }, { data: subjects }] = await Promise.all([
    supabase.from('taxonomy_levels').select('slug, name').in('slug', levelSlugs),
    subjectSlugs.length > 0
      ? supabase.from('taxonomy_subjects').select('slug, name').in('slug', subjectSlugs)
      : Promise.resolve({ data: [] as { slug: string; name: string }[] }),
  ])

  const levelName = new Map((levels ?? []).map((l) => [l.slug as string, l.name as string]))
  const subjectName = new Map((subjects ?? []).map((s) => [s.slug as string, s.name as string]))

  const out: string[] = []
  for (const m of master ?? []) {
    const subject = m.subject_slug ? subjectName.get(m.subject_slug as string) : null
    // Level-leaves (Test Preparations, Sports & Games, Holy Quran) have no
    // subject: the level itself is the item.
    const label = subject ?? levelName.get(m.level_slug as string)
    if (label && !out.includes(label)) out.push(label)
  }
  return out
}

/**
 * Notify every listed tutor whose subjects match a newly posted job.
 *
 * Best-effort and non-blocking in spirit: a failure here must never fail the
 * job post. The parent did their part, and losing a job because a notification
 * fan-out errored would be the worst possible trade.
 *
 * Capped at 50 recipients. A job matching more tutors than that is a taxonomy
 * problem, not a mailing list, and an uncapped fan-out on a popular subject is
 * how one job post becomes a thousand writes.
 */
async function notifyMatchingTutors(
  jobId: string,
  publicSlug: string | null,
  input: { masterIds: number[]; city: string | null; area?: string | null; teachingMode?: string | null },
): Promise<void> {
  try {
    const admin = createAdminClient()
    // A job with no city cannot be matched to tutors by location, and a
    // nationwide fan-out is not what this is for.
    if (!admin || input.masterIds.length === 0 || !input.city) return

    const { data: matches } = await admin
      .from('tutor_subjects')
      .select('tutor_id')
      .in('master_id', input.masterIds)

    const tutorIds = [...new Set((matches ?? []).map((m) => m.tutor_id as string))]
    if (tutorIds.length === 0) return

    // tutor_directory, not tutor_profiles: only tutors the platform is actually
    // showing to parents. Telling a suspended or unlisted tutor about work they
    // cannot be found for is noise.
    const { data: sameCityRows } = await admin
      .from('tutor_directory')
      .select('id')
      .in('id', tutorIds)
      .eq('city', input.city)
      .limit(50)
    const sameCityIds = new Set((sameCityRows ?? []).map((r) => r.id as string))

    // Cross-city tutors are a match ONLY when the tuition can be taught online
    // (lib/matchChip.ts). For an online/both job we also notify a bounded set
    // of them, flagged so the card carries a "Suitable for online" chip; an
    // in-person job never fans out beyond its own city. Capped hard — a popular
    // subject taught online must not turn one post into a nationwide mailing.
    let crossCityIds: string[] = []
    if (input.teachingMode === 'online' || input.teachingMode === 'both') {
      const { data: crossRows } = await admin
        .from('tutor_directory')
        .select('id')
        .in('id', tutorIds)
        .neq('city', input.city) // null-city tutors are excluded by <> ; correct — we cannot claim online suitability for an unknown city
        .limit(30)
      crossCityIds = (crossRows ?? [])
        .map((r) => r.id as string)
        .filter((id) => !sameCityIds.has(id))
    }

    const subjectName = await subjectLabelFor(admin, input.masterIds[0])
    const where = input.area ? `${input.area}, ${input.city}` : input.city
    // The tuition's own page. This used to be `/browse/tuitions?job=<id>` -- a
    // query parameter nothing on that page reads, so the tutor landed on the
    // unfiltered board and had to find the job the notification was about.
    const href = tuitionPath({ public_slug: publicSlug, city: input.city, id: jobId })

    for (const id of sameCityIds) {
      await notify({
        userId: id,
        kind: 'job_matched',
        title: `New ${subjectName} job in ${where}`,
        body: `New ${subjectName} job in ${where} — Verified tutors can apply.`,
        href,
      })
    }

    for (const id of crossCityIds) {
      await notify({
        userId: id,
        kind: 'job_matched',
        title: `New ${subjectName} job in ${where}`,
        body: `New ${subjectName} job in ${where}, teachable online — Verified tutors can apply.`,
        href,
        meta: { online_suitable: true },
      })
    }
  } catch {
    // See above: never fail a job post over a notification.
  }
}

/** Human name for a taxonomy_master row, for notification copy. */
async function subjectLabelFor(
  admin: NonNullable<ReturnType<typeof createAdminClient>>,
  masterId: number,
): Promise<string> {
  const { data: m } = await admin
    .from('taxonomy_master')
    .select('subject_slug, level_slug')
    .eq('id', masterId)
    .maybeSingle()
  if (!m) return 'tuition'
  if (m.subject_slug) {
    const { data: s } = await admin
      .from('taxonomy_subjects')
      .select('name')
      .eq('slug', m.subject_slug)
      .maybeSingle()
    if (s?.name) return s.name as string
  }
  const { data: l } = await admin
    .from('taxonomy_levels')
    .select('name')
    .eq('slug', m.level_slug)
    .maybeSingle()
  return (l?.name as string) ?? 'tuition'
}
