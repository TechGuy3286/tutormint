import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { planLabel } from '@/lib/display'
import type { Entitlements } from '@/lib/entitlements'
import { tuitionPath } from '@/lib/slugs'
import { cityJobsMatchingNothing } from '@/lib/funnel'

// What is BLOCKED ON THIS PERSON, and nothing else.
//
// The dashboards this replaced put pending work, activity and content in the
// same visual language: every one of them a white rounded card with a bold
// heading, so "your CNIC is not verified and you cannot post until it is" sat
// in the same weight as "here is a tuition you might like". A member scanning
// the page had no way to tell the two apart, so the blocking item was found by
// reading everything or not at all.
//
// The test for belonging here is narrow and worth stating, because it is what
// keeps this band short enough to be read: THIS PERSON is the one who has to
// act, and there is exactly one thing for them to do. A video that is with our
// team is not here -- it is blocked on us, and putting it here would teach
// people that the band contains things they cannot act on, which is how a
// to-do list stops being read.
//
// Every row therefore carries three parts:
//   what it is   -- the title
//   why it matters -- the consequence, in the member's own terms
//   the one thing to do -- a single action, never two
//
// One action, deliberately. A row offering "Verify now" and "Learn more" makes
// the reader choose before they can act, and the second link is nearly always
// the one that does nothing for them.

/** One line of an itemised checklist inside a NeedRow (profile completion). */
export type NeedChecklistItem = { key: string; label: string; done: boolean; href: string }

export type NeedRow = {
  id: string
  title: string
  /** The consequence, stated plainly. Never a restatement of the title. */
  why: string
  action: { label: string; href: string }
  /** 'urgent' is a real block; 'warn' is a deadline approaching. */
  tone: 'urgent' | 'warn'
  /**
   * When present, the row shows exactly which items are done and which are not,
   * each incomplete one a direct link to the step that fixes it. Only the
   * completion row carries this — "33% complete" is not an instruction; the list
   * is. Built from the same profileChecklist items the percentage is, so the two
   * can never disagree.
   */
  checklist?: NeedChecklistItem[]
  /**
   * The subscription this row is about, when the row can be dismissed.
   *
   * Only the lapsed-plan row carries one. Everything else in this band is a
   * real block -- an unverified CNIC does not stop being a block because
   * somebody pressed a cross -- and a dismissable blocker is a blocker people
   * dismiss. A plan that has ended is different: the member may simply have
   * decided not to renew, and telling them so on every visit forever is
   * nagging rather than informing.
   */
  dismissSubscriptionId?: string
}

/** Days before expiry that a plan starts asking to be renewed. */
const EXPIRY_WINDOW_DAYS = 7

/** Days a job may sit with no applicants before it is worth telling the parent. */
const STALE_JOB_DAYS = 7

function daysUntil(iso: string | null): number | null {
  if (!iso) return null
  const ms = new Date(iso).getTime() - Date.now()
  if (Number.isNaN(ms)) return null
  return Math.ceil(ms / 86_400_000)
}

function expiryRow(
  ent: Entitlements,
  href: string,
): NeedRow | null {
  const left = daysUntil(ent.expiresAt)
  if (!ent.plan || left === null || left > EXPIRY_WINDOW_DAYS || left < 0) return null
  return {
    id: 'plan-expiring',
    // Worded as loss of visibility rather than as an invoice, per the
    // conversion rules: what lapses is what the member can see and be seen
    // doing, and that is the true consequence.
    title: left <= 1 ? 'Your plan ends today' : `Your plan ends in ${left} days`,
    why:
      ent.audience === 'tutor'
        ? 'When it ends your badges come off and you drop below Verified tutors in search. Nothing is deleted.'
        : 'When it ends you can no longer complete a hire or see tutor contact details. Your jobs stay open.',
    action: { label: 'Renew', href },
    tone: 'warn',
  }
}

/**
 * The row for a plan that has already ended.
 *
 * expiryRow() cannot produce this: getEntitlements() filters on
 * `expires_at > now()`, so the instant a plan lapses `ent.plan` is null and
 * there is nothing left in the entitlements to notice. The fact lives in the
 * subscription row, which is not deleted.
 *
 * Shown until the member reactivates or dismisses it. Losing a plan is the one
 * thing on this band the member did not do and may not have registered -- the
 * badges come off, the search position drops, and nothing on the dashboard
 * said so except a notification they may never have opened.
 */
async function lapsedPlanRow(
  userId: string,
  ent: Entitlements,
  href: string,
): Promise<NeedRow | null> {
  // A member who has a live plan is never told a plan ended — whether it is
  // ACTIVE (ent.plan) or PAUSED (ent.planPaused: paid, waiting on 100% to
  // start). ent is the computed authority; the raw subscriptions row read
  // below is denormalised and can still hold a stale expired/cancelled row from
  // a previous plan, which is exactly the case this guard rules out. Missing
  // the paused case is what showed "your plan ended" beside a live plan tile.
  if (ent.plan || ent.planPaused) return null

  const supabase = await createClient()
  const { data } = await supabase
    .from('subscriptions')
    .select('id, plan_code, expires_at, status, lapse_dismissed_at')
    .eq('user_id', userId)
    .in('status', ['expired', 'cancelled'])
    .is('lapse_dismissed_at', null)
    .order('expires_at', { ascending: false })
    .limit(1)
    .maybeSingle()

  if (!data) return null

  const plan = planLabel(data.plan_code as string) ?? 'Your'
  const days = daysUntil(data.expires_at as string | null)
  const ago = days === null ? null : Math.abs(days)

  return {
    id: 'plan-lapsed',
    title: `Your ${plan} plan has ended`,
    // The consequence, in what was lost rather than in what is owed. The
    // conversion rules are explicit that an expiry is worded as a loss of
    // visibility and never as an invoice.
    why:
      ent.audience === 'tutor'
        ? `Your badges are off and you now appear below Verified tutors in search${
            ago !== null ? `, since ${ago === 0 ? 'today' : `${ago} day${ago === 1 ? '' : 's'} ago`}` : ''
          }. Nothing has been deleted.`
        : `You can no longer complete a hire or see tutor contact details${
            ago !== null ? `, since ${ago === 0 ? 'today' : `${ago} day${ago === 1 ? '' : 's'} ago`}` : ''
          }. Your tuitions are still open.`,
    action: { label: 'Reactivate', href },
    tone: 'urgent',
    dismissSubscriptionId: data.id as string,
  }
}

/**
 * The parent's blocking work.
 *
 * `openJobIds` is passed in rather than re-queried: the dashboard has already
 * read the parent's jobs to count them, and a second identical read to decide
 * whether one of them is stale would double the page's cost for nothing.
 */
export async function parentNeeds({
  userId,
  ent,
  cnicVerified,
  addressVerified,
  verificationState,
}: {
  userId: string
  ent: Entitlements
  cnicVerified: boolean
  addressVerified: boolean
  verificationState: string | null
}): Promise<NeedRow[]> {
  const rows: NeedRow[] = []
  const supabase = await createClient()

  // Verification first. Until this clears a parent cannot post at all, so
  // every other row would be advice about a door that is still locked.
  if (!cnicVerified || !addressVerified) {
    rows.push(
      verificationState === 'submitted'
        ? {
            id: 'verify-pending',
            title: 'Your CNIC and address are being checked',
            why: 'You can post a job as soon as our team approves them. Nothing else is needed from you right now.',
            action: { label: 'Check status', href: '/parent/verify' },
            tone: 'warn',
          }
        : {
            id: 'verify',
            title:
              verificationState === 'rejected'
                ? 'Your verification was not accepted'
                : !cnicVerified && !addressVerified
                  ? 'Your CNIC and address are not verified'
                  : !cnicVerified
                    ? 'Your CNIC is not verified'
                    : 'Your address is not verified',
            why: 'Until both are approved you cannot post a job, message a tutor or request a demo.',
            action: { label: 'Verify now', href: '/parent/verify' },
            tone: 'urgent',
          },
    )
  }

  // Applicants waiting on a decision. A tutor who applied is waiting on this
  // parent specifically, which is the definition of this band.
  const { data: myJobs } = await supabase
    .from('jobs')
    .select('id, job_tx_id, title, status, created_at')
    .eq('parent_id', userId)
    .eq('status', 'open')

  const openJobs = myJobs ?? []
  if (openJobs.length > 0) {
    // Applications are readable by the job's parent, but counting them per job
    // and naming the job needs no extra privilege -- the service-role client is
    // used only because `applications` joins to profiles elsewhere. Here the
    // parent's own client is enough.
    const ids = openJobs.map((j) => j.id as string)
    const { data: apps } = await supabase
      .from('applications')
      .select('id, job_id')
      .in('job_id', ids)
      .eq('status', 'applied')
      .is('withdrawn_at', null)

    const waiting = apps ?? []
    if (waiting.length > 0) {
      const jobsWithApps = new Set(waiting.map((a) => a.job_id as string))
      // One job -> link straight to it. Several -> the list, because guessing
      // which one they meant would be wrong most of the time.
      const only =
        jobsWithApps.size === 1
          ? openJobs.find((j) => j.id === [...jobsWithApps][0])
          : null
      rows.push({
        id: 'applicants-waiting',
        title:
          waiting.length === 1
            ? 'One tutor is waiting for your decision'
            : `${waiting.length} tutors are waiting for your decision`,
        why: only
          ? `They applied to “${only.title as string}” and have not heard back.`
          : `They applied across ${jobsWithApps.size} of your tuitions and have not heard back.`,
        action: only
          ? {
              label: 'Review applicants',
              href: `/parent/dashboard/job/${(only.job_tx_id as string) ?? (only.id as string)}`,
            }
          : { label: 'Review applicants', href: '/parent/dashboard/jobs' },
        tone: 'urgent',
      })
    }

    // A job nobody has applied to after a week is not broken, but it is the
    // parent's to fix -- usually the budget, the area or the subject.
    const cutoff = Date.now() - STALE_JOB_DAYS * 86_400_000
    const withApps = new Set((waiting ?? []).map((a) => a.job_id as string))
    // A job with any application at all -- including shortlisted ones -- is
    // not stale, so this second read covers statuses the first one filtered out.
    const { data: anyApps } = await supabase
      .from('applications')
      .select('job_id')
      .in('job_id', ids)
      .is('withdrawn_at', null)
    for (const a of anyApps ?? []) withApps.add(a.job_id as string)

    const stale = openJobs.filter(
      (j) => new Date(j.created_at as string).getTime() < cutoff && !withApps.has(j.id as string),
    )
    if (stale.length > 0) {
      const j = stale[0]
      rows.push({
        id: 'stale-job',
        title:
          stale.length === 1
            ? 'A tuition has had no applicants for a week'
            : `${stale.length} tuitions have had no applicants for a week`,
        why: `“${j.title as string}” has been open ${STALE_JOB_DAYS}+ days with nobody applying. Widening the area or the budget usually fixes it.`,
        action: {
          label: 'Open the tuition',
          href: `/parent/dashboard/job/${(j.job_tx_id as string) ?? (j.id as string)}`,
        },
        tone: 'warn',
      })
    }
  }

  const expiring = expiryRow(ent, '/parent/packages')
  if (expiring) rows.push(expiring)

  const lapsed = await lapsedPlanRow(userId, ent, '/parent/packages?plan=parent_featured')
  if (lapsed) rows.push(lapsed)

  return rows
}

/** The tutor's blocking work. Completion is handled by the top-of-dashboard
 *  checklist now, not here — see the note at the removed completion row. */
export async function tutorNeeds({
  userId,
  ent,
  verificationStatus,
  videoStatus,
  videoAttempts,
  city,
  hasDegree,
}: {
  userId: string
  ent: Entitlements
  verificationStatus: string | null
  videoStatus: string | null
  videoAttempts: number
  /** The tutor's city, for the "N tuitions match nothing" prompt. */
  city: string | null
  /** Whether a degree is on file, for the Verified-badge prompt. */
  hasDegree: boolean
}): Promise<NeedRow[]> {
  const rows: NeedRow[] = []
  const supabase = await createClient()

  // Suspension outranks everything. A suspended tutor told to "complete your
  // profile" is being sent to fix a thing that is not broken -- the same
  // ordering mistake CLAUDE.md calls out for the entitlement checks.
  if (verificationStatus === 'suspended') {
    return [
      {
        id: 'suspended',
        title: 'Your profile is suspended',
        why: 'Parents cannot see or contact you while this stands. Support can tell you why and what to do next.',
        action: { label: 'Contact support', href: '/support' },
        tone: 'urgent',
      },
    ]
  }

  // Profile completion is NOT a Needs-you row any more (owner, 9 Sep). Status
  // and what-to-do-next moved to the TOP of the dashboard: the completion
  // checklist now renders directly under the header, so a second copy here would
  // be the duplication the band-order pass removed. Needs you keeps the OTHER
  // blocks below — a rejected video, a shortlist waiting, an expiring plan.

  if (videoStatus === 'rejected') {
    const used = videoAttempts ?? 0
    const left = Math.max(0, 3 - used)
    rows.push(
      left > 0
        ? {
            id: 'video-rejected',
            title: 'Your introduction video was not accepted',
            why: `You have ${left} of 3 attempt${left === 1 ? '' : 's'} left. A clear, well-lit clip introducing yourself and your subjects is what gets approved.`,
            action: { label: 'Record a new video', href: '/tutor/complete-profile?step=7' },
            tone: 'urgent',
          }
        : {
            id: 'video-locked',
            title: 'Your video uploads are locked',
            why: 'All 3 attempts have been used. Support can review the decision and reopen uploads.',
            action: { label: 'Contact support', href: '/support' },
            tone: 'urgent',
          },
    )
  }

  // Shortlisted, waiting on the parent. The tutor is not blocked in the strict
  // sense -- but this is the live opportunity most worth their attention, and
  // it is the one thing on the dashboard that can still be lost by silence.
  const { data: shortlisted } = await supabase
    .from('applications')
    .select('id, job_id')
    .eq('tutor_id', userId)
    .eq('status', 'shortlisted')
    .is('withdrawn_at', null)
    .limit(10)

  if ((shortlisted ?? []).length > 0) {
    const n = (shortlisted ?? []).length
    // The job title needs the service-role client: jobs are public to browse
    // but this reads one by id outside the browse view.
    let title: string | null = null
    let ref: string | null = null
    const admin = createAdminClient()
    if (admin && n === 1) {
      const { data: job } = await admin
        .from('jobs')
        .select('title, job_tx_id, id, public_slug, city, status')
        .eq('id', shortlisted![0].job_id as string)
        .maybeSingle()
      title = (job?.title as string) ?? null
      // The tuition's own page, while it is still open. A closed one answers
      // 410, so that case falls through to the applications list -- which is
      // where the shortlist itself is recorded anyway.
      ref =
        job && job.status === 'open' && job.public_slug
          ? tuitionPath({ public_slug: job.public_slug as string, city: job.city as string | null })
          : null
    }
    rows.push({
      id: 'shortlisted',
      title:
        n === 1 ? 'You have been shortlisted' : `You have been shortlisted for ${n} tuitions`,
      why: title
        ? `“${title}” has you on its shortlist. The parent decides next — a message now is what usually turns a shortlist into a hire.`
        : 'The parent decides next. A message now is what usually turns a shortlist into a hire.',
      action:
        ref !== null
          ? { label: 'See the tuition', href: ref }
          : { label: 'See your applications', href: '/tutor/dashboard/applications' },
      tone: 'warn',
    })
  }

  const expiring = expiryRow(ent, '/tutor/packages')
  if (expiring) rows.push(expiring)

  const lapsed = await lapsedPlanRow(userId, ent, '/tutor/packages?plan=verified')
  if (lapsed) rows.push(lapsed)

  // Quantified, NON-BLOCKING prompts (owner rule 5, 10 Sep 2026). These replace
  // the old blocking "finish your profile first" modal on Apply: applying now
  // proceeds, and instead the dashboard states the real cost of an unfinished
  // profile using data we already have. Each shows only when its number is real
  // — a zero count shows nothing, and no number is invented.
  const pct = ent.profileCompletion ?? 0

  // No subjects → invisible to every subject search. The count is the open
  // tuitions in their city that match nothing on their profile.
  const { data: subjRows } = await supabase
    .from('tutor_subjects')
    .select('master_id')
    .eq('tutor_id', userId)
    .limit(1)
  if ((subjRows ?? []).length === 0) {
    const n = await cityJobsMatchingNothing(userId, city)
    if (n > 0) {
      rows.push({
        id: 'no-subjects',
        title: `${n} ${city} tuition${n === 1 ? '' : 's'} match nothing on your profile`,
        why: 'You have no subjects on your profile, so parents searching for a subject cannot find you. Adding them is what puts you in those results.',
        action: { label: 'Add your subjects', href: '/tutor/complete-profile?step=4' },
        tone: 'warn',
      })
    }
  }

  // Listed but under 100% → searchable on-site, held out of Google until 100%.
  // Only for a LISTED tutor: the claim "you are searchable, just not on Google"
  // is only true once they are actually listed.
  if (ent.listed && pct < 100) {
    rows.push({
      id: 'not-on-google',
      title: 'Your profile is not on Google yet',
      why: 'You are listed and parents can find you on TutorMint now. Your profile appears in Google search once it reaches 100%.',
      action: { label: 'Finish your profile', href: '/tutor/complete-profile' },
      tone: 'warn',
    })
  }

  // A paid tutor without a reviewed degree: listed and applying, but no Verified
  // badge until a degree is checked (owner rule 2). Only worth saying to someone
  // who holds a plan — the badge is what their plan is meant to earn them.
  if (!hasDegree && (ent.plan || ent.planPaused)) {
    rows.push({
      id: 'no-degree',
      title: 'Add a degree to earn your Verified badge',
      why: 'Your Verified badge appears once a degree certificate has been reviewed. You are listed and applying without it, but the badge is what parents look for.',
      action: { label: 'Add your degree', href: '/tutor/complete-profile?step=5' },
      tone: 'warn',
    })
  }

  return rows
}
