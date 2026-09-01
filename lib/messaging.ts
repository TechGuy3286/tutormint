// lib/messaging.ts
//
// Threads and messages.
//
// Who may START a conversation (the rest is reply-only):
//
//   * any verified parent, with any tutor, with or without a job attached
//     (the FINAL parent model supersedes the original matrix here -- messaging
//     is what a free verified parent gets; contact details and hiring are what
//     Featured adds)
//   * a tutor on premium or featured
//   * a verified-plan or free tutor may reply but never open a thread
//
// Replying is always allowed to an existing participant, whatever the plan.
// Both directions are refused between a blocked pair, and neither side is told
// which of them did the blocking.
//
// Bodies are stored verbatim and masked on the way out -- see lib/masking.ts.

import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { getEntitlements } from '@/lib/entitlements'
import { renderMessageBody } from '@/lib/masking'
import { logActivity } from '@/lib/activityLog'
import { consumeQuota } from '@/lib/quota'
import { upgradeHref } from '@/lib/upgradePath'
import { notify } from '@/lib/notifications'

export type ThreadSummary = {
  id: string
  jobId: string | null
  jobTitle: string | null
  otherId: string
  otherName: string
  otherRole: string | null
  lastMessageAt: string | null
  preview: string
  unread: boolean
}

export type ThreadMessage = {
  id: string
  senderId: string
  mine: boolean
  body: string
  masked: boolean
  createdAt: string
}

type Fail = { ok: false; status: number; error: string; upgrade?: string }

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
    }
  }

  if (ent.audience === 'parent') {
    if (!ent.plan) {
      return {
        ok: false,
        status: 403,
        error: 'Verify your CNIC and address before messaging tutors.',
        upgrade: '/parent/verify',
      }
    }
    return { ok: true }
  }

  if (ent.audience === 'tutor') {
    if (!ent.canInitiateMessage) {
      return {
        ok: false,
        status: 403,
        error:
          'Your plan lets you reply to parents and apply for jobs. Upgrade to Premium to start a conversation.',
        upgrade: upgradeHref('tutor', ent.plan, 'premium'),
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
}): Promise<{ ok: true; messageId: string } | Fail> {
  const body = params.body.trim()
  if (!body) return { ok: false, status: 400, error: 'Write something first.' }
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

  const other = thread.participant_a === me ? thread.participant_b : thread.participant_a

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
      .select('is_suspended')
      .eq('id', me)
      .maybeSingle()
    if (sender?.is_suspended) {
      return { ok: false, status: 403, error: 'Your account is suspended. Contact support.' }
    }
  }

  const { data: created, error } = await supabase
    .from('messages')
    .insert({
      thread_id: thread.id,
      sender_id: me,
      body,
      // Legacy NOT NULL columns, mirrored until T8 removes them.
      job_id: (thread.job_id as string) ?? '',
      sender: me,
      recipient: other,
      message: body,
    })
    .select('id')
    .single()

  if (error) return { ok: false, status: 400, error: error.message }

  if (admin) {
    await admin
      .from('threads')
      .update({ last_message_at: new Date().toISOString() })
      .eq('id', thread.id)
  }

  // The event records the thread id and nothing else -- message content never
  // enters the activity log.
  await logActivity({
    userId: me,
    event: 'message_sent',
    targetType: 'thread',
    targetId: thread.id as string,
  })

  await notify({
    userId: other,
    kind: 'message_received',
    title: 'New message',
    body: 'You have a new message on TutorMint.',
    href: `/messages/${thread.id}`,
  })

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

/** Every conversation a member is in, newest activity first. */
export async function listThreads(userId: string): Promise<ThreadSummary[]> {
  const supabase = await createClient()

  const { data: threads } = await supabase
    .from('threads')
    .select('id, job_id, participant_a, participant_b, created_at, last_message_at')
    .or(`participant_a.eq.${userId},participant_b.eq.${userId}`)
    .order('last_message_at', { ascending: false, nullsFirst: false })
    .order('created_at', { ascending: false })

  if (!threads || threads.length === 0) return []

  const admin = createAdminClient()
  const otherIds = threads.map((t) =>
    t.participant_a === userId ? (t.participant_b as string) : (t.participant_a as string),
  )
  const jobIds = threads.map((t) => t.job_id as string | null).filter(Boolean) as string[]

  // Names come through the service-role client: `profiles` is self-read only,
  // so a member cannot read the name of the person they are talking to with
  // their own client. Only the display name and role cross over.
  const names = new Map<string, { name: string; role: string | null }>()
  if (admin && otherIds.length > 0) {
    const { data: people } = await admin
      .from('profiles')
      .select('id, full_name, role')
      .in('id', otherIds)
    for (const p of people ?? []) {
      names.set(p.id as string, {
        name: (p.full_name as string) ?? 'TutorMint member',
        role: (p.role as string) ?? null,
      })
    }
  }

  const jobTitles = new Map<string, string>()
  if (jobIds.length > 0) {
    const { data: jobs } = await supabase.from('jobs').select('id, title').in('id', jobIds)
    for (const j of jobs ?? []) jobTitles.set(j.id as string, (j.title as string) ?? 'Tuition')
  }

  // One preview query rather than one per thread.
  const previews = new Map<string, { body: string; senderId: string }>()
  if (admin) {
    const { data: recent } = await admin
      .from('messages')
      .select('thread_id, body, sender_id, created_at')
      .in(
        'thread_id',
        threads.map((t) => t.id as string),
      )
      .order('created_at', { ascending: false })
    for (const m of recent ?? []) {
      const key = m.thread_id as string
      if (!previews.has(key)) {
        previews.set(key, { body: (m.body as string) ?? '', senderId: m.sender_id as string })
      }
    }
  }

  const out: ThreadSummary[] = []
  for (const t of threads) {
    const otherId = t.participant_a === userId ? (t.participant_b as string) : (t.participant_a as string)
    const preview = previews.get(t.id as string)
    const mayShare = preview ? await pairMayShareContact(userId, otherId) : false
    const rendered = renderMessageBody(preview?.body ?? '', mayShare)

    out.push({
      id: t.id as string,
      jobId: (t.job_id as string) ?? null,
      jobTitle: t.job_id ? (jobTitles.get(t.job_id as string) ?? null) : null,
      otherId,
      otherName: names.get(otherId)?.name ?? 'TutorMint member',
      otherRole: names.get(otherId)?.role ?? null,
      lastMessageAt: (t.last_message_at as string) ?? (t.created_at as string),
      preview: rendered.text.slice(0, 120),
      unread: false,
    })
  }

  return out
}
