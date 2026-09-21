import 'server-only'

import { createAdminClient } from '@/lib/supabase/admin'
import { logActivity } from '@/lib/activityLog'
import { notify } from '@/lib/notifications'
import { detectAbuse } from './filter'
import { AUTO_SUSPEND_AT } from './warnings'

// The server side of abuse flagging (PR41 §2/§3): FLAG, WITHHOLD, then WARN.
//
// This scans a piece of content and, if a banned term is present, writes an
// abuse_flags row (sender, recipient, the text, the match, the time, whether it
// was withheld, and the WARNING NUMBER) for the /admin/flags queue. The CALLER
// is responsible for not delivering / not publishing the flagged content — this
// only records the flag, counts it, and (on the third open flag) suspends.
//
// The warning number returned is the member's OPEN-flag count after this flag:
// 1 = first warning, 2 = second, 3 = suspension. Clearing a flag on /admin/flags
// drops the open count, so a mistaken flag does not push someone toward
// suspension (that is the whole reason the count is OPEN flags, not all flags).
//
// The auto-suspend sets profiles.is_suspended — the single fact suspension rests
// on (getEntitlements returns nothing, dashboards redirect, tutor_directory
// excludes) — and, for a tutor, verification_status='suspended'. It is NOT
// written to admin_audit_log (no human actor); the flag rows and the member
// timeline record it. A staff REINSTATEMENT is an admin action and IS audited
// (lib/moderation unsuspendMember, from the queue).

export type FlagSource = 'message' | 'profile' | 'tuition' | 'display_name'

export type FlagResult = {
  flagged: boolean
  matched: string[]
  /** The member's open-flag count after this flag (1, 2, 3…). 0 when not flagged. */
  warningLevel: number
  suspended: boolean
}

export async function flagIfAbusive(params: {
  source: FlagSource
  /** The author / sender. */
  subjectId: string
  /** The message recipient, when source='message'. */
  recipientId?: string | null
  content: string
  /** {messageId, threadId, jobId, field} — whatever locates the flagged text. */
  context?: Record<string, unknown>
  /** Whether the caller withheld the content from delivery / publication. */
  withheld?: boolean
}): Promise<FlagResult> {
  const matched = detectAbuse(params.content)
  if (matched.length === 0) return { flagged: false, matched: [], warningLevel: 0, suspended: false }

  const admin = createAdminClient()
  if (!admin) return { flagged: false, matched, warningLevel: 0, suspended: false }

  // Count this author's OPEN flags AFTER this one — the warning number.
  const { count: before } = await admin
    .from('abuse_flags')
    .select('id', { count: 'exact', head: true })
    .eq('subject_id', params.subjectId)
    .eq('status', 'open')
  const warningLevel = (before ?? 0) + 1

  await admin.from('abuse_flags').insert({
    source: params.source,
    subject_id: params.subjectId,
    recipient_id: params.recipientId ?? null,
    content: params.content.slice(0, 4000),
    matched,
    context: params.context ?? null,
    warning_level: warningLevel,
    withheld: params.withheld ?? false,
  })

  let suspended = false
  if (warningLevel >= AUTO_SUSPEND_AT) {
    suspended = await autoSuspend(admin, params.subjectId)
  }
  return { flagged: true, matched, warningLevel, suspended }
}

/** Suspend the member for repeated abuse — the same state moderation.ts sets,
 *  minus the admin audit row (there is no human actor). Idempotent. */
async function autoSuspend(
  admin: NonNullable<ReturnType<typeof createAdminClient>>,
  userId: string,
): Promise<boolean> {
  const { data: prof } = await admin
    .from('profiles')
    .select('is_suspended, role')
    .eq('id', userId)
    .maybeSingle()
  if (!prof || prof.is_suspended) return false

  const reason = 'Automatic: repeated abusive messages or content.'
  await admin
    .from('profiles')
    .update({
      is_suspended: true,
      suspension_reason: reason,
      suspended_at: new Date().toISOString(),
      suspended_by: null,
    })
    .eq('id', userId)

  if (prof.role === 'tutor') {
    await admin
      .from('tutor_profiles')
      .update({ verification_status: 'suspended', is_featured: false })
      .eq('id', userId)
  }

  await notify({
    userId,
    kind: 'account_suspended',
    title: 'Your account has been suspended',
    body: 'Your account has been suspended for abusive messages or content. Contact support to appeal.',
    href: '/support',
  })

  await logActivity({ userId, event: 'suspended', targetType: 'profile', targetId: userId, meta: { reason } })
  return true
}
