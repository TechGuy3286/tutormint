// lib/messaging.ts
//
// Threads and messages.
//
// Who may START a conversation (the rest is reply-only):
//
//   * any signed-in parent, verified or not, with any tutor, with or without a
//     job attached (PR25 §4.1: messaging, demos and shortlisting no longer need
//     CNIC verification; verification gates POSTING a tuition, and contact
//     details and hiring are what Featured adds)
//   * a tutor on premium or featured
//   * a verified-plan or free tutor may reply but never open a thread
//
// Replying is always allowed to an existing participant, whatever the plan.
// Both directions are refused between a blocked pair, and neither side is told
// which of them did the blocking.
//
// Bodies are stored verbatim and masked on the way out -- see lib/masking.ts.

import { cache } from 'react'
import { createClient } from '@/lib/supabase/server'
import { tuitionPath } from '@/lib/slugs'
import { createAdminClient } from '@/lib/supabase/admin'
import { hiddenAvatarTutorIds } from '@/lib/showAvatar'
import { getEntitlements, badgesForPlan } from '@/lib/entitlements'
import { renderMessageBody } from '@/lib/masking'
import { decodeCursor, encodeCursor } from '@/lib/cursor'
import { logActivity } from '@/lib/activityLog'
import { consumeQuota } from '@/lib/quota'
import { upgradeHref } from '@/lib/upgradePath'
import { buildGate, type Gate } from '@/lib/gate'
import { notify } from '@/lib/notifications'
import { deliverMessageDigest } from '@/lib/notify'
import { previewText } from '@/lib/messagingRules'
import { messageListTime } from '@/lib/datetime'
import { teamUnreadCount } from '@/lib/adminMessaging'
import { flagIfAbusive } from '@/lib/abuse/flag'
import { detectAbuse } from '@/lib/abuse/filter'
import { abuseWarning, type AbuseWarning } from '@/lib/abuse/warnings'
import { SUPPORT_WHATSAPP_DISPLAY, SUPPORT_EMAIL_FALLBACK } from '@/lib/supportContacts'

// PR16 §2.3 — an unverified tutor (fee unpaid) may RECEIVE parent messages and
// demo requests but cannot read or reply to them until the fee is paid. This is
// the server-side lock: the body/preview is hidden, enforced in every read path,
// not merely hidden in the UI. `isUnverifiedTutor` answers it for one member; the
// read paths blank out incoming content when the VIEWER is one.
const LOCKED_BODY = 'Verify your account to read this message.'
const LOCKED_PREVIEW = 'New message — verify to read'

export async function isUnverifiedTutor(userId: string): Promise<boolean> {
  const admin = createAdminClient()
  if (!admin) return false
  const { data: prof } = await admin.from('profiles').select('role').eq('id', userId).maybeSingle()
  if (prof?.role !== 'tutor') return false
  const { data: tp } = await admin
    .from('tutor_profiles')
    .select('verified_fee_paid_at')
    .eq('id', userId)
    .maybeSingle()
  return !tp?.verified_fee_paid_at
}

/** Cached per request: is the VIEWER an unverified tutor whose incoming messages
 *  must stay locked? */
export const viewerMessagesLocked = cache(async (userId: string): Promise<boolean> => {
  return isUnverifiedTutor(userId)
})

/** The message a reply quotes, resolved to a short (masked) snippet. */
export type MessageReplyRef = { id: string; snippet: string; mine: boolean }

/** A photo attachment. The URL is built from the message id on the client and
    served, participant-checked, by /api/messages/media/[id]. */
export type MessageAttachment = { w: number | null; h: number | null }

export type ThreadMessage = {
  id: string
  senderId: string
  mine: boolean
  body: string
  masked: boolean
  createdAt: string
  /** When the recipient read it. For the sender's own messages this drives the
      single (sent) vs double (seen) tick. Null until read. */
  readAt: string | null
  replyTo: MessageReplyRef | null
  attachment: MessageAttachment | null
  /** The sender's own message that was flagged and NOT delivered (PR41 §2).
      Only ever true on the sender's own bubble — the recipient never receives a
      withheld message at all. */
  withheld: boolean
}

type Fail = { ok: false; status: number; error: string; upgrade?: string; gate?: Gate }

/**
 * May `actorId` open a NEW conversation with `otherId`?
 *
 * Returns the reason as a sentence the member can act on, because "not
 * allowed" with no explanation is what makes people email support.
 */
export async function canStartThread(
  actorId: string,
  otherId: string,
): Promise<{ ok: true } | Fail> {
  if (actorId === otherId) {
    return { ok: false, status: 400, error: 'You cannot message yourself.' }
  }

  const admin = createAdminClient()
  if (admin) {
    const { data: blocked } = await admin.rpc('is_blocked_pair', { a: actorId, b: otherId })
    if (blocked) {
      // Deliberately neutral: the blocked party is never told they were
      // blocked, and the blocker is not named.
      return { ok: false, status: 403, error: 'You cannot message this member.' }
    }
  }

  const ent = await getEntitlements(actorId)

  // Same reasoning as job posting: suspension is not a plan problem, and the
  // upgrade CTA the tier checks below would produce is the wrong answer.
  if (ent.suspended) {
    return {
      ok: false,
      status: 403,
      error: 'Your account is suspended, so you cannot start conversations. Contact support.',
      upgrade: '/support',
      gate: await buildGate('suspended', ent),
    }
  }

  if (ent.audience === 'parent') {
    // PR25 §4.1 — any signed-in parent, verified or not, may start a conversation
    // with a tutor. The CNIC-verification gate that used to sit here is removed;
    // verification is required only for POSTING a tuition, and Featured only for
    // completing a hire and seeing contact details. (Suspension is handled above.)
    return { ok: true }
  }

  if (ent.audience === 'tutor') {
    // STARTING a conversation requires the verification fee (PR16 §1.2) — the same
    // gate as apply. Replying to a parent who wrote first ALSO needs the fee now
    // (an unverified tutor cannot read or reply until they verify, §2.3) but that
    // is enforced in sendMessage, not here. The gate is the CNIC + verify modal.
    if (!ent.verified) {
      return {
        ok: false,
        status: 403,
        error: 'Verify your account to message parents.',
        gate: await buildGate('tutor_verify', ent),
      }
    }
    if (!ent.canInitiateMessage) {
      return {
        ok: false,
        status: 403,
        error:
          'Your plan lets you reply to parents and apply for jobs. Upgrade to Premium to start a conversation.',
        upgrade: upgradeHref('tutor', ent.plan, 'premium'),
        gate: await buildGate('tutor_message', ent),
      }
    }
    return { ok: true }
  }

  return { ok: false, status: 403, error: 'This account cannot send messages.' }
}

/**
 * Find the existing thread for a pair (and job), or create one.
 *
 * The pair is stored in a canonical order so (a,b) and (b,a) resolve to the
 * same row; a unique index enforces it in the database as well, so two
 * simultaneous first messages cannot produce two threads.
 */
export async function findOrCreateThread(params: {
  actorId: string
  otherId: string
  jobId?: string | null
}): Promise<{ ok: true; threadId: string; created: boolean } | Fail> {
  const { actorId, otherId } = params
  const jobId = params.jobId ?? null

  const supabase = await createClient()
  const [a, b] = actorId < otherId ? [actorId, otherId] : [otherId, actorId]

  let existingQuery = supabase
    .from('threads')
    .select('id')
    .eq('participant_a', a)
    .eq('participant_b', b)

  existingQuery = jobId ? existingQuery.eq('job_id', jobId) : existingQuery.is('job_id', null)

  // The block check has to happen BEFORE an existing thread is handed back,
  // not only when creating one. Otherwise a pair who had talked before the
  // block could still open the conversation and only discover the block when
  // sending failed -- which is both confusing and a way to keep pestering
  // someone with "typing" activity they cannot stop.
  const admin = createAdminClient()
  if (admin) {
    const { data: blocked } = await admin.rpc('is_blocked_pair', { a: actorId, b: otherId })
    if (blocked) {
      return { ok: false, status: 403, error: 'You cannot message this member.' }
    }
  }

  const { data: existing } = await existingQuery.maybeSingle()
  if (existing) return { ok: true, threadId: existing.id as string, created: false }

  const gate = await canStartThread(actorId, otherId)
  if (!gate.ok) return gate

  const { data: created, error } = await supabase
    .from('threads')
    .insert({ participant_a: a, participant_b: b, initiated_by: actorId, job_id: jobId })
    .select('id')
    .single()

  if (error) {
    // Lost the race against the unique index: the other side's first message
    // created the thread a moment ago. Use theirs.
    const { data: raced } = await existingQuery.maybeSingle()
    if (raced) return { ok: true, threadId: raced.id as string, created: false }
    return { ok: false, status: 400, error: error.message }
  }

  await consumeQuota(actorId, 'message_initiation')

  return { ok: true, threadId: created.id as string, created: true }
}

/** Post a message into a thread the sender is part of. */
export async function sendMessage(params: {
  actorId: string
  threadId: string
  body: string
  /** The message being quoted, if any. Must belong to the same thread. */
  replyTo?: string | null
  /** A photo already uploaded to message-media by this sender, if any. */
  attachment?: { path: string; w: number; h: number; bytes: number } | null
}): Promise<
  | { ok: true; messageId: string; withheld?: boolean; warning?: AbuseWarning }
  | Fail
> {
  const body = params.body.trim()
  const attachment = params.attachment ?? null
  // A message needs a body OR a photo. Both together (a caption) is fine.
  if (!body && !attachment) return { ok: false, status: 400, error: 'Write something first.' }
  if (body.length > 4000) {
    return { ok: false, status: 400, error: 'Message is too long (4000 characters max).' }
  }

  const supabase = await createClient()

  const { data: thread } = await supabase
    .from('threads')
    .select('id, participant_a, participant_b, job_id')
    .eq('id', params.threadId)
    .maybeSingle()

  if (!thread) return { ok: false, status: 404, error: 'Conversation not found.' }

  const me = params.actorId
  if (thread.participant_a !== me && thread.participant_b !== me) {
    return { ok: false, status: 403, error: 'Conversation not found.' }
  }

  // A photo attachment is gated by the SAME rule as seeing contact details, and
  // its object must be one this sender uploaded (path is `<uid>/...`). No new
  // rule: a member who cannot see contact cannot send a photo.
  if (attachment) {
    const ent = await getEntitlements(me)
    if (!ent.canViewContact) {
      return { ok: false, status: 403, error: 'Upgrade to send photos.', gate: await buildGate('tutor_message', ent) }
    }
    if (!attachment.path.startsWith(`${me}/`)) {
      return { ok: false, status: 400, error: 'That photo could not be attached.' }
    }
  }

  // A reply must quote a message in THIS thread — never a peek into another one.
  let replyTo: string | null = null
  if (params.replyTo) {
    const { data: quoted } = await supabase
      .from('messages')
      .select('id')
      .eq('id', params.replyTo)
      .eq('thread_id', thread.id)
      .maybeSingle()
    replyTo = quoted ? (quoted.id as string) : null
  }

  const other = thread.participant_a === me ? thread.participant_b : thread.participant_a
  let senderName = 'a TutorMint member'

  const admin = createAdminClient()
  if (admin) {
    const { data: blocked } = await admin.rpc('is_blocked_pair', { a: me, b: other })
    if (blocked) {
      return { ok: false, status: 403, error: 'You cannot message this member.' }
    }
  }

  // Replying is always allowed on every plan, including none: only OPENING a
  // thread is plan-gated, and that already happened in findOrCreateThread.
  //
  // Suspension is the one exception, and it is checked here rather than through
  // getEntitlements: a member with no plan may still reply, so "no powers" and
  // "suspended" are genuinely different states at this line.
  if (admin) {
    const { data: sender } = await admin
      .from('profiles')
      .select('is_suspended, full_name, role')
      .eq('id', me)
      .maybeSingle()
    senderName = (sender?.full_name as string) ?? 'a TutorMint member'
    if (sender?.is_suspended) {
      // One plain line for a (possibly auto-)suspended sender, with how to appeal
      // (PR40 §2). This is what a member auto-suspended for repeated abuse sees on
      // their next send.
      return {
        ok: false,
        status: 403,
        error: `You can't send messages — your account is suspended. To appeal, message support on WhatsApp ${SUPPORT_WHATSAPP_DISPLAY} or email ${SUPPORT_EMAIL_FALLBACK}.`,
      }
    }
    // PR16 §2.3 — an unverified tutor cannot reply until the fee is paid. (They
    // also cannot read the message they would be replying to.)
    if (sender?.role === 'tutor') {
      const { data: tp } = await admin
        .from('tutor_profiles')
        .select('verified_fee_paid_at')
        .eq('id', me)
        .maybeSingle()
      if (!tp?.verified_fee_paid_at) {
        return { ok: false, status: 403, error: 'Verify your account to reply to parents.' }
      }
    }
  }

  // Abuse check BEFORE delivery (PR41 §2): a flagged message is WITHHELD — it is
  // recorded so the SENDER sees it in their own thread marked "not sent", but it
  // never reaches the recipient (no row they can read, no notification, no
  // unread, no digest, no last_message_at bump). The row is written with
  // withheld_at ALREADY SET, so there is no window in which the recipient's read
  // path could return it.
  const matched = body ? detectAbuse(body) : []
  const withheld = matched.length > 0
  const nowIso = new Date().toISOString()

  const { data: created, error } = await supabase
    .from('messages')
    .insert({
      thread_id: thread.id,
      sender_id: me,
      body,
      reply_to: replyTo,
      attachment_path: attachment?.path ?? null,
      attachment_w: attachment?.w ?? null,
      attachment_h: attachment?.h ?? null,
      attachment_bytes: attachment?.bytes ?? null,
      withheld_at: withheld ? nowIso : null,
      // Legacy NOT NULL columns, mirrored until T8 removes them.
      job_id: (thread.job_id as string) ?? '',
      sender: me,
      recipient: other,
      message: body,
    })
    .select('id')
    .single()

  if (error) return { ok: false, status: 400, error: error.message }

  // The event records the thread id and nothing else -- message content never
  // enters the activity log. Recorded for a withheld message too: the member DID
  // send (the attempt happened); it simply was not delivered.
  await logActivity({
    userId: me,
    event: 'message_sent',
    targetType: 'thread',
    targetId: thread.id as string,
  })

  if (withheld) {
    // Raise the flag and read the warning number back. Awaited so it runs to
    // completion on serverless; a flag failure must not fail the (withheld)
    // send, but the sender still sees their message marked not sent.
    let warning: AbuseWarning = abuseWarning(1, false)
    try {
      const flag = await flagIfAbusive({
        source: 'message',
        subjectId: me,
        recipientId: other,
        content: body,
        context: { messageId: created.id, threadId: thread.id },
        withheld: true,
      })
      warning = abuseWarning(flag.warningLevel || 1, flag.suspended)
      if (admin) {
        await admin.from('messages').update({ withheld_level: flag.warningLevel }).eq('id', created.id)
      }
    } catch {
      /* keep the default first-warning copy if the flag write failed */
    }
    // No notification, no digest, no last_message_at bump: the recipient must
    // never learn a withheld message exists.
    return { ok: true, messageId: created.id as string, withheld: true, warning }
  }

  if (admin) {
    await admin
      .from('threads')
      .update({ last_message_at: nowIso })
      .eq('id', thread.id)
  }

  // PR16 §2.2 — an UNVERIFIED tutor recipient is told a parent wrote, and to
  // verify to read and reply; the body stays hidden until the fee is paid (§2.3,
  // enforced in the read paths below). No price, no "pay" wording; tapping opens
  // the verify step. Everyone else gets the normal notification with the thread.
  const recipientLocked = await isUnverifiedTutor(other)
  if (recipientLocked) {
    await notify({
      userId: other,
      kind: 'message_received',
      title: 'New message',
      body: 'A parent sent you a message. Verify your account to read and reply.',
      href: '/tutor/complete-profile?step=verify',
    })
  } else {
    await notify({
      userId: other,
      kind: 'message_received',
      title: 'New message',
      body: 'You have a new message on TutorMint.',
      href: `/messages/${thread.id}`,
    })
  }

  // The email digest, at most one an hour per person and never containing the
  // message itself. Two reasons for that: an inbox is not a place we control,
  // and a parent forwarding a "here is what the tutor said" email is a leak we
  // built number-masking to prevent. The email says there is a message; reading
  // it happens on the site.
  //
  // Deliberately not awaited into the caller's failure path -- a sent message
  // must not be reported as failed because an email did not go out.
  void deliverMessageDigest({ userId: other, count: 1, from: [senderName] }).catch(() => {})

  return { ok: true, messageId: created.id as string }
}

/**
 * True when BOTH participants may exchange contact details, which is what
 * decides whether numbers in a thread render or are masked.
 */
export async function pairMayShareContact(a: string, b: string): Promise<boolean> {
  const [ea, eb] = await Promise.all([getEntitlements(a), getEntitlements(b)])
  return ea.canViewContact && eb.canViewContact
}

// ---------------------------------------------------------------------------
// The inbox
// ---------------------------------------------------------------------------
//
// Everything below reads. Three rules hold across all of it, and they are the
// reason the queries look more defensive than they need to:
//
// 1. EVERY READ NAMES THE VIEWER. The SELECT policies here are
//    `owns_thread(thread_id) OR is_admin()` and
//    `participant_a = auth.uid() OR participant_b = auth.uid() OR is_admin()`.
//    That `OR is_admin()` exists so the reports queue can load a reported
//    thread, and it means RLS alone does NOT answer "my conversations" for a
//    staff account -- it answers "every conversation on the platform". The
//    same shape put another member's notifications in a manager's bell when
//    the bell shipped. The scope is stated here; the policy is the backstop.
//
// 2. BODIES ARE MASKED BEFORE THEY LEAVE. Never rendered-and-hidden: an
//    unentitled reader is not sent the digits at all, in the thread OR in the
//    list preview, because a preview is a body too.
//
// 3. A BLOCKED PAIR HAS NO THREAD. Not a greyed-out one -- absent. Blocks are
//    resolved once per page through the service role, because `user_blocks` is
//    admin-read-only by policy: a member cannot see their own blocks with
//    their own client, which is deliberate (it stops a blocked party probing
//    for a block).

const NAME_FALLBACK = 'TutorMint member'

export type ThreadRow = {
  id: string
  jobId: string | null
  jobTitle: string | null
  jobRef: string | null
  otherId: string
  otherName: string
  otherAvatar: string | null
  otherRole: string | null
  lastMessageAt: string
  /** Server-formatted stamp (today → time, this week → weekday, else date), so
      the client renders a string and never re-derives it from `now`. */
  lastMessageLabel: string
  preview: string
  unread: number
}

export type ThreadHeader = {
  id: string
  otherId: string
  otherName: string
  otherAvatar: string | null
  otherRole: string | null
  otherSlug: string | null
  otherBadges: ReturnType<typeof badgesForPlan>
  jobId: string | null
  jobTitle: string | null
  jobRef: string | null
  /** The tuition's public page, when it is still open. Null once it closes. */
  jobHref: string | null
  /** Both sides may exchange numbers, so nothing is masked in this thread. */
  canShareContact: boolean
}

type ThreadCursor = { t: string; i: string }
type MessageCursor = { c: string; i: string }

/**
 * Counterparts this member cannot talk to, in either direction.
 *
 * One query per page rather than one RPC per thread: `is_blocked_pair` is fine
 * for the single-pair question at send time, but a list would make N of them.
 */
async function blockedCounterparts(userId: string): Promise<string[]> {
  const admin = createAdminClient()
  if (!admin) return []
  const { data } = await admin
    .from('user_blocks')
    .select('blocker_id, blocked_id')
    .or(`blocker_id.eq.${userId},blocked_id.eq.${userId}`)
  const out = new Set<string>()
  for (const b of data ?? []) {
    const other = b.blocker_id === userId ? (b.blocked_id as string) : (b.blocker_id as string)
    if (other !== userId) out.add(other)
  }
  return [...out]
}

/** `/messages/<uuid>` -- the one href every message notification has carried. */
function threadIdFromHref(href: string | null): string | null {
  if (!href) return null
  const m = /^\/messages\/([0-9a-f-]{36})$/i.exec(href.trim())
  return m ? m[1] : null
}

/**
 * Unread message counts, per thread.
 *
 * Taken from `notifications` rather than a read marker on `threads`, because
 * the unread rows already exist and are already what the header bell counts.
 * One source means the dot in the list and the number on the bell can never
 * disagree -- and marking a thread read on open is then the same write the
 * bell already performs, not a second bookkeeping system to keep in step.
 */
async function unreadByThread(userId: string): Promise<Map<string, number>> {
  const supabase = await createClient()
  const { data } = await supabase
    .from('notifications')
    .select('href')
    .eq('user_id', userId)
    .eq('kind', 'message_received')
    .is('read_at', null)

  const out = new Map<string, number>()
  for (const n of data ?? []) {
    const id = threadIdFromHref(n.href as string | null)
    if (id) out.set(id, (out.get(id) ?? 0) + 1)
  }
  return out
}

/**
 * Mark this thread's message notifications read.
 *
 * Through the member's OWN client: `notifications_own_mark_read` is scoped to
 * `user_id = auth.uid()`, so the database refuses to let anyone clear somebody
 * else's unread state even if this were called with the wrong id.
 */
export async function markThreadRead(userId: string, threadId: string): Promise<void> {
  const supabase = await createClient()
  const now = new Date().toISOString()

  await supabase
    .from('notifications')
    .update({ read_at: now })
    .eq('user_id', userId)
    .eq('kind', 'message_received')
    .eq('href', `/messages/${threadId}`)
    .is('read_at', null)

  // Stamp read_at on the OTHER party's messages in this thread — this is what
  // turns their sent tick into a seen tick. Through the service role, and only
  // for a genuine participant: `messages` has no member UPDATE policy (a member
  // must not be able to edit a row), so the receipt is a server write, gated by
  // the same participant check the read route runs before calling this.
  const admin = createAdminClient()
  if (admin) {
    const { data: thread } = await admin
      .from('threads')
      .select('participant_a, participant_b')
      .eq('id', threadId)
      .maybeSingle()
    if (
      thread &&
      (thread.participant_a === userId || thread.participant_b === userId)
    ) {
      await admin
        .from('messages')
        .update({ read_at: now })
        .eq('thread_id', threadId)
        .neq('sender_id', userId)
        .is('read_at', null)
    }
  }
}

/**
 * Unread MESSAGES waiting for this member, across every conversation.
 *
 * The dashboards' Messages tile reads "<n> unread" and used to compute it from
 * `ThreadSummary.unread`, which `listThreads` hard-coded to `false` -- so the
 * tile said "0 unread" to somebody with twenty-four unread messages, on every
 * dashboard, always. Same rows as the header bell counts, for the same reason
 * the list's dots use them: one source cannot disagree with itself.
 */
// ONE QUERY PER REQUEST (owner PR5b §2.4). The header icon (Navbar), the desktop
// dock (SiteChrome) and the dashboard "Messages" tile all read this in the same
// render pass; React cache() dedupes them to a single unread computation per
// (userId, request) so the three surfaces agree and cost one query, not three.
export const unreadMessageCount = cache(async (userId: string): Promise<number> => {
  const supabase = await createClient()
  const { count } = await supabase
    .from('notifications')
    .select('id', { count: 'exact', head: true })
    // The SELECT policy is `user_id = auth.uid() OR is_admin()`, so an admin
    // reading their own dashboard would otherwise be counting the platform.
    .eq('user_id', userId)
    .eq('kind', 'message_received')
    .is('read_at', null)

  // Official TutorMint Team messages live in the same inbox now (owner, Part 5),
  // so the dashboard "Messages" tile counts them too — "two message screens is a
  // place official messages go unread" was the whole reason for unifying. Read
  // from the admin_messages store, the pinned Team row's own source of truth.
  const team = await teamUnreadCount(userId)
  return (count ?? 0) + team
})

/**
 * How many conversations this member actually SEES — the number on the dashboard
 * Messages tile (PR44 §2). It mirrors the inbox list (threadPage) exactly: a
 * thread counts only when it holds at least one message this member can see, so
 *   - a thread whose only message was WITHHELD (abuse-flagged) from this member
 *     never appears — a withheld message reaches nobody but its own sender, so
 *     for the recipient the thread has no visible message and is not a
 *     conversation (PR41 §2);
 *   - a thread whose messages this member has all deleted-for-me drops out too;
 *   - an empty thread (created but never messaged) does not count.
 * Blocked counterparts are excluded, as everywhere else.
 *
 * The Team channel is NOT counted here: it is a system channel, not a peer
 * conversation, and "four conversations" means four people. Its unread still
 * shows on the tile's badge, which reads unreadMessageCount (peer + team), the
 * same source the header bell uses.
 */
export async function conversationCount(userId: string): Promise<number> {
  const supabase = await createClient()
  const blocked = await blockedCounterparts(userId)

  let tq = supabase
    .from('threads')
    .select('id')
    .or(`participant_a.eq.${userId},participant_b.eq.${userId}`)
  if (blocked.length > 0) {
    const list = `(${blocked.join(',')})`
    tq = tq.not('participant_a', 'in', list).not('participant_b', 'in', list)
  }
  const { data: threads } = await tq
  const ids = (threads ?? []).map((t) => t.id as string)
  if (ids.length === 0) return 0

  // The member's own client may read the messages of its own threads
  // (owns_thread). Withheld/deleted filtering is application-level (RLS does not
  // hide them), so it is applied here, exactly as threadPage does for the list.
  const { data: msgs } = await supabase
    .from('messages')
    .select('thread_id, sender_id, withheld_at, deleted_for')
    .in('thread_id', ids)

  const visible = new Set<string>()
  for (const m of msgs ?? []) {
    const deletedFor = (m.deleted_for as string[] | null) ?? []
    if (deletedFor.includes(userId)) continue
    // A withheld message is visible only to its own sender.
    if ((m.withheld_at as string | null) && (m.sender_id as string) !== userId) continue
    visible.add(m.thread_id as string)
  }
  return visible.size
}

/**
 * One page of conversations, newest activity first.
 *
 * Keyed on (last_message_at, id). The id is not decoration: last_message_at
 * alone is not unique, and two threads touched in the same millisecond would
 * compare equal -- a row a keyset cursor can straddle, shown twice or never.
 * Migration 36 made last_message_at NOT NULL so the key is total.
 */
export async function threadPage({
  userId,
  limit,
  cursor = null,
  q = null,
}: {
  userId: string
  limit: number
  cursor?: string | null
  q?: string | null
}): Promise<{ items: ThreadRow[]; cursor: string | null }> {
  const supabase = await createClient()
  const admin = createAdminClient()

  const term = (q ?? '').trim()

  // Searching by the other person's NAME needs the service role: `profiles` is
  // self-read only, so a member's own client cannot see the name of the person
  // they are talking to -- which is also why the names below are fetched that
  // way. Only the display fields cross over; nothing else from the row does.
  let matchIds: string[] | null = null
  let matchJobIds: string[] | null = null
  if (term.length > 0) {
    const [people, jobs] = await Promise.all([
      admin
        ? admin.from('profiles').select('id').ilike('full_name', `%${term}%`).limit(200)
        : Promise.resolve({ data: [] as { id: string }[] }),
      supabase.from('jobs').select('id').ilike('title', `%${term}%`).limit(200),
    ])
    matchIds = (people.data ?? []).map((p) => p.id as string)
    matchJobIds = (jobs.data ?? []).map((j) => j.id as string)
    // Nothing matched anywhere: an empty result, not an unfiltered list.
    if (matchIds.length === 0 && matchJobIds.length === 0) return { items: [], cursor: null }
  }

  const blocked = await blockedCounterparts(userId)
  // PR16 §2.3 — a locked (unverified) tutor sees the conversation exists but not
  // its latest line, in the list as well as the thread.
  const locked = await viewerMessagesLocked(userId)

  let query = supabase
    .from('threads')
    .select('id, job_id, participant_a, participant_b, created_at, last_message_at')
    // The viewer, stated. See rule 1 above.
    .or(`participant_a.eq.${userId},participant_b.eq.${userId}`)

  if (blocked.length > 0) {
    const list = `(${blocked.join(',')})`
    query = query.not('participant_a', 'in', list).not('participant_b', 'in', list)
  }

  if (matchIds || matchJobIds) {
    const clauses: string[] = []
    if (matchIds && matchIds.length > 0) {
      clauses.push(`participant_a.in.(${matchIds.join(',')})`)
      clauses.push(`participant_b.in.(${matchIds.join(',')})`)
    }
    if (matchJobIds && matchJobIds.length > 0) clauses.push(`job_id.in.(${matchJobIds.join(',')})`)
    // A second .or() is ANDed with the first, so this narrows the member's own
    // threads rather than widening past them.
    query = query.or(clauses.join(','))
  }

  const after = decodeCursor<ThreadCursor>(cursor)
  if (after) {
    query = query.or(
      `last_message_at.lt.${after.t},and(last_message_at.eq.${after.t},id.lt.${after.i})`,
    )
  }

  const { data: threads } = await query
    .order('last_message_at', { ascending: false })
    .order('id', { ascending: false })
    .limit(limit + 1)

  const rows = threads ?? []
  const hasMore = rows.length > limit
  const page = hasMore ? rows.slice(0, limit) : rows
  if (page.length === 0) return { items: [], cursor: null }

  const otherIds = page.map((t) =>
    t.participant_a === userId ? (t.participant_b as string) : (t.participant_a as string),
  )
  const jobIds = page.map((t) => t.job_id as string | null).filter(Boolean) as string[]
  const threadIds = page.map((t) => t.id as string)

  const [people, jobs, previews, unread] = await Promise.all([
    admin
      ? admin.from('profiles').select('id, full_name, role, avatar_url').in('id', otherIds)
      : Promise.resolve({ data: [] as Record<string, unknown>[] }),
    jobIds.length > 0
      ? supabase.from('jobs').select('id, title, job_tx_id').in('id', jobIds)
      : Promise.resolve({ data: [] as Record<string, unknown>[] }),
    admin
      ? admin
          .from('messages')
          .select('thread_id, sender_id, body, created_at, attachment_path, deleted_for, withheld_at')
          .in('thread_id', threadIds)
          .order('created_at', { ascending: false })
      : Promise.resolve({ data: [] as Record<string, unknown>[] }),
    unreadByThread(userId),
  ])

  // A tutor who hid their picture (PR70) shows initials to the parent in the
  // inbox too. The other party's photo is nulled when they are a tutor with
  // show_avatar=false; a parent has no such flag and is never affected.
  const hiddenAvatars = await hiddenAvatarTutorIds(admin, otherIds)

  const names = new Map<string, { name: string; role: string | null; avatar: string | null }>()
  for (const p of people.data ?? []) {
    const pid = p.id as string
    names.set(pid, {
      name: (p.full_name as string) ?? NAME_FALLBACK,
      role: (p.role as string) ?? null,
      avatar: hiddenAvatars.has(pid) ? null : ((p.avatar_url as string) ?? null),
    })
  }

  const jobInfo = new Map<string, { title: string; ref: string | null }>()
  for (const j of jobs.data ?? []) {
    jobInfo.set(j.id as string, {
      title: (j.title as string) ?? 'Tuition',
      ref: (j.job_tx_id as string) ?? null,
    })
  }

  // The newest message per thread that this viewer can SEE, so a preview never
  // shows a line the reader deleted — and never a WITHHELD (abuse-flagged)
  // message that belongs to the other party, which the recipient must never
  // learn exists (PR41 §2). A withheld message is only ever visible to its own
  // sender, and shows as a plain "not sent" marker in their list. An attachment
  // with no body previews as "Photo".
  const latest = new Map<string, { body: string; hasAttachment: boolean; withheld: boolean }>()
  for (const m of previews.data ?? []) {
    const key = m.thread_id as string
    if (latest.has(key)) continue
    const deletedFor = (m.deleted_for as string[] | null) ?? []
    if (deletedFor.includes(userId)) continue
    const isWithheld = !!(m.withheld_at as string | null)
    // A withheld message reaches nobody but its sender.
    if (isWithheld && (m.sender_id as string) !== userId) continue
    latest.set(key, {
      body: (m.body as string) ?? '',
      hasAttachment: !!(m.attachment_path as string | null),
      withheld: isWithheld,
    })
  }

  // One entitlement lookup per counterpart, not one per thread: the same
  // tutor can hold several threads with the same parent (one per job).
  const share = new Map<string, boolean>()
  await Promise.all(
    [...new Set(otherIds)].map(async (id) => {
      share.set(id, await pairMayShareContact(userId, id))
    }),
  )

  const items: ThreadRow[] = page
    // A thread with NO message this viewer can see is dropped from their list —
    // which is how a brand-new conversation whose only message was withheld
    // never appears in the recipient's inbox (PR41 §2). The sender still sees it
    // (their withheld message is visible to them, so it has a `latest`).
    .filter((t) => latest.has(t.id as string))
    .map((t) => {
      const otherId =
        t.participant_a === userId ? (t.participant_b as string) : (t.participant_a as string)
      const job = t.job_id ? jobInfo.get(t.job_id as string) : undefined
      const newest = latest.get(t.id as string)
      // Masked here as well as in the thread. A preview is a message body with
      // fewer characters, and leaking a number through the list would make the
      // masking inside the conversation pointless. A bare attachment reads "Photo".
      // A withheld (not-sent) message previews as a plain marker, shown only to
      // its own sender.
      const rendered = newest?.withheld
        ? { text: 'Not sent' }
        : locked
          ? { text: LOCKED_PREVIEW }
          : renderMessageBody(
              previewText(newest?.body ?? '', newest?.hasAttachment ?? false),
              share.get(otherId) ?? false,
            )
      const lastMessageAt = (t.last_message_at as string) ?? (t.created_at as string)

      return {
        id: t.id as string,
        jobId: (t.job_id as string) ?? null,
        jobTitle: job?.title ?? null,
        jobRef: job?.ref ?? null,
        otherId,
        otherName: names.get(otherId)?.name ?? NAME_FALLBACK,
        otherAvatar: names.get(otherId)?.avatar ?? null,
        otherRole: names.get(otherId)?.role ?? null,
        lastMessageAt,
        lastMessageLabel: messageListTime(lastMessageAt),
        preview: rendered.text.slice(0, 140),
        unread: unread.get(t.id as string) ?? 0,
      }
    })

  const last = page[page.length - 1]
  const next = hasMore
    ? encodeCursor({ t: last.last_message_at as string, i: last.id as string })
    : null

  return { items, cursor: next }
}

/**
 * Who this conversation is with, and whether it may carry a phone number.
 *
 * Returns null when the caller is not a participant. That is the same answer a
 * made-up id gets, so nobody learns whether a conversation they are not in
 * exists.
 */
export async function threadHeader(userId: string, threadId: string): Promise<ThreadHeader | null> {
  const supabase = await createClient()

  const { data: thread } = await supabase
    .from('threads')
    .select('id, job_id, participant_a, participant_b')
    .eq('id', threadId)
    .maybeSingle()

  // Stated rather than left to RLS: the policy admits an admin to every
  // thread, and an admin opening their own inbox is a member like any other.
  if (!thread) return null
  if (thread.participant_a !== userId && thread.participant_b !== userId) return null

  const otherId =
    thread.participant_a === userId
      ? (thread.participant_b as string)
      : (thread.participant_a as string)

  const admin = createAdminClient()
  if (admin) {
    const { data: blocked } = await admin.rpc('is_blocked_pair', { a: userId, b: otherId })
    // A blocked pair has no thread at all -- the same 404 a stranger's id
    // gets, so the block is not something either side can detect from here.
    if (blocked) return null
  }

  let otherName = NAME_FALLBACK
  let otherAvatar: string | null = null
  let otherRole: string | null = null
  let otherSlug: string | null = null
  let otherBadges: ReturnType<typeof badgesForPlan> = []

  if (admin) {
    const [{ data: profile }, { data: tutor }, { data: subs }] = await Promise.all([
      admin
        .from('profiles')
        .select('full_name, role, avatar_url, profile_completion')
        .eq('id', otherId)
        .maybeSingle(),
      admin.from('tutor_profiles').select('slug').eq('id', otherId).maybeSingle(),
      admin
        .from('subscriptions')
        .select('plan_code')
        .eq('user_id', otherId)
        .eq('status', 'active')
        .gt('expires_at', new Date().toISOString()),
    ])

    otherName = (profile?.full_name as string) ?? otherName
    otherAvatar = (profile?.avatar_url as string) ?? null
    otherRole = (profile?.role as string) ?? null
    // The counterpart tutor's hidden picture (PR70) → initials in the header too.
    if (otherAvatar) {
      const hidden = await hiddenAvatarTutorIds(admin, [otherId])
      if (hidden.has(otherId)) otherAvatar = null
    }
    otherSlug = (tutor?.slug as string) ?? null
    otherBadges = badgesForPlan(
      (subs ?? [])[0]?.plan_code as string | undefined,
      ((profile?.profile_completion as number) ?? 0) >= 100,
    )
  }

  let jobTitle: string | null = null
  let jobRef: string | null = null
  let jobHref: string | null = null
  if (thread.job_id) {
    const { data: job } = await supabase
      .from('jobs')
      .select('title, job_tx_id, public_slug, city, status')
      .eq('id', thread.job_id)
      .maybeSingle()
    jobTitle = (job?.title as string) ?? null
    jobRef = (job?.job_tx_id as string) ?? null
    // The tuition's own public page, for the side of the conversation that
    // does not own the job. Only while it is open -- a closed one answers 410,
    // and the conversation about a filled tuition is exactly where somebody
    // would click it.
    jobHref =
      job && job.status === 'open' && job.public_slug
        ? tuitionPath({ public_slug: job.public_slug as string, city: job.city as string | null })
        : null
  }

  return {
    id: thread.id as string,
    otherId,
    otherName,
    otherAvatar,
    otherRole,
    otherSlug,
    otherBadges,
    jobId: (thread.job_id as string) ?? null,
    jobTitle,
    jobRef,
    jobHref,
    canShareContact: await pairMayShareContact(userId, otherId),
  }
}

/**
 * One window of a conversation, returned OLDEST FIRST.
 *
 * Fetched newest-first because that is the end a reader starts at, then
 * reversed: a chat is read downwards but paged upwards, and the two orders
 * have to be kept apart somewhere. Here is that somewhere.
 */
export async function messagePage({
  userId,
  threadId,
  limit,
  cursor = null,
  canShareContact,
}: {
  userId: string
  threadId: string
  limit: number
  cursor?: string | null
  /** Pass it in when the caller already knows; otherwise it is resolved here. */
  canShareContact?: boolean
}): Promise<{ items: ThreadMessage[]; cursor: string | null } | null> {
  const supabase = await createClient()

  const { data: thread } = await supabase
    .from('threads')
    .select('id, participant_a, participant_b')
    .eq('id', threadId)
    .maybeSingle()

  if (!thread) return null
  if (thread.participant_a !== userId && thread.participant_b !== userId) return null

  const otherId =
    thread.participant_a === userId
      ? (thread.participant_b as string)
      : (thread.participant_a as string)
  const mayShare = canShareContact ?? (await pairMayShareContact(userId, otherId))

  let query = supabase
    .from('messages')
    .select('id, sender_id, body, created_at, reply_to, read_at, attachment_path, attachment_w, attachment_h, withheld_at')
    .eq('thread_id', threadId)
    // A message this reader deleted for themselves is invisible to them, and
    // only them — the row stays for the other participant.
    .not('deleted_for', 'cs', `{${userId}}`)
    // A WITHHELD (abuse-flagged) message never reaches the recipient (PR41 §2):
    // it is returned only to its own sender, marked "not sent". A withheld
    // message is always the sender's own, so this is the recipient exclusion.
    .or(`withheld_at.is.null,sender_id.eq.${userId}`)

  const after = decodeCursor<MessageCursor>(cursor)
  if (after) {
    query = query.or(`created_at.lt.${after.c},and(created_at.eq.${after.c},id.lt.${after.i})`)
  }

  const { data: rows } = await query
    .order('created_at', { ascending: false })
    .order('id', { ascending: false })
    .limit(limit + 1)

  const all = rows ?? []
  const hasMore = all.length > limit
  const window = hasMore ? all.slice(0, limit) : all
  if (window.length === 0) return { items: [], cursor: null }

  // PR16 §2.3 — an unverified tutor viewing their own inbox sees that a parent
  // wrote, but never the words, until the fee is paid. Enforced here, server-side.
  const locked = await viewerMessagesLocked(userId)

  const oldest = window[window.length - 1]
  const next = hasMore
    ? encodeCursor({ c: oldest.created_at as string, i: oldest.id as string })
    : null

  // Resolve the messages these ones quote, so a reply can show a snippet above
  // its own text. Same thread, so the member's own client (owns_thread) may read
  // them; the snippet is masked like everything else and clipped short.
  const replyIds = [...new Set(window.map((m) => m.reply_to as string | null).filter(Boolean) as string[])]
  const replySnippets = new Map<string, MessageReplyRef>()
  if (replyIds.length > 0) {
    const { data: quoted } = await supabase
      .from('messages')
      .select('id, sender_id, body, attachment_path')
      .in('id', replyIds)
    for (const q of quoted ?? []) {
      const source = previewText((q.body as string) ?? '', !!(q.attachment_path as string | null))
      replySnippets.set(q.id as string, {
        id: q.id as string,
        snippet: renderMessageBody(source, mayShare).text.slice(0, 90),
        mine: (q.sender_id as string) === userId,
      })
    }
  }

  const items: ThreadMessage[] = window
    .slice()
    .reverse()
    .map((m) => {
      const mine = m.sender_id === userId
      // A locked (unverified) tutor sees only that a message exists — never its
      // words, its photo, or the message it quotes. Their own messages are never
      // hidden (they cannot have sent any while locked).
      if (locked && !mine) {
        return {
          id: m.id as string,
          senderId: m.sender_id as string,
          mine: false,
          body: LOCKED_BODY,
          masked: true,
          createdAt: m.created_at as string,
          readAt: (m.read_at as string | null) ?? null,
          replyTo: null,
          attachment: null,
          withheld: false,
        }
      }
      // Masked on the server. The digits are not sent to a reader who may not
      // have them, so there is nothing in the browser to un-hide.
      const rendered = renderMessageBody((m.body as string) ?? '', mayShare)
      const replyToId = m.reply_to as string | null
      const hasAttachment = !!(m.attachment_path as string | null)
      return {
        id: m.id as string,
        senderId: m.sender_id as string,
        mine,
        body: rendered.text,
        masked: rendered.masked,
        createdAt: m.created_at as string,
        readAt: (m.read_at as string | null) ?? null,
        replyTo: replyToId ? (replySnippets.get(replyToId) ?? null) : null,
        attachment: hasAttachment
          ? { w: (m.attachment_w as number | null) ?? null, h: (m.attachment_h as number | null) ?? null }
          : null,
        withheld: !!(m.withheld_at as string | null),
      }
    })

  return { items, cursor: next }
}

// ---------------------------------------------------------------------------
// Per-message actions
// ---------------------------------------------------------------------------

/** The message row, with the thread's participants, for a participant check. */
async function messageWithParticipants(messageId: string) {
  const admin = createAdminClient()
  if (!admin) return null
  const { data: msg } = await admin
    .from('messages')
    .select('id, thread_id, sender_id, body, attachment_path')
    .eq('id', messageId)
    .maybeSingle()
  if (!msg) return null
  const { data: thread } = await admin
    .from('threads')
    .select('id, participant_a, participant_b')
    .eq('id', msg.thread_id as string)
    .maybeSingle()
  if (!thread) return null
  return { msg, thread, admin }
}

/**
 * Delete a message FOR THIS READER only. The row is never removed — the id is
 * appended to `deleted_for`, so the message stays for the other participant and
 * simply stops being returned to the deleter (messagePage filters it out).
 * There is no delete-for-everyone.
 */
export async function deleteMessageForMe(
  userId: string,
  messageId: string,
): Promise<{ ok: true } | Fail> {
  const found = await messageWithParticipants(messageId)
  if (!found) return { ok: false, status: 404, error: 'Message not found.' }
  const { thread, admin } = found
  if (thread.participant_a !== userId && thread.participant_b !== userId) {
    return { ok: false, status: 404, error: 'Message not found.' }
  }
  const { data: current } = await admin
    .from('messages')
    .select('deleted_for')
    .eq('id', messageId)
    .maybeSingle()
  const set = new Set<string>(((current?.deleted_for as string[] | null) ?? []).filter(Boolean))
  set.add(userId)
  const { error } = await admin
    .from('messages')
    .update({ deleted_for: [...set] })
    .eq('id', messageId)
  if (error) return { ok: false, status: 400, error: error.message }
  return { ok: true }
}

/**
 * Report a single message. Writes the message-level record (with a snapshot of
 * the body, so the admin sees exactly the reported message and never has to open
 * the thread) AND a row in the shared `reports` queue so it is worked like any
 * other report. Only a participant may report a message in their own thread.
 */
export async function reportMessage(
  userId: string,
  messageId: string,
  reason: string,
): Promise<{ ok: true; message: string } | Fail> {
  const found = await messageWithParticipants(messageId)
  if (!found) return { ok: false, status: 404, error: 'Message not found.' }
  const { msg, thread, admin } = found
  if (thread.participant_a !== userId && thread.participant_b !== userId) {
    return { ok: false, status: 404, error: 'Message not found.' }
  }

  const reportedId = (msg.sender_id as string) === userId ? null : (msg.sender_id as string)

  const { error } = await admin.from('message_reports').insert({
    message_id: messageId,
    thread_id: msg.thread_id as string,
    reporter_id: userId,
    reported_id: reportedId,
    reason,
    message_snapshot: (msg.body as string) ?? '',
  })
  if (error) return { ok: false, status: 400, error: error.message }

  // Surface it in the admin reports queue. target_id is the MESSAGE, so the
  // queue shows only the reported message — never the rest of the thread.
  await admin.from('reports').insert({
    reporter_id: userId,
    reported_id: reportedId,
    target_type: 'message',
    target_id: messageId,
    reason,
  })

  await logActivity({
    userId,
    event: 'reported',
    targetType: 'message',
    targetId: messageId,
    meta: { reason },
  })

  return { ok: true, message: 'Reported. Our team will review it.' }
}

/**
 * The path of a message's attachment, IF the caller is a participant of its
 * thread. Null otherwise — the serve route turns that into a 404, so a photo is
 * readable only inside the conversation it belongs to.
 */
export async function attachmentPathFor(
  userId: string,
  messageId: string,
): Promise<string | null> {
  const found = await messageWithParticipants(messageId)
  if (!found) return null
  const { msg, thread } = found
  if (thread.participant_a !== userId && thread.participant_b !== userId) return null
  return (msg.attachment_path as string | null) ?? null
}

// ---------------------------------------------------------------------------
// Tutor quick replies
// ---------------------------------------------------------------------------

/** A tutor's saved quick replies, in order. Empty list when none saved. */
export async function loadQuickReplies(tutorId: string): Promise<string[]> {
  const supabase = await createClient()
  const { data } = await supabase
    .from('tutor_quick_replies')
    .select('body, sort_order')
    .eq('tutor_id', tutorId)
    .order('sort_order', { ascending: true })
  return (data ?? []).map((r) => r.body as string)
}

/**
 * Replace a tutor's quick replies with a sanitised list (capped at
 * MAX_QUICK_REPLIES). Owner-scoped by RLS (tutor_id = auth.uid()).
 */
export async function saveQuickReplies(tutorId: string, list: string[]): Promise<void> {
  const supabase = await createClient()
  await supabase.from('tutor_quick_replies').delete().eq('tutor_id', tutorId)
  if (list.length === 0) return
  await supabase.from('tutor_quick_replies').insert(
    list.map((body, i) => ({ tutor_id: tutorId, body, sort_order: i })),
  )
}
