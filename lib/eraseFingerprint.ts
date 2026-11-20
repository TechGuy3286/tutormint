import 'server-only'

// lib/eraseFingerprint.ts — the I/O of lib/eraseFingerprintCore (owner, 20 Nov
// 2026 — PR-11). Service role throughout.
//
//   recordErasedFingerprints() — runErase, before any personal data goes
//   checkErasedBlock()         — sign-up, mobile verification, CNIC number
//   loadBlockedSignups()       — the Owner's "Blocked re-sign-ups" list
//   allowBlocked() / undoAllow() / keepBlocked() — the Owner's actions
//   blockedSignupsTodo()       — the Overview to-do count
//
// Nothing here ever logs or returns a number or a fingerprint.

import { createAdminClient } from '@/lib/supabase/admin'
import { logAdminAction } from '@/lib/auditLog'
import { notify } from '@/lib/notifications'
import { loadSupportWhatsApp } from '@/lib/applicationTemplates'
import type { AdminRole } from '@/lib/adminAccessCore'
import {
  accountFingerprints,
  BLOCKED_SIGNUPS_HREF,
  FINGERPRINT_ENV,
  runBlockCheck,
  skippedNote,
  todoCount,
  usableSecret,
  type BlockCheck,
  type BlockStep,
  type BlockStore,
  type FingerprintKind,
} from '@/lib/eraseFingerprintCore'

type Admin = NonNullable<ReturnType<typeof createAdminClient>>

export { BLOCKED_SIGNUPS_HREF }

/** The key, or null when the env var is not set (the erase then skips it). */
export function fingerprintSecret(): string | null {
  return usableSecret(process.env[FINGERPRINT_ENV])
}

export type RecordResult = { stored: number; note: string | null }

/**
 * Store the fingerprints of an account that is being erased. Called BEFORE
 * the numbers are cleared; idempotent (a retry after a failed run adds nothing
 * twice). Never fails the erase: no key → nothing stored and a note naming the
 * env var; a database error → the note says so.
 */
export async function recordErasedFingerprints(
  admin: Admin,
  args: { memberId: string; erasureId: string; erasedAtIso: string; mobiles: (string | null | undefined)[]; cnic: string | null | undefined },
): Promise<RecordResult> {
  const secret = fingerprintSecret()
  if (!secret) {
    console.warn(`[erase] re-sign-up block skipped: ${FINGERPRINT_ENV} is not set`)
    await bellOwner(admin, {
      title: 'An erase ran without the re-sign-up block',
      body: `Add ${FINGERPRINT_ENV} in Vercel (production) so erased numbers cannot sign up again.`,
      href: BLOCKED_SIGNUPS_HREF,
    }).catch(() => 0)
    return { stored: 0, note: skippedNote() }
  }
  const fps = accountFingerprints({ mobiles: args.mobiles, cnic: args.cnic }, secret)
  if (fps.length === 0) return { stored: 0, note: null }
  const { error } = await admin.from('erased_fingerprints').upsert(
    fps.map((f) => ({ kind: f.kind, fingerprint: f.fingerprint, member_id: args.memberId, erasure_id: args.erasureId, erased_at: args.erasedAtIso })),
    { onConflict: 'kind,fingerprint,member_id', ignoreDuplicates: true },
  )
  if (error) {
    console.error('[erase] re-sign-up block not stored:', error.message)
    return { stored: 0, note: 'not stored — database error' }
  }
  return { stored: fps.length, note: null }
}

/** The bell for the Owner alone (the Partner is not alerted). */
async function bellOwner(admin: Admin, n: { title: string; body: string; href: string }): Promise<void> {
  const { data } = await admin.from('profiles').select('id').eq('role', 'admin').eq('admin_role', 'owner').limit(1).maybeSingle()
  if (data?.id) await notify({ userId: data.id as string, kind: 'staff_alert', title: n.title, body: n.body, href: n.href })
}

/** The database side of runBlockCheck. */
function dbStore(admin: Admin): BlockStore {
  return {
    async findBlocked(kind, fp) {
      const { data, error } = await admin
        .from('erased_fingerprints')
        .select('id, erased_at')
        .eq('kind', kind)
        .eq('fingerprint', fp)
        .is('allowed_at', null)
        .order('erased_at', { ascending: false })
        .limit(1)
      if (error || !data || data.length === 0) return null
      return { id: data[0].id as string, erasedAt: data[0].erased_at as string }
    },
    async recentAttempts(fingerprintId, sinceIso) {
      const { count } = await admin.from('signup_block_attempts').select('id', { count: 'exact', head: true }).eq('fingerprint_id', fingerprintId).gte('created_at', sinceIso)
      return count ?? 0
    },
    async addAttempt(a) {
      await admin.from('signup_block_attempts').insert({ kind: a.kind, step: a.step, last2: a.last2, fingerprint_id: a.fingerprintId })
    },
    bellOwner: (n) => bellOwner(admin, n).catch(() => undefined),
    supportWhatsapp: () => loadSupportWhatsApp(admin),
  }
}

/**
 * Is this mobile / CNIC one of an erased account that the Owner has not
 * allowed? (lib/eraseFingerprintCore runBlockCheck.) Fails open — a sign-up is
 * never refused on a guess.
 */
export async function checkErasedBlock(kind: FingerprintKind, raw: string | null | undefined, step: BlockStep): Promise<BlockCheck> {
  const secret = fingerprintSecret()
  if (!secret) return { blocked: false }
  const admin = createAdminClient()
  if (!admin) return { blocked: false }
  try {
    return await runBlockCheck(dbStore(admin), { kind, raw, step, secret, nowMs: Date.now() })
  } catch {
    return { blocked: false }
  }
}

export type BlockedSignupRow = {
  id: string
  at: string
  kind: FingerprintKind
  step: BlockStep
  last2: string
  erasedAt: string
  fingerprintId: string
  allowed: boolean
  allowedAt: string | null
  allowReason: string | null
  reviewedAt: string | null
}

export async function loadBlockedSignups(limit = 300): Promise<BlockedSignupRow[]> {
  const admin = createAdminClient()
  if (!admin) return []
  const { data } = await admin
    .from('signup_block_attempts')
    .select('id, created_at, kind, step, last2, reviewed_at, fingerprint_id, erased_fingerprints(erased_at, allowed_at, allow_reason)')
    .order('created_at', { ascending: false })
    .limit(Math.min(limit, 1000))
  return ((data ?? []) as unknown as {
    id: string
    created_at: string
    kind: FingerprintKind
    step: BlockStep
    last2: string
    reviewed_at: string | null
    fingerprint_id: string
    erased_fingerprints: { erased_at: string; allowed_at: string | null; allow_reason: string | null } | null
  }[]).map((r) => ({
    id: r.id,
    at: r.created_at,
    kind: r.kind,
    step: r.step,
    last2: r.last2,
    erasedAt: r.erased_fingerprints?.erased_at ?? r.created_at,
    fingerprintId: r.fingerprint_id,
    allowed: !!r.erased_fingerprints?.allowed_at,
    allowedAt: r.erased_fingerprints?.allowed_at ?? null,
    allowReason: r.erased_fingerprints?.allow_reason ?? null,
    reviewedAt: r.reviewed_at,
  }))
}

/** "Blocked re-sign-ups: N" — unreviewed attempts whose number is still blocked. */
export async function blockedSignupsTodo(): Promise<BlockedSignupRow[]> {
  return (await loadBlockedSignups(1000)).filter((r) => todoCount([r]) === 1)
}

type Actor = { id: string; adminRole: AdminRole; email?: string | null }
type ActionResult = { ok: true } | { ok: false; status: number; error: string }

/** The fingerprint row behind one attempt, with its siblings (the same number
 *  on another erased account is the same person's number — allowed together). */
async function siblingsOf(admin: Admin, attemptId: string): Promise<{ ids: string[]; kind: FingerprintKind } | null> {
  const { data: a } = await admin.from('signup_block_attempts').select('fingerprint_id, kind').eq('id', attemptId).maybeSingle()
  if (!a) return null
  const { data: fp } = await admin.from('erased_fingerprints').select('kind, fingerprint').eq('id', a.fingerprint_id as string).maybeSingle()
  if (!fp) return null
  const { data: all } = await admin.from('erased_fingerprints').select('id').eq('kind', fp.kind as string).eq('fingerprint', fp.fingerprint as string)
  return { ids: ((all ?? []) as { id: string }[]).map((r) => r.id), kind: fp.kind as FingerprintKind }
}

/** Allow: the person can sign up with that number again. Reason required. */
export async function allowBlocked(attemptId: string, reason: string, actor: Actor): Promise<ActionResult> {
  const admin = createAdminClient()
  if (!admin) return { ok: false, status: 503, error: 'This is not working right now. Please try again in a few minutes.' }
  const sib = await siblingsOf(admin, attemptId)
  if (!sib) return { ok: false, status: 404, error: 'That blocked attempt was not found. Reload the page.' }
  const now = new Date().toISOString()
  const { error } = await admin
    .from('erased_fingerprints')
    .update({ allowed_at: now, allowed_by: actor.id, allow_reason: reason.trim() })
    .in('id', sib.ids)
    .is('allowed_at', null)
  if (error) return { ok: false, status: 400, error: 'That did not save. Please try again.' }
  await logAdminAction({
    actorId: actor.id,
    actorRole: actor.adminRole,
    actorEmail: actor.email ?? null,
    action: 'signup_block.allow',
    targetType: 'signup_block_attempt',
    targetId: attemptId,
    detail: { kind: sib.kind, reason: reason.trim(), rows: sib.ids.length },
  })
  return { ok: true }
}

/** Undo an Allow: the number is blocked again. */
export async function undoAllow(attemptId: string, actor: Actor): Promise<ActionResult> {
  const admin = createAdminClient()
  if (!admin) return { ok: false, status: 503, error: 'This is not working right now. Please try again in a few minutes.' }
  const sib = await siblingsOf(admin, attemptId)
  if (!sib) return { ok: false, status: 404, error: 'That blocked attempt was not found. Reload the page.' }
  const { error } = await admin.from('erased_fingerprints').update({ allowed_at: null, allowed_by: null, allow_reason: null }).in('id', sib.ids)
  if (error) return { ok: false, status: 400, error: 'That did not save. Please try again.' }
  await logAdminAction({
    actorId: actor.id,
    actorRole: actor.adminRole,
    actorEmail: actor.email ?? null,
    action: 'signup_block.allow_undone',
    targetType: 'signup_block_attempt',
    targetId: attemptId,
    detail: { kind: sib.kind, rows: sib.ids.length },
  })
  return { ok: true }
}

/** Keep blocked: the attempts for this number leave the to-do (still blocked). */
export async function keepBlocked(attemptId: string, actor: Actor): Promise<ActionResult> {
  const admin = createAdminClient()
  if (!admin) return { ok: false, status: 503, error: 'This is not working right now. Please try again in a few minutes.' }
  const sib = await siblingsOf(admin, attemptId)
  if (!sib) return { ok: false, status: 404, error: 'That blocked attempt was not found. Reload the page.' }
  const { error } = await admin
    .from('signup_block_attempts')
    .update({ reviewed_at: new Date().toISOString(), reviewed_by: actor.id })
    .in('fingerprint_id', sib.ids)
    .is('reviewed_at', null)
  if (error) return { ok: false, status: 400, error: 'That did not save. Please try again.' }
  await logAdminAction({
    actorId: actor.id,
    actorRole: actor.adminRole,
    actorEmail: actor.email ?? null,
    action: 'signup_block.keep',
    targetType: 'signup_block_attempt',
    targetId: attemptId,
    detail: { kind: sib.kind },
  })
  return { ok: true }
}
