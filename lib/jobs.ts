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
import { flagIfAbusive } from '@/lib/abuse/flag'
import { detectAbuse } from '@/lib/abuse/filter'
import { WITHHELD_TUITION_LINE } from '@/lib/abuse/warnings'
import { checkQuota, consumeQuota } from '@/lib/quota'
import { upgradeHref } from '@/lib/upgradePath'
import { buildGate, type Gate } from '@/lib/gate'
import { logActivity } from '@/lib/activityLog'
import { logAdminAction } from '@/lib/auditLog'
import { notify, notifyMany } from '@/lib/notifications'
import { tuitionPath } from '@/lib/slugs'
import { normaliseGenderPref } from '@/lib/genderPref'
import { deliverEmail } from '@/lib/notify'
import { revalidateLanding } from '@/lib/landingRevalidate'
import { teamParentId } from '@/lib/teamAccount'
import { buildJobContact } from '@/lib/jobContactCore'
import { matchVisibility, isOnlineType } from '@/lib/matchChip'
import { collapseLevels } from '@/lib/levelDisplay'
import type { AdminRole } from '@/lib/adminAuth'

// Level is multi-select now (migration 79): jobs.class_levels is the array, and
// jobs.class_level (+ the legacy `grade` mirror) hold the collapsed display run.
function levelArr(input: { classLevels?: string[] | null; classLevel: string | null }): string[] {
  if (input.classLevels && input.classLevels.length > 0) return input.classLevels
  return input.classLevel ? [input.classLevel] : []
}
function levelDisplay(input: { classLevels?: string[] | null; classLevel: string | null }): string {
  return collapseLevels(levelArr(input)) || input.classLevel || ''
}

export type JobInput = {
  title: string
  masterIds: number[]
  /** Legacy single level (a collapsed display string). Kept for callers that
   *  send one; classLevels is the multi-select source of truth (migration 79). */
  classLevel: string | null
  /** The selected levels (migration 79). Stored as jobs.class_levels; the
   *  collapsed run is written to class_level for display. */
  classLevels?: string[]
  city: string | null
  area: string | null
  /**
   * The job's single Job Type title (migration 77), stored verbatim in the
   * `teaching_mode` column (kept its name). '' or null means the parent left the
   * select empty and is coerced to 'Home Tutor' at both write sites — the column
   * is NOT NULL, so an explicit null would fail the insert.
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
  /**
   * Optional preferred tutor gender ('male'|'female'|'trans'), NULL = no
   * preference (migration 72). Stored on the jobs row; shown plainly and gates
   * only the Apply action. Never required.
   */
  genderPreference?: string | null
  /**
   * Team (admin-posted) tuitions only: the REAL poster's contact, for a seeded
   * job copied from a public hiring ad (school/academy). All of these are stored
   * in the locked `job_contacts` table (NOT on the anon-readable jobs row), shown
   * openly to signed-in tutors, never to a parent, a crawler, or any public
   * metadata. Ignored on a normal parent post.
   */
  contactName?: string | null
  contactPhone?: string | null
  contactWhatsapp?: string | null
  contactEmail?: string | null
  contactAddress?: string | null
  contactSocial?: string | null
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

  // PR41 §2 — a tuition whose title or description contains banned wording is
  // NOT published. Checked before the insert: a flag is raised (withheld,
  // counting toward the third-strike suspension) and the post is refused with a
  // plain line. No job row is created and no quota is spent.
  {
    const abuseText = [input.title, input.description].filter(Boolean).join('\n\n')
    if (detectAbuse(abuseText).length > 0) {
      try {
        await flagIfAbusive({ source: 'tuition', subjectId: parentId, content: abuseText, withheld: true })
      } catch {
        /* the content stays unpublished whether or not the flag write succeeded */
      }
      return { ok: false, status: 400, error: WITHHELD_TUITION_LINE }
    }
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

  // jobs.is_featured (a plan cache) is set here from the parent's entitlements,
  // so the INSERT goes through the SERVICE ROLE — is_featured is locked from the
  // member client on insert too (migration 105), so a member cannot POST a job
  // with is_featured already true. parent_id is the authenticated parentId, so
  // the row still belongs to them; RLS is bypassed only for this trusted write.
  const admin = createAdminClient()
  if (!admin) return { ok: false, status: 503, error: 'Server is not configured.' }

  const { data: job, error } = await admin
    .from('jobs')
    .insert({
      job_tx_id: jobTxId,
      parent_id: parentId,
      title: input.title.trim(),
      class_levels: levelArr(input),
      class_level: levelDisplay(input),
      city: input.city,
      area: input.area ?? '',
      teaching_mode: input.teachingMode || 'Home Tutor',
      budget_pkr: bandFigure(input),
      budget_min_pkr: input.budgetMin ?? null,
      budget_max_pkr: input.budgetMax ?? null,
      gender_preference: normaliseGenderPref(input.genderPreference),
      description: input.description,
      child_id: input.childId,
      status: 'open',
      is_featured: !!ent.tagLabel,
      // Denormalised copy for listings that have not moved to job_subjects.
      subjects: labels,
      // Legacy NOT NULL columns, mirrored until T8 removes them.
      subject: labels.join(', ') || 'Tuition',
      grade: levelDisplay(input),
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
    // Through the service role, since the row was inserted that way.
    await admin.from('jobs').delete().eq('id', job.id)
    return { ok: false, status: 400, error: linkError.message }
  }

  await consumeQuota(parentId, 'job_post')

  // Abusive tuition text was withheld and flagged before the insert (PR41 §2),
  // so a posted job here contains no flagged wording.

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

/** Where an admin-posted tuition came from, recorded on the audit row. */
export type JobOrigin = 'support' | 'referral' | 'external'

/**
 * Post a tuition on the team-operated TutorMint parent account (owner, 9 Sep).
 *
 * This is the ONLY difference from a parent posting: the job is created for the
 * team account (a real parent_featured account) through the service-role client,
 * because the RLS insert CHECK is `parent_id = auth.uid()` and the caller is the
 * admin, not the team account. Everything downstream — applications, threads,
 * shortlisting, hiring — then runs through the ordinary parent flows with no
 * special-casing, because `parent_id` names a real account like any other job.
 *
 * The parent-side gates in createJob (CNIC/address verification, monthly quota)
 * are deliberately NOT applied here: a team post carries the platform's own
 * vetting rather than a CNIC-verified parent's, and the platform is not rate-
 * limited against a member's monthly cap. `is_featured` is stamped from the team
 * account's own entitlements, exactly as createJob stamps it from the parent's,
 * so a properly provisioned parent_featured team account gets the Featured tag.
 *
 * It refuses — rather than inventing a recipient — if the team account has not
 * been provisioned (scripts/provision-team-parent.ts).
 */
export async function createTeamJob(
  input: JobInput,
  actor: { id: string; adminRole: AdminRole; email: string | null },
  origin: JobOrigin | null,
): Promise<{ ok: true; id: string; jobTxId: string; publicSlug: string | null } | Fail> {
  const problem = validate(input)
  if (problem) return { ok: false, status: 400, error: problem }

  // Validate the contact block BEFORE creating anything, so a bad phone / email
  // is a clean 400 rather than a create-then-delete. Normalisation (MSISDN,
  // email shape) happens here; only what was filled survives.
  const contact = buildJobContact({
    name: input.contactName,
    phone: input.contactPhone,
    whatsapp: input.contactWhatsapp,
    email: input.contactEmail,
    address: input.contactAddress,
    social: input.contactSocial,
  })
  if (!contact.ok) return { ok: false, status: 400, error: contact.error }

  const admin = createAdminClient()
  if (!admin) return { ok: false, status: 503, error: 'Server is not configured.' }

  const teamId = await teamParentId()
  if (!teamId) {
    return {
      ok: false,
      status: 409,
      error:
        'The TutorMint team account has not been provisioned yet. An owner must run ' +
        'scripts/provision-team-parent.ts before a team tuition can be posted.',
    }
  }

  // is_featured follows the team account's plan, like any parent's job.
  const ent = await getEntitlements(teamId)

  // PR41 §2 — a team tuition with banned wording is NOT posted either. Attributed
  // to the acting ADMIN (they wrote it), never the shared team account, so a
  // stray flag can never suspend the team account.
  {
    const abuseText = [input.title, input.description].filter(Boolean).join('\n\n')
    if (detectAbuse(abuseText).length > 0) {
      try {
        await flagIfAbusive({
          source: 'tuition', subjectId: actor.id, content: abuseText,
          context: { teamPost: true }, withheld: true,
        })
      } catch {
        /* the content stays unpublished whether or not the flag write succeeded */
      }
      return { ok: false, status: 400, error: WITHHELD_TUITION_LINE }
    }
  }

  const labels = await subjectLabels(input.masterIds)
  const jobTxId = newJobTxId()

  const { data: job, error } = await admin
    .from('jobs')
    .insert({
      job_tx_id: jobTxId,
      parent_id: teamId,
      title: input.title.trim(),
      class_levels: levelArr(input),
      class_level: levelDisplay(input),
      city: input.city,
      area: input.area ?? '',
      teaching_mode: input.teachingMode || 'Home Tutor',
      budget_pkr: bandFigure(input),
      budget_min_pkr: input.budgetMin ?? null,
      budget_max_pkr: input.budgetMax ?? null,
      gender_preference: normaliseGenderPref(input.genderPreference),
      description: input.description,
      child_id: null,
      status: 'open',
      is_featured: !!ent.tagLabel,
      subjects: labels,
      subject: labels.join(', ') || 'Tuition',
      grade: levelDisplay(input),
      budget: bandFigure(input) === null ? '' : String(bandFigure(input)),
      timings: input.schedule ?? '',
    })
    .select('id, job_tx_id, public_slug')
    .single()

  if (error) return { ok: false, status: 400, error: error.message }

  const { error: linkError } = await admin
    .from('job_subjects')
    .insert(input.masterIds.map((master_id) => ({ job_id: job.id, master_id })))

  if (linkError) {
    await admin.from('jobs').delete().eq('id', job.id)
    return { ok: false, status: 400, error: linkError.message }
  }

  // The real poster's contact, when the admin supplied any. Stored in the locked
  // job_contacts table (never on the anon-readable job); already normalised and
  // validated above. Only what was filled is written.
  const hasContact = contact.hasContact
  if (hasContact) {
    const { error: contactError } = await admin.from('job_contacts').insert({
      job_id: job.id,
      ...contact.record,
      created_by: actor.id,
    })
    if (contactError) {
      await admin.from('job_subjects').delete().eq('job_id', job.id)
      await admin.from('jobs').delete().eq('id', job.id)
      return { ok: false, status: 400, error: contactError.message }
    }
  }

  // Abusive tuition text was withheld and flagged before the insert (PR41 §2),
  // so a posted team job here contains no flagged wording.

  // On the team account's own timeline, so a team post appears there like any
  // other posted job — flagged as admin-posted with the origin and acting admin.
  await logActivity({
    userId: teamId,
    event: 'job_posted',
    targetType: 'job',
    targetId: job.id as string,
    meta: { jobTxId, city: input.city, masterIds: input.masterIds, adminPosted: true, origin, byAdmin: actor.id },
  })

  // Every admin-posted job is audit-logged with the admin who created it and,
  // where known, its origin.
  await logAdminAction({
    actorId: actor.id,
    actorRole: actor.adminRole,
    actorEmail: actor.email,
    action: 'job.post',
    targetType: 'job',
    targetId: job.id as string,
    detail: { jobTxId, city: input.city, title: input.title.trim(), masterIds: input.masterIds, origin, hasContact },
  })

  await notifyMatchingTutors(job.id as string, (job.public_slug as string) ?? null, input)
  revalidateLanding()

  return {
    ok: true,
    id: job.id as string,
    jobTxId: job.job_tx_id as string,
    publicSlug: (job.public_slug as string) ?? null,
  }
}

/**
 * Edit a TEAM-posted tuition (owner PR9 §2). Admin edit of an admin-posted job:
 * it saves to the SAME row, so the job id, TM reference, public_slug (URL) and
 * every application are unchanged — public_slug is INSERT-only (migration 40), so
 * changing the title never changes the address, and no redirect is needed. Only a
 * team-posted job is editable this way (§2.3); a parent's own job is not. Every
 * edit needs a reason and is logged to admin_audit_log with the changed fields.
 */
export async function updateTeamJob(
  jobId: string,
  input: JobInput,
  actor: { id: string; adminRole: AdminRole; email: string | null },
  reason: string,
): Promise<{ ok: true; publicSlug: string | null } | Fail> {
  const problem = validate(input)
  if (problem) return { ok: false, status: 400, error: problem }
  if (!reason || reason.trim().length < 3) {
    return { ok: false, status: 400, error: 'Give a reason for this change — it is recorded.' }
  }

  const contact = buildJobContact({
    name: input.contactName,
    phone: input.contactPhone,
    whatsapp: input.contactWhatsapp,
    email: input.contactEmail,
    address: input.contactAddress,
    social: input.contactSocial,
  })
  if (!contact.ok) return { ok: false, status: 400, error: contact.error }

  const admin = createAdminClient()
  if (!admin) return { ok: false, status: 503, error: 'Server is not configured.' }

  const teamId = await teamParentId()
  const { data: existing } = await admin
    .from('jobs')
    .select(
      'id, parent_id, status, public_slug, job_tx_id, ref_id, title, class_levels, city, area, teaching_mode, budget_min_pkr, budget_max_pkr, description, gender_preference, timings, subjects',
    )
    .eq('id', jobId)
    .maybeSingle()

  if (!existing) return { ok: false, status: 404, error: 'Tuition not found.' }
  // §2.3: only team-posted tuitions are editable by admin here. A parent's own
  // job is close/remove-only for admin.
  if (!teamId || existing.parent_id !== teamId) {
    return { ok: false, status: 403, error: 'Only team-posted tuitions can be edited here.' }
  }

  const labels = await subjectLabels(input.masterIds)
  const next = {
    title: input.title.trim(),
    class_levels: levelArr(input),
    class_level: levelDisplay(input),
    city: input.city,
    area: input.area ?? '',
    teaching_mode: input.teachingMode || 'Home Tutor',
    budget_pkr: bandFigure(input),
    budget_min_pkr: input.budgetMin ?? null,
    budget_max_pkr: input.budgetMax ?? null,
    gender_preference: normaliseGenderPref(input.genderPreference),
    description: input.description,
    subjects: labels,
    subject: labels.join(', ') || 'Tuition',
    grade: levelDisplay(input),
    budget: bandFigure(input) === null ? '' : String(bandFigure(input)),
    timings: input.schedule ?? '',
    // NOT touched: id, job_tx_id, ref_id, public_slug, parent_id, status,
    // is_featured, applications.
  }

  // The changed fields, for the audit (§2.2). Compared in the reader's terms.
  const changed: string[] = []
  const diff = (k: string, a: unknown, b: unknown) => {
    if (JSON.stringify(a ?? null) !== JSON.stringify(b ?? null)) changed.push(k)
  }
  diff('title', existing.title, next.title)
  diff('grades', existing.class_levels, next.class_levels)
  diff('city', existing.city, next.city)
  diff('area', existing.area, next.area)
  diff('jobType', existing.teaching_mode, next.teaching_mode)
  diff('budget', [existing.budget_min_pkr, existing.budget_max_pkr], [next.budget_min_pkr, next.budget_max_pkr])
  diff('genderPreference', existing.gender_preference, next.gender_preference)
  diff('description', existing.description, next.description)
  diff('schedule', existing.timings, next.timings)
  diff('subjects', existing.subjects, next.subjects)

  const { error } = await admin.from('jobs').update(next).eq('id', jobId)
  if (error) return { ok: false, status: 400, error: error.message }

  // Subjects replaced wholesale so a removed one really is removed.
  await admin.from('job_subjects').delete().eq('job_id', jobId)
  await admin
    .from('job_subjects')
    .insert(input.masterIds.map((master_id) => ({ job_id: jobId, master_id })))

  // The seeded parent-contact block, edited or cleared.
  if (contact.hasContact) {
    await admin
      .from('job_contacts')
      .upsert({ job_id: jobId, ...contact.record, created_by: actor.id }, { onConflict: 'job_id' })
    changed.push('contact')
  } else {
    const { data: had } = await admin.from('job_contacts').select('job_id').eq('job_id', jobId).maybeSingle()
    if (had) {
      await admin.from('job_contacts').delete().eq('job_id', jobId)
      changed.push('contact')
    }
  }

  await logActivity({
    userId: teamId,
    event: 'job_edited',
    targetType: 'job',
    targetId: jobId,
    meta: { adminPosted: true, byAdmin: actor.id, changed },
  })
  await logAdminAction({
    actorId: actor.id,
    actorRole: actor.adminRole,
    actorEmail: actor.email,
    action: 'job.edit',
    targetType: 'job',
    targetId: jobId,
    detail: { reason: reason.trim(), changed, jobTxId: existing.job_tx_id, refId: existing.ref_id },
  })

  revalidateLanding()
  return { ok: true, publicSlug: (existing.public_slug as string) ?? null }
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
      class_levels: levelArr(input),
      class_level: levelDisplay(input),
      city: input.city,
      area: input.area ?? '',
      teaching_mode: input.teachingMode || 'Home Tutor',
      budget_pkr: bandFigure(input),
      budget_min_pkr: input.budgetMin ?? null,
      budget_max_pkr: input.budgetMax ?? null,
      gender_preference: normaliseGenderPref(input.genderPreference),
      description: input.description,
      child_id: input.childId,
      subjects: labels,
      subject: labels.join(', ') || 'Tuition',
      grade: levelDisplay(input),
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

  // jobs.status is locked from the member's own client (migration 103), so the
  // status write goes through the service role — after the ownership check above
  // and re-scoped to this parent's own job (PR48 §2).
  const admin = createAdminClient()
  if (!admin) return { ok: false, status: 503, error: 'Server is not configured.' }

  const { error } = await admin
    .from('jobs')
    .update({ status: 'closed', closed_at: new Date().toISOString() })
    .eq('id', jobId)
    .eq('parent_id', parentId)

  if (error) return { ok: false, status: 400, error: error.message }

  // Everyone who applied deserves to know the job is gone rather than being
  // left waiting on a post that will never be answered.
  {
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
/**
 * Resume a paused tuition (PR27 §3.3). Poster-owned; sets a fresh 15-day clock
 * (resumed_at = now) and clears the pause. A no-op on a tuition that is not
 * paused, so a double tap does nothing.
 */
export async function resumeJob(parentId: string, jobId: string): Promise<{ ok: true } | Fail> {
  const supabase = await createClient()

  const { data: job } = await supabase
    .from('jobs')
    .select('id, parent_id, status')
    .eq('id', jobId)
    .maybeSingle()

  if (!job || job.parent_id !== parentId) {
    return { ok: false, status: 404, error: 'Tuition not found.' }
  }
  if (job.status !== 'paused') return { ok: true }

  // jobs.status is locked from the member client (migration 103) — resume through
  // the service role, after the ownership check and re-scoped to this parent.
  const admin = createAdminClient()
  if (!admin) return { ok: false, status: 503, error: 'Server is not configured.' }

  const { error } = await admin
    .from('jobs')
    .update({ status: 'open', resumed_at: new Date().toISOString(), paused_at: null })
    .eq('id', jobId)
    .eq('parent_id', parentId)
    .eq('status', 'paused')

  if (error) return { ok: false, status: 400, error: error.message }

  // Resuming can re-open a landing page (push a city×subject count back over the
  // threshold), so refresh the landing cache.
  revalidateLanding()

  return { ok: true }
}

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
    .select('id, parent_id, status, title, job_tx_id, ref_id')
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

  // jobs.status / hired_tutor_id are locked from the member client (migration
  // 103), so the hire write goes through the service role — after the ownership,
  // suspension and Featured checks above, re-scoped to this parent's own job
  // (PR48 §2). The applications row is not locked and stays on the member client.
  const admin = createAdminClient()
  if (!admin) return { ok: false, status: 503, error: 'Server is not configured.' }

  const { error: appError } = await supabase
    .from('applications')
    .update({ status: 'hired', status_changed_at: now })
    .eq('id', applicationId)
  if (appError) return { ok: false, status: 400, error: appError.message }

  const { error: jobError } = await admin
    .from('jobs')
    .update({
      status: 'hired',
      hired_tutor_id: application.tutor_id,
      hired_at: now,
      closed_at: now,
    })
    .eq('id', job.id)
    .eq('parent_id', parentId)
  if (jobError) return { ok: false, status: 400, error: jobError.message }

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
        ref: (job.ref_id as string) ?? null,
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

    // Job Type aligns both sides (lib/matchChip.ts): a job matches tutors whose
    // OWN set of Job Types CONTAINS the job's title. Stored as job_types[], the
    // title text (migration 77). An EMPTY tutor set is "no filter" — they are a
    // candidate for any job (owner item 4) — so the buckets are decided in JS by
    // matchVisibility rather than by a `.contains()` that would drop empties.
    const jobTypeVal = input.teachingMode || 'Home Tutor'

    // tutor_directory, not tutor_profiles: only tutors the platform is actually
    // showing to parents. Telling a suspended or unlisted tutor about work they
    // cannot be found for is noise. Fetch the subject-matched candidates (already
    // a bounded set) with their job_types + city, then bucket by matchVisibility.
    const { data: candidates } = await admin
      .from('tutor_directory')
      .select('id, city, job_types')
      .in('id', tutorIds)
      .limit(200)
    const cands = (candidates ?? []) as { id: string; city: string | null; job_types: string[] | null }[]

    // Same city (or unknown city) AND the tutor offers this title or offers none.
    const sameCityIds = new Set(
      cands
        .filter((c) => c.city === input.city)
        .filter((c) => matchVisibility(jobTypeVal, input.city, c.job_types, input.city) !== 'exclude')
        .map((c) => c.id)
        .slice(0, 50),
    )

    // Cross-city tutors are a match ONLY for an ONLINE job, and only online
    // tutors (city-agnostic — matchVisibility returns 'online'). An empty-set
    // tutor is included as "no filter". A home/school post never fans out beyond
    // its own city. Capped hard — a popular subject taught online must not turn
    // one post into a nationwide mailing.
    let crossCityIds: string[] = []
    if (isOnlineType(jobTypeVal)) {
      crossCityIds = cands
        .filter((c) => matchVisibility(jobTypeVal, input.city, c.job_types, c.city) === 'online')
        .map((c) => c.id)
        .filter((id) => !sameCityIds.has(id))
        .slice(0, 30)
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
