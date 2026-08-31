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
  | 'plan_purchased'
  | 'plan_granted'
  | 'plan_revoked'
  | 'plan_expired'
  | 'suspended'
  | 'unsuspended'

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
