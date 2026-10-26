import 'server-only'

// lib/reviews.ts — parent reviews, server half (owner, 27 Oct 2026; rules
// lib/reviewsCore).
//
// A parent reviews a tutor they hired (an application at stage Hired on a
// tuition they posted), once per hire. The review is saved PENDING through the
// parent's own session, so the database's insert policy (can_review_hire,
// migration 204) refuses an unearned one even if this module is bypassed. The
// site Owner approves or rejects it; only approved reviews are public and count
// in the tutor's rating (a database trigger keeps rating_avg / rating_count).

import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { logActivity } from '@/lib/activityLog'
import { logAdminAction } from '@/lib/auditLog'
import { notify } from '@/lib/notifications'
import { formatName } from '@/lib/formatName'
import type { AdminRole } from '@/lib/adminAccessCore'
import { parseReviewStatus, reviewEligibility, reviewInputProblem, REVIEW_ALREADY, type HireFacts, type ReviewStatus } from '@/lib/reviewsCore'

type Fail = { ok: false; status: number; error: string }

async function hireFacts(applicationId: string): Promise<HireFacts | null> {
  const admin = createAdminClient()
  if (!admin) return null
  const { data } = await admin.from('applications').select('id, stage, status, tutor_id, job_id, jobs(parent_id)').eq('id', applicationId).maybeSingle()
  if (!data) return null
  const job = (Array.isArray(data.jobs) ? data.jobs[0] : data.jobs) as { parent_id?: string | null } | null
  return { stage: (data.stage as string | null) ?? null, status: (data.status as string | null) ?? null, tutorId: data.tutor_id as string, jobParentId: job?.parent_id ?? null }
}

export async function createReview(input: { parentId: string; applicationId: string; rating: number; comment: string }): Promise<{ ok: true; id: string } | Fail> {
  const problem = reviewInputProblem(input.rating, input.comment)
  if (problem) return { ok: false, status: 400, error: problem }
  const admin = createAdminClient()
  if (!admin) return { ok: false, status: 503, error: 'This is not working right now.' }
  const hire = await hireFacts(input.applicationId)
  const { count } = await admin.from('reviews').select('id', { count: 'exact', head: true }).eq('application_id', input.applicationId)
  const ok = reviewEligibility(input.parentId, hire, (count ?? 0) > 0)
  if (!ok.ok) return ok
  const tutorId = hire!.tutorId
  const rating = Math.round(Number(input.rating))
  const comment = input.comment.trim()

  // Through the parent's own session: the insert policy checks the hire too.
  const supabase = await createClient()
  const { data: created, error } = await supabase
    .from('reviews')
    .insert({
      parent_id: input.parentId,
      tutor_id: tutorId,
      application_id: input.applicationId,
      rating,
      comment,
      status: 'pending',
      // Legacy NOT NULL columns.
      reviewer_type: 'parent',
      target_id: tutorId,
      rating_primary: rating,
    })
    .select('id')
    .single()
  if (error || !created) {
    if (error?.code === '23505') return { ok: false, status: 409, error: REVIEW_ALREADY }
    return { ok: false, status: 403, error: 'Your review could not be saved. Please try again.' }
  }
  await logActivity({
    userId: input.parentId,
    event: 'review_submitted',
    targetType: 'review',
    targetId: created.id as string,
    meta: { tutorId, rating },
  })
  return { ok: true, id: created.id as string }
}

export type ReviewableHire = {
  applicationId: string
  tutorId: string
  tutorName: string
  tutorSlug: string | null
  tuitionTitle: string
  hiredAt: string | null
  review: { id: string; rating: number; status: ReviewStatus; createdAt: string } | null
}

/** Every hire on this parent's tuitions, with the review left for it (if any). */
export async function reviewableHires(parentId: string): Promise<ReviewableHire[]> {
  const admin = createAdminClient()
  if (!admin) return []
  const { data: jobs } = await admin.from('jobs').select('id, title').eq('parent_id', parentId)
  const jobIds = (jobs ?? []).map((j) => j.id as string)
  if (!jobIds.length) return []
  const title = new Map((jobs ?? []).map((j) => [j.id as string, ((j.title as string | null) ?? 'Tuition').trim()]))
  const { data: apps } = await admin
    .from('applications')
    .select('id, job_id, tutor_id, stage, status, stage_changed_at')
    .in('job_id', jobIds.slice(0, 500))
    .eq('stage', 'hired')
  const hires = (apps ?? []).filter((a) => a.status !== 'withdrawn' && a.tutor_id !== parentId)
  if (!hires.length) return []
  const tutorIds = [...new Set(hires.map((a) => a.tutor_id as string))]
  const [{ data: tutors }, { data: slugs }, { data: reviews }] = await Promise.all([
    admin.from('profiles').select('id, full_name').in('id', tutorIds),
    admin.from('tutor_profiles').select('id, slug').in('id', tutorIds),
    admin.from('reviews').select('id, application_id, rating, status, created_at').in('application_id', hires.map((a) => a.id as string)),
  ])
  const name = new Map((tutors ?? []).map((t) => [t.id as string, formatName(t.full_name as string | null) || 'Your tutor']))
  const slug = new Map((slugs ?? []).map((t) => [t.id as string, (t.slug as string | null) ?? null]))
  const byApp = new Map((reviews ?? []).map((r) => [r.application_id as string, r]))
  return hires
    .map((a) => {
      const r = byApp.get(a.id as string)
      return {
        applicationId: a.id as string,
        tutorId: a.tutor_id as string,
        tutorName: name.get(a.tutor_id as string) ?? 'Your tutor',
        tutorSlug: slug.get(a.tutor_id as string) ?? null,
        tuitionTitle: title.get(a.job_id as string) ?? 'Tuition',
        hiredAt: (a.stage_changed_at as string | null) ?? null,
        review: r ? { id: r.id as string, rating: Number(r.rating), status: parseReviewStatus(r.status as string), createdAt: r.created_at as string } : null,
      }
    })
    .sort((x, y) => String(y.hiredAt).localeCompare(String(x.hiredAt)))
}

export type QueueReview = {
  id: string
  status: ReviewStatus
  rating: number
  comment: string
  createdAt: string
  decidedAt: string | null
  decidedByName: string | null
  reason: string | null
  parentId: string | null
  parentName: string
  tutorId: string | null
  tutorName: string
  tutorSlug: string | null
  tuitionTitle: string | null
}

/** Trust → Reviews: one status at a time, newest first (pending oldest first). */
export async function loadReviewQueue(status: ReviewStatus): Promise<{ rows: QueueReview[]; counts: Record<ReviewStatus, number> }> {
  const admin = createAdminClient()
  const empty = { rows: [], counts: { pending: 0, approved: 0, rejected: 0 } }
  if (!admin) return empty
  const [{ data }, ...counts] = await Promise.all([
    admin
      .from('reviews')
      .select('id, status, rating, comment, created_at, decided_at, decided_by, decision_reason, parent_id, tutor_id, application_id')
      .eq('status', status)
      .order('created_at', { ascending: status === 'pending' })
      .limit(200),
    ...(['pending', 'approved', 'rejected'] as const).map((s) => admin.from('reviews').select('id', { count: 'exact', head: true }).eq('status', s)),
  ])
  const rows = data ?? []
  const people = [...new Set(rows.flatMap((r) => [r.parent_id, r.tutor_id, r.decided_by]).filter(Boolean) as string[])]
  const appIds = rows.map((r) => r.application_id as string | null).filter(Boolean) as string[]
  const [{ data: ps }, { data: slugs }, { data: apps }] = await Promise.all([
    people.length ? admin.from('profiles').select('id, full_name').in('id', people) : Promise.resolve({ data: [] as { id: string; full_name: string | null }[] }),
    people.length ? admin.from('tutor_profiles').select('id, slug').in('id', people) : Promise.resolve({ data: [] as { id: string; slug: string | null }[] }),
    appIds.length ? admin.from('applications').select('id, jobs(title)').in('id', appIds) : Promise.resolve({ data: [] as { id: string; jobs: unknown }[] }),
  ])
  const nm = new Map((ps ?? []).map((p) => [p.id as string, formatName(p.full_name as string | null)]))
  const sl = new Map((slugs ?? []).map((t) => [t.id as string, (t.slug as string | null) ?? null]))
  const tt = new Map(
    (apps ?? []).map((a) => {
      const j = (Array.isArray(a.jobs) ? a.jobs[0] : a.jobs) as { title?: string | null } | null
      return [a.id as string, (j?.title ?? null) as string | null]
    }),
  )
  return {
    rows: rows.map((r) => ({
      id: r.id as string,
      status: parseReviewStatus(r.status as string),
      rating: Number(r.rating),
      comment: (r.comment as string | null) ?? '',
      createdAt: r.created_at as string,
      decidedAt: (r.decided_at as string | null) ?? null,
      decidedByName: r.decided_by ? (nm.get(r.decided_by as string) ?? null) : null,
      reason: (r.decision_reason as string | null) ?? null,
      parentId: (r.parent_id as string | null) ?? null,
      parentName: (r.parent_id && nm.get(r.parent_id as string)) || 'A parent',
      tutorId: (r.tutor_id as string | null) ?? null,
      tutorName: (r.tutor_id && nm.get(r.tutor_id as string)) || 'A tutor',
      tutorSlug: r.tutor_id ? (sl.get(r.tutor_id as string) ?? null) : null,
      tuitionTitle: r.application_id ? (tt.get(r.application_id as string) ?? null) : null,
    })),
    counts: { pending: counts[0].count ?? 0, approved: counts[1].count ?? 0, rejected: counts[2].count ?? 0 },
  }
}

/** The Owner's decision (the route checks it is the Owner). A review is decided
 *  once: only a pending one changes. */
export async function decideReview(
  actor: { id: string; adminRole: AdminRole; email: string | null },
  reviewId: string,
  decision: 'approve' | 'reject',
  reason: string | null,
): Promise<{ ok: true } | Fail> {
  const admin = createAdminClient()
  if (!admin) return { ok: false, status: 503, error: 'This is not working right now.' }
  const status = decision === 'approve' ? 'approved' : 'rejected'
  const { data, error } = await admin
    .from('reviews')
    .update({ status, decided_by: actor.id, decided_at: new Date().toISOString(), decision_reason: reason?.trim() || null })
    .eq('id', reviewId)
    .eq('status', 'pending')
    .select('id, parent_id, tutor_id, rating')
    .maybeSingle()
  if (error) return { ok: false, status: 500, error: 'That did not save. Please try again.' }
  if (!data) return { ok: false, status: 409, error: 'This review has already been decided.' }
  const tutorId = data.tutor_id as string
  const parentId = data.parent_id as string | null
  await logAdminAction({
    actorId: actor.id,
    actorRole: actor.adminRole,
    actorEmail: actor.email,
    action: decision === 'approve' ? 'review.approve' : 'review.reject',
    targetType: 'profile',
    targetId: tutorId,
    detail: { reviewId, parentId, rating: data.rating, reason: reason?.trim() || null },
  })
  if (decision === 'approve') {
    await logActivity({ userId: tutorId, event: 'review_approved', targetType: 'review', targetId: reviewId, meta: { rating: data.rating } })
    await notify({ userId: tutorId, kind: 'review_decided', title: 'A parent’s review is now on your profile', body: `${data.rating} out of 5`, href: '/tutor/dashboard' }).catch(() => {})
  }
  if (parentId) {
    await logActivity({ userId: parentId, event: decision === 'approve' ? 'review_approved' : 'review_rejected', targetType: 'review', targetId: reviewId, meta: {} })
    await notify({
      userId: parentId,
      kind: 'review_decided',
      title: decision === 'approve' ? 'Your review is now on the tutor’s profile' : 'Your review was not published',
      body: decision === 'approve' ? 'Thank you for helping other parents.' : 'Our team could not publish it. You can message us if you have a question.',
      href: '/review',
    }).catch(() => {})
  }
  return { ok: true }
}
