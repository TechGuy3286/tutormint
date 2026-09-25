// lib/matchEmail.ts
//
// Matched-tuition emails for Premium and Featured tutors (PR54 Part C).
//
// The in-app match notification goes to every matched listed tutor (that is
// notifyMatchingTutors, unchanged). ON TOP of that, a tutor on Premium or
// Featured, with a verified real email, who has not unsubscribed, gets one
// email per tuition — never twice for the same tuition.
//
// EVERYTHING HERE IS BEST-EFFORT. Any error — a missing column or table before
// the migration lands, a send failure, an unreadable account — skips that one
// email and never throws, so it cannot block posting a tuition or the in-app
// notification. Before the migration this simply sends nothing.

import crypto from 'node:crypto'
import { createAdminClient } from '@/lib/supabase/admin'
import { deliverEmail } from '@/lib/notify'
import { absoluteUrl } from '@/lib/siteUrl'

export type MatchEmailJob = {
  jobId: string
  /** Subject label, which already carries the grade/level (e.g. "Grade 8 General Science"). */
  subject: string
  city: string
  area: string | null
  mode: string | null
  /** The tuition's own public page. */
  href: string
}

const secret = () => process.env.SUPABASE_SERVICE_ROLE_KEY ?? ''

/** A one-click unsubscribe signature for a tutor — HMAC over their id, so the
 *  link cannot be forged for another account. */
export function matchUnsubSig(userId: string): string {
  return crypto.createHmac('sha256', secret()).update(`match-email:${userId}`).digest('hex').slice(0, 32)
}

export function verifyMatchUnsub(userId: string, sig: string): boolean {
  if (!userId || !sig) return false
  const expected = matchUnsubSig(userId)
  if (sig.length !== expected.length) return false
  try {
    return crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected))
  } catch {
    return false
  }
}

function unsubscribeHref(userId: string): string {
  return absoluteUrl(`/api/email/match-unsubscribe?u=${userId}&sig=${matchUnsubSig(userId)}`)
}

/**
 * Email the tuition to the Premium/Featured tutors among `tutorIds`. Called
 * from notifyMatchingTutors after the in-app fan-out; wrapped so it can never
 * fail a job post.
 */
export async function sendMatchEmails(job: MatchEmailJob, tutorIds: string[]): Promise<void> {
  const admin = createAdminClient()
  if (!admin || tutorIds.length === 0) return
  try {
    // Eligible = an active, unexpired Premium or Featured subscription.
    const { data: subs, error } = await admin
      .from('subscriptions')
      .select('user_id')
      .in('user_id', tutorIds)
      .eq('status', 'active')
      .gt('expires_at', new Date().toISOString())
      .in('plan_code', ['premium', 'featured'])
    if (error) return
    const eligible = [...new Set((subs ?? []).map((s) => s.user_id as string))]
    for (const tutorId of eligible) {
      try {
        await sendOne(admin, job, tutorId)
      } catch {
        /* one tutor's email must never stop the others */
      }
    }
  } catch {
    /* fail open — never block posting over a match email */
  }
}

async function sendOne(
  admin: NonNullable<ReturnType<typeof createAdminClient>>,
  job: MatchEmailJob,
  tutorId: string,
): Promise<void> {
  // Opt-out (global or match-specific) and a real address. The match_email_opt_out
  // column may not exist yet — the select then errors and we skip (no email
  // until the migration).
  const { data: prof, error } = await admin
    .from('profiles')
    .select('email, email_opt_out, match_email_opt_out')
    .eq('id', tutorId)
    .maybeSingle()
  if (error || !prof) return
  const email = prof.email as string | null
  if (!email || email.endsWith('@users.tutormint.org')) return // no real mailbox
  if (prof.email_opt_out || prof.match_email_opt_out) return

  // Verified email only — the address must be confirmed on the account.
  const { data: authUser } = await admin.auth.admin.getUserById(tutorId)
  if (!authUser?.user?.email_confirmed_at) return

  // Never twice for the same tuition. Record first (at-most-once): a send that
  // then fails is a lost courtesy email, which is far better than a duplicate.
  // If the table is missing (pre-migration) the upsert errors and we skip.
  const { data: inserted, error: dupErr } = await admin
    .from('match_email_sent')
    .upsert({ tutor_id: tutorId, job_id: job.jobId }, { onConflict: 'tutor_id,job_id', ignoreDuplicates: true })
    .select('tutor_id')
  if (dupErr) return
  if (!inserted || inserted.length === 0) return // already sent this tuition

  await deliverEmail(
    { userId: tutorId },
    {
      id: 'tuition_match',
      subject: job.subject,
      city: job.city,
      area: job.area,
      mode: job.mode,
      href: job.href,
      unsubscribeHref: unsubscribeHref(tutorId),
    },
  )
}
