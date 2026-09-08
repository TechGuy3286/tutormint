import 'server-only'

import { createAdminClient } from '@/lib/supabase/admin'
import { notify } from '@/lib/notifications'
import { crossesReviewThreshold } from '@/lib/underReviewCore'

export { crossesReviewThreshold }

// "Under review" (owner, Sunday 6 Sep; view behaviour confirmed Part 5, 8 Sep).
// A reported job or tutor profile is paused while an open report is checked: an
// amber sticker on the card and the detail, applications on a job disabled with
// "This job is under review", and a tutor profile DELISTED from search.
//
// UNDER REVIEW DELISTS, IT DOES NOT UNPUBLISH. Only `tutor_directory` (browse,
// rank_tutors(), search, the sitemap) excludes an under-review tutor;
// `tutor_visible_profiles` — the view tutor_public_page() reads — does NOT, so
// the public profile URL STILL RENDERS, with a plain amber notice in place of
// the contact and apply affordances. A single report from one verified member
// must not be able to 404 the SEO asset a tutor pays 199/mo for. (Banned and
// suspended accounts ARE out of both views — a branded 404.)
//
// It is a boolean on jobs/tutor_profiles, not a status value, so nothing about
// the object's real state (open/closed, verified) is lost.
//
// AUTO-TRIGGER: one report from a VERIFIED member, or two from anyone. Cheap to
// evaluate (a count and one lookup) and run every time a report is filed.
//
// Resolution clears it: a dismiss reopens the item and tells the owner; an
// uphold (warn/suspend/ban) also clears the flag because the review is over —
// the sanction is what carries the consequence from there.

type Admin = NonNullable<ReturnType<typeof createAdminClient>>

async function reporterIsVerified(admin: Admin, reporterId: string | null): Promise<boolean> {
  if (!reporterId) return false
  const { data: p } = await admin
    .from('profiles')
    .select('role, cnic_verified_at, address_verified_at')
    .eq('id', reporterId)
    .maybeSingle()
  if (!p) return false
  // A verified parent has CNIC + address approved.
  if (p.cnic_verified_at && p.address_verified_at) return true
  // A verified tutor is verified in the moderation sense.
  if (p.role === 'tutor') {
    const { data: t } = await admin
      .from('tutor_profiles')
      .select('verification_status')
      .eq('id', reporterId)
      .maybeSingle()
    if (t?.verification_status === 'verified') return true
  }
  return false
}

/**
 * Evaluate the trigger for the target of a freshly-filed report and flip it to
 * under review if it qualifies. Best-effort: a failure here must not fail the
 * report itself.
 */
export async function evaluateUnderReview(report: {
  targetType: string
  targetId: string | null
  reportedId: string | null
  reporterId: string | null
}): Promise<void> {
  const admin = createAdminClient()
  if (!admin) return

  try {
    if (report.targetType === 'job' && report.targetId) {
      const { data: rows, count } = await admin
        .from('reports')
        .select('reporter_id', { count: 'exact' })
        .eq('target_type', 'job')
        .eq('target_id', report.targetId)
        .eq('status', 'open')

      const anyVerified = await hasVerifiedReporter(admin, rows ?? [])
      if (!crossesReviewThreshold({ hasVerifiedReporter: anyVerified, openReportCount: count ?? 0 })) return

      const { data: job } = await admin
        .from('jobs')
        .select('id, parent_id, title, under_review')
        .eq('id', report.targetId)
        .maybeSingle()
      if (!job || job.under_review) return

      await admin
        .from('jobs')
        .update({ under_review: true, review_reason: 'Reported and under review' })
        .eq('id', job.id)

      if (job.parent_id) {
        await notify({
          userId: job.parent_id as string,
          kind: 'under_review',
          title: 'Your tuition is under review',
          body: `"${job.title as string}" is paused while our team checks a report. Applications are paused until it is resolved.`,
          href: `/parent/dashboard/job/${job.id}`,
        })
      }
      return
    }

    if (report.targetType === 'profile' && report.reportedId) {
      const { data: rows, count } = await admin
        .from('reports')
        .select('reporter_id', { count: 'exact' })
        .eq('target_type', 'profile')
        .eq('reported_id', report.reportedId)
        .eq('status', 'open')

      const anyVerified = await hasVerifiedReporter(admin, rows ?? [])
      if (!crossesReviewThreshold({ hasVerifiedReporter: anyVerified, openReportCount: count ?? 0 })) return

      const { data: tutor } = await admin
        .from('tutor_profiles')
        .select('id, under_review')
        .eq('id', report.reportedId)
        .maybeSingle()
      if (!tutor || tutor.under_review) return

      await admin
        .from('tutor_profiles')
        .update({ under_review: true, review_reason: 'Reported and under review' })
        .eq('id', tutor.id)

      await notify({
        userId: report.reportedId,
        kind: 'under_review',
        title: 'Your profile is under review',
        body: 'Your profile is temporarily hidden from search while our team checks a report. We will let you know as soon as it is resolved.',
        href: '/tutor/dashboard',
      })
    }
  } catch {
    // Never fail a report over the review flip.
  }
}

async function hasVerifiedReporter(
  admin: Admin,
  rows: { reporter_id: string | null }[],
): Promise<boolean> {
  const ids = Array.from(new Set(rows.map((r) => r.reporter_id).filter(Boolean) as string[]))
  for (const id of ids) {
    if (await reporterIsVerified(admin, id)) return true
  }
  return false
}

/**
 * Clear the review flag on a report's target when the report is resolved.
 * `cleared` = the report was dismissed (reopen + tell the owner it is live
 * again); otherwise the sanction handles it and the owner is not separately
 * pinged here.
 */
export async function clearUnderReview(
  report: { targetType: string; targetId: string | null; reportedId: string | null },
  cleared: boolean,
): Promise<void> {
  const admin = createAdminClient()
  if (!admin) return

  try {
    if (report.targetType === 'job' && report.targetId) {
      const { data: job } = await admin
        .from('jobs')
        .select('id, parent_id, title, under_review')
        .eq('id', report.targetId)
        .maybeSingle()
      if (!job?.under_review) return

      await admin.from('jobs').update({ under_review: false, review_reason: null }).eq('id', job.id)

      if (cleared && job.parent_id) {
        await notify({
          userId: job.parent_id as string,
          kind: 'under_review_cleared',
          title: 'Your tuition is live again',
          body: `We reviewed the report on "${job.title as string}" and cleared it. Tutors can apply again.`,
          href: `/parent/dashboard/job/${job.id}`,
        })
      }
      return
    }

    if (report.targetType === 'profile' && report.reportedId) {
      const { data: tutor } = await admin
        .from('tutor_profiles')
        .select('id, under_review')
        .eq('id', report.reportedId)
        .maybeSingle()
      if (!tutor?.under_review) return

      await admin
        .from('tutor_profiles')
        .update({ under_review: false, review_reason: null })
        .eq('id', tutor.id)

      if (cleared) {
        await notify({
          userId: report.reportedId,
          kind: 'under_review_cleared',
          title: 'Your profile is live again',
          body: 'We reviewed the report and cleared it. Your profile is back in search.',
          href: '/tutor/dashboard',
        })
      }
    }
  } catch {
    // Best-effort.
  }
}
