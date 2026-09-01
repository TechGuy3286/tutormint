// lib/activityLog.ts
//
// The member activity timeline (CLAUDE.md calls the table user_activity_log
// and the helper lib/activity.ts; this file is the helper, named per the task
// brief).
//
// Written from server code paths only, through the service-role client. The
// table has a SELECT policy only, so entries cannot be edited or removed by
// anything holding the anon key.
//
// PRIVACY: message events record a thread id and nothing else. Message bodies
// never enter this table. Admin access to content exists only through the
// reports queue when a participant reports a thread.

import { createAdminClient } from '@/lib/supabase/admin'

export type ActivityEvent =
  | 'registered'
  | 'login'
  | 'otp_verified'
  | 'profile_updated'
  | 'completion_changed'
  | 'subjects_changed'
  | 'document_uploaded'
  | 'video_submitted'
  | 'verification_submitted'
  | 'verification_decision_received'
  | 'job_posted'
  | 'job_edited'
  | 'job_closed'
  | 'application_submitted'
  | 'application_withdrawn'
  | 'demo_requested'
  | 'demo_accepted'
  | 'demo_declined'
  | 'demo_completed'
  | 'message_sent'
  | 'shortlist_added'
  | 'shortlist_removed'
  // T4 growth instrumentation. Both are written to the VIEWER's own timeline
  // and never carry personal data about anyone else: profile_viewed records
  // which tutor was opened, search_performed records the filters used and how
  // many results came back -- never the free-text query.
  | 'profile_viewed'
  | 'search_performed'
  // Block and report, given and received. CLAUDE.md's timeline spec asks
  // for both sides: the admin timeline in T7 has to be able to explain why
  // two members suddenly stopped being able to reach each other.
  | 'blocked'
  | 'blocked_by'
  | 'unblocked'
  | 'reported'
  | 'reported_by'
  | 'payment_submitted'
  | 'payment_rejected'
  | 'plan_purchased'
  | 'plan_expiring'
  | 'plan_granted'
  | 'plan_revoked'
  | 'plan_expired'
  | 'suspended'
  | 'unsuspended'
  // T7a — moderation outcomes and staff lifecycle.
  | 'warned'
  | 'report_resolved'
  | 'staff_created'
  | 'staff_role_changed'
  | 'staff_suspended'
  | 'staff_reactivated'
  | 'video_visibility_changed'
  // T7b — imported accounts and the claim flow.
  | 'imported'
  | 'password_changed'
  | 'terms_accepted'
  | 'profile_claimed'

export async function logActivity(params: {
  userId: string
  event: ActivityEvent
  targetType?: string
  targetId?: string
  meta?: Record<string, unknown>
}): Promise<void> {
  const admin = createAdminClient()
  if (!admin) {
    console.error('[activity] service-role client unavailable; event NOT recorded', params.event)
    return
  }

  const { error } = await admin.from('user_activity_log').insert({
    user_id: params.userId,
    event: params.event,
    target_type: params.targetType ?? null,
    target_id: params.targetId ?? null,
    meta: params.meta ?? {},
  })

  if (error) console.error('[activity] failed to record', params.event, error.message)
}
