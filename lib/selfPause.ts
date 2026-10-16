// lib/selfPause.ts
//
// "Pause my account" (owner, 8 Oct 2026) — the server half. The rules live in
// lib/selfPauseCore.ts. Service role: profiles.paused_by_user_at and
// jobs.self_paused_at are not member-writable (migration 103's deny-by-default
// column grants), so every change goes through here and is logged twice — the
// member's timeline (logActivity) and the Audit log.
//
// PAUSE: the account is hidden (tutor_directory excludes a self-paused tutor,
// so Browse, search, landing pages, the shortlist and the sitemap drop them;
// the profile page renders with noindex), a parent's OPEN tuitions are paused
// and marked self_paused_at, and every session on every device is revoked.
// Nothing is deleted.
//
// RESTORE: on the next successful sign-in, if staff have not suspended or
// banned the account. A parent's self-paused tuitions stay paused; the parent
// dashboard offers a one-tap Reopen.

import 'server-only'

import { createAdminClient } from '@/lib/supabase/admin'
import { logActivity } from '@/lib/activityLog'
import { logAdminAction } from '@/lib/auditLog'
import { revalidateLanding } from '@/lib/landingRevalidate'
import { queueIndexingUpdate } from '@/lib/googleIndexing'
import type { AdminRole } from '@/lib/adminAuth'
import { pauseRefusal, shouldRestoreOnSignIn, type PauseFacts } from '@/lib/selfPauseCore'

// The Audit log's actor_role column is text; a member acting on their own
// account is recorded as 'member' (never an admin role).
const MEMBER = 'member' as unknown as AdminRole

async function facts(id: string): Promise<(PauseFacts & { email: string | null }) | null> {
  const admin = createAdminClient()
  if (!admin) return null
  const { data } = await admin
    .from('profiles')
    .select('role, is_suspended, is_banned, paused_by_user_at, email')
    .eq('id', id)
    .maybeSingle()
  if (!data) return null
  return {
    role: (data.role as string | null) ?? null,
    isSuspended: !!data.is_suspended,
    isBanned: !!data.is_banned,
    pausedByUserAt: (data.paused_by_user_at as string | null) ?? null,
    email: (data.email as string | null) ?? null,
  }
}

export async function pauseMyAccount(
  userId: string,
): Promise<{ ok: true; tuitionsPaused: number } | { ok: false; status: number; error: string }> {
  const admin = createAdminClient()
  if (!admin) return { ok: false, status: 503, error: 'This is not working right now. Please try again in a few minutes.' }
  const f = await facts(userId)
  if (!f) return { ok: false, status: 404, error: 'Account not found.' }
  const refusal = pauseRefusal(f)
  if (refusal) return { ok: false, status: 403, error: refusal }

  const now = new Date().toISOString()
  const { error } = await admin.from('profiles').update({ paused_by_user_at: now }).eq('id', userId).is('paused_by_user_at', null)
  if (error) return { ok: false, status: 500, error: 'That did not save. Please try again.' }

  // A parent's open tuitions are paused with them, and remembered as such.
  let paused: { id: string; public_slug: string | null; city: string | null }[] = []
  if (f.role !== 'tutor') {
    const { data } = await admin
      .from('jobs')
      .update({ status: 'paused', paused_at: now, self_paused_at: now, pause_source: 'self' })
      .eq('parent_id', userId)
      .eq('status', 'open')
      .select('id, public_slug, city')
    paused = (data ?? []) as typeof paused
    for (const j of paused) queueIndexingUpdate(j)
  }
  revalidateLanding()

  await logActivity({ userId, event: 'account_self_paused', meta: { tuitionsPaused: paused.length } })
  await logAdminAction({
    actorId: userId,
    actorRole: MEMBER,
    actorEmail: f.email,
    action: 'member.self_pause',
    targetType: 'profile',
    targetId: userId,
    detail: { tuitionsPaused: paused.length },
  })

  // Signed out on every device. The caller also signs this browser out.
  await admin.rpc('revoke_user_sessions', { uid: userId })
  return { ok: true, tuitionsPaused: paused.length }
}

/** Called after every successful sign-in. True when the account was restored. */
export async function restoreSelfPauseOnSignIn(userId: string): Promise<boolean> {
  const admin = createAdminClient()
  if (!admin) return false
  const f = await facts(userId)
  if (!f || !shouldRestoreOnSignIn(f)) return false
  const { data } = await admin
    .from('profiles')
    .update({ paused_by_user_at: null })
    .eq('id', userId)
    .not('paused_by_user_at', 'is', null)
    .eq('is_suspended', false)
    .eq('is_banned', false)
    .select('id')
  if (!data || data.length === 0) return false
  revalidateLanding()
  await logActivity({ userId, event: 'account_self_restored', meta: { pausedAt: f.pausedByUserAt } })
  await logAdminAction({
    actorId: userId,
    actorRole: MEMBER,
    actorEmail: f.email,
    action: 'member.self_restore',
    targetType: 'profile',
    targetId: userId,
    detail: { pausedAt: f.pausedByUserAt },
  })
  return true
}

/** Is this member self-paused (refuse new messages and demo requests)? */
export async function memberUnavailable(id: string): Promise<boolean> {
  const admin = createAdminClient()
  if (!admin) return false
  const { data } = await admin.from('profiles').select('paused_by_user_at').eq('id', id).maybeSingle()
  return !!data?.paused_by_user_at
}
