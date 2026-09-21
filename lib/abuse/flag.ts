import 'server-only'

import { createAdminClient } from '@/lib/supabase/admin'
import { logActivity } from '@/lib/activityLog'
import { notify } from '@/lib/notifications'
import { detectAbuse } from './filter'

// The server side of abuse flagging (PR40 §2): FLAG, DO NOT BLOCK.
//
// The content has already been saved by the caller; this scans it, and if a
// banned term is present writes an abuse_flags row (sender, recipient, the text,
// the match, the time) for the /admin/flags queue. After the author's THIRD open
// flag it suspends them automatically. Nobody is notified except that the
// suspended member finds out on their next send; the recipient of a flagged
// message is never told — staff handle it.
//
// The auto-suspend sets profiles.is_suspended — the single fact suspension rests
// on (getEntitlements returns nothing, dashboards redirect, tutor_directory
// excludes) — and, for a tutor, verification_status='suspended'. It is NOT
// written to admin_audit_log (no human actor); the flag rows and the member
// timeline record it. A staff REINSTATEMENT is an admin action and IS audited
// (lib/moderation unsuspendMember, from the queue).

const AUTO_SUSPEND_AT = 3

export type FlagSource = 'message' | 'profile' | 'tuition' | 'display_name'

export type FlagResult = { flagged: boolean; matched: string[]; suspended: boolean }

export async function flagIfAbusive(params: {
  source: FlagSource
  /** The author / sender. */
  subjectId: string
  /** The message recipient, when source='message'. */
  recipientId?: string | null
  content: string
  /** {messageId, threadId, jobId, field} — whatever locates the flagged text. */
  context?: Record<string, unknown>
}): Promise<FlagResult> {
  const matched = detectAbuse(params.content)
  if (matched.length === 0) return { flagged: false, matched: [], suspended: false }

  const admin = createAdminClient()
  if (!admin) return { flagged: false, matched, suspended: false }

  await admin.from('abuse_flags').insert({
    source: params.source,
    subject_id: params.subjectId,
    recipient_id: params.recipientId ?? null,
    content: params.content.slice(0, 4000),
    matched,
    context: params.context ?? null,
  })

  // Count this author's OPEN flags; suspend on the third.
  const { count } = await admin
    .from('abuse_flags')
    .select('id', { count: 'exact', head: true })
    .eq('subject_id', params.subjectId)
    .eq('status', 'open')

  let suspended = false
  if ((count ?? 0) >= AUTO_SUSPEND_AT) {
    suspended = await autoSuspend(admin, params.subjectId)
  }
  return { flagged: true, matched, suspended }
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
