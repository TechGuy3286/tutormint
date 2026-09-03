// lib/reviews.ts
//
// Reviews are earned, not asserted.
//
// The rule: a parent may review a tutor only after a completed engagement --
// a job they hired that tutor for, or a demo between the two that reached
// status='completed'. One review per parent-tutor-job, and one per
// parent-tutor-demo. Tutors do not review parents.
//
// Enforced in two places on purpose. can_review_tutor() backs the RLS policy,
// so the database refuses an unearned review even if this module is bypassed;
// the check here exists so the member gets a sentence instead of a policy
// violation. If they ever disagree, the database wins.
//
// The rating rollup is a database TRIGGER, not something this file does. A
// rating maintained by whichever code path happens to write a review is a
// rating that drifts, and rating_avg is a ranking input -- it decides who a
// parent sees first.

import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { logActivity } from '@/lib/activityLog'
import { notify } from '@/lib/notifications'

type Fail = { ok: false; status: number; error: string }

export type ReviewInput = {
  parentId: string
  tutorId: string
  /** Exactly one of these. */
  jobId?: string | null
  demoRequestId?: string | null
  rating: number
  comment: string
}

export async function createReview(
  input: ReviewInput,
): Promise<{ ok: true; id: string } | Fail> {
  const jobId = input.jobId ?? null
  const demoId = input.demoRequestId ?? null

  if (!!jobId === !!demoId) {
    return {
      ok: false,
      status: 400,
      error: 'A review must be attached to either a hired job or a completed demo.',
    }
  }
  if (input.parentId === input.tutorId) {
    return { ok: false, status: 400, error: 'You cannot review yourself.' }
  }

  const rating = Number(input.rating)
  if (!Number.isInteger(rating) || rating < 1 || rating > 5) {
    return { ok: false, status: 400, error: 'Give a rating from 1 to 5.' }
  }
  const comment = (input.comment ?? '').trim()
  if (comment.length < 10) {
    return {
      ok: false,
      status: 400,
      error: 'Write at least a sentence — a rating with no words helps nobody.',
    }
  }

  const supabase = await createClient()

  // The same function the RLS policy uses, so the answer cannot differ.
  const { data: eligible } = await supabase.rpc('can_review_tutor', {
    p_parent: input.parentId,
    p_tutor: input.tutorId,
    p_job: jobId,
    p_demo: demoId,
  })

  if (!eligible) {
    return {
      ok: false,
      status: 403,
      error:
        'You can review a tutor after you have hired them for a job, or after a demo class with them is completed.',
    }
  }

  const { data: created, error } = await supabase
    .from('reviews')
    .insert({
      parent_id: input.parentId,
      tutor_id: input.tutorId,
      job_id: jobId,
      demo_request_id: demoId,
      rating,
      comment,
      // Legacy NOT NULL columns, mirrored until T8 removes them.
      reviewer_type: 'parent',
      target_id: input.tutorId,
      rating_primary: rating,
    })
    .select('id')
    .single()

  if (error) {
    // 23505 is the unique index doing its job: one review per engagement.
    if (error.code === '23505') {
      return { ok: false, status: 409, error: 'You have already reviewed this tutor for this.' }
    }
    return { ok: false, status: 400, error: error.message }
  }

  await notify({
    userId: input.tutorId,
    kind: 'demo_feedback',
    title: 'You received a review',
    body: `${rating} out of 5`,
    href: '/tutor/dashboard/demos',
  })

  await logActivity({
    userId: input.parentId,
    event: 'demo_completed',
    targetType: 'review',
    targetId: created.id as string,
    meta: { tutorId: input.tutorId, rating, jobId, demoId },
  })

  return { ok: true, id: created.id as string }
}

/**
 * Which engagements a parent could still review.
 *
 * Used to decide whether to offer the action at all, so the button is not
 * shown for something the route would refuse. Read through the service-role
 * client because it spans jobs, demos and reviews at once.
 */
export async function reviewableEngagements(parentId: string): Promise<{
  jobIds: Set<string>
  demoIds: Set<string>
  reviewedJobIds: Set<string>
  reviewedDemoIds: Set<string>
}> {
  const empty = {
    jobIds: new Set<string>(),
    demoIds: new Set<string>(),
    reviewedJobIds: new Set<string>(),
    reviewedDemoIds: new Set<string>(),
  }

  const admin = createAdminClient()
  if (!admin) return empty

  const [{ data: jobs }, { data: demos }, { data: reviews }] = await Promise.all([
    admin.from('jobs').select('id').eq('parent_id', parentId).eq('status', 'hired'),
    admin.from('demo_requests').select('id').eq('parent_id', parentId).eq('status', 'completed'),
    admin.from('reviews').select('job_id, demo_request_id').eq('parent_id', parentId),
  ])

  return {
    jobIds: new Set((jobs ?? []).map((j) => j.id as string)),
    demoIds: new Set((demos ?? []).map((d) => d.id as string)),
    reviewedJobIds: new Set(
      (reviews ?? []).map((r) => r.job_id as string | null).filter(Boolean) as string[],
    ),
    reviewedDemoIds: new Set(
      (reviews ?? []).map((r) => r.demo_request_id as string | null).filter(Boolean) as string[],
    ),
  }
}
