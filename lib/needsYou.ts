import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import type { Entitlements } from '@/lib/entitlements'

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

export type NeedRow = {
  id: string
  title: string
  /** The consequence, stated plainly. Never a restatement of the title. */
  why: string
  action: { label: string; href: string }
  /** 'urgent' is a real block; 'warn' is a deadline approaching. */
  tone: 'urgent' | 'warn'
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

  return rows
}

/** The tutor's blocking work. */
export async function tutorNeeds({
  userId,
  ent,
  completionPercent,
  verificationStatus,
  videoStatus,
  videoAttempts,
}: {
  userId: string
  ent: Entitlements
  completionPercent: number
  verificationStatus: string | null
  videoStatus: string | null
  videoAttempts: number
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

  if (completionPercent < 100) {
    rows.push({
      id: 'completion',
      title: `Your profile is ${completionPercent}% complete`,
      why: 'Tutors are only listed in search at 100%. Until then parents cannot find you, whatever your plan.',
      action: { label: 'Finish your profile', href: '/tutor/complete-profile' },
      tone: 'urgent',
    })
  }

  if (videoStatus === 'rejected') {
    const used = videoAttempts ?? 0
    const left = Math.max(0, 3 - used)
    rows.push(
      left > 0
        ? {
            id: 'video-rejected',
            title: 'Your introduction video was not accepted',
            why: `You have ${left} of 3 attempt${left === 1 ? '' : 's'} left. A clear, well-lit clip introducing yourself and your subjects is what gets approved.`,
            action: { label: 'Record a new video', href: '/tutor/upload-youtube' },
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
        .select('title, job_tx_id, id')
        .eq('id', shortlisted![0].job_id as string)
        .maybeSingle()
      title = (job?.title as string) ?? null
      ref = ((job?.job_tx_id as string) ?? (job?.id as string)) ?? null
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
          ? { label: 'See the tuition', href: `/browse/tuitions?job=${ref}` }
          : { label: 'See your applications', href: '/tutor/dashboard/applications' },
      tone: 'warn',
    })
  }

  const expiring = expiryRow(ent, '/tutor/packages')
  if (expiring) rows.push(expiring)

  return rows
}
