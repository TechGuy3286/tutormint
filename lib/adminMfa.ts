import 'server-only'

import { createHash, randomBytes } from 'node:crypto'
import type { SupabaseClient } from '@supabase/supabase-js'
import { createAdminClient } from '@/lib/supabase/admin'

// Two-factor for staff accounts (PR49 §2).
//
// Every account with an admin_role must set up an authenticator app (TOTP) and
// enter a code at each sign-in. Enforcement lives in the admin layout: it reads
// the session's assurance level and, when it is not AAL2, renders the enrol or
// verify screen in place of the admin panel — so there is one place that
// decides, no route to forget to protect, and the security screens cannot lock
// themselves out.
//
// GRACE. Nobody signed in when this ships is bounced mid-task: for GRACE_HOURS
// after the cutover a staff member with no factor still reaches the panel and
// enrols at their next sign-in. After that, everyone without a factor is sent to
// set one up. Enrolled staff always need a fresh code.

/** After this instant, a staff member with no factor is sent to enrol. Before
 *  it (the deploy window) they keep working — see GRACE above. ~48h. */
export const MFA_GRACE_UNTIL = new Date('2026-09-25T12:00:00.000Z')

export type MfaState = 'verified' | 'unverified' | 'none'

/**
 * Where this session stands:
 *   verified   — AAL2, a code was entered this session. Allowed.
 *   unverified — a verified factor exists but the session is only AAL1: needs a
 *                code now (the verify screen).
 *   none       — no verified factor at all: needs to enrol (the setup screen),
 *                once the grace window has passed.
 */
export async function mfaState(supabase: SupabaseClient): Promise<MfaState> {
  const { data } = await supabase.auth.mfa.getAuthenticatorAssuranceLevel()
  if (!data) return 'none'
  if (data.currentLevel === 'aal2') return 'verified'
  if (data.nextLevel === 'aal2') return 'unverified'
  return 'none'
}

export function inMfaGrace(now: number = Date.now()): boolean {
  return now < MFA_GRACE_UNTIL.getTime()
}

/** Does this account have a verified authenticator on file? Read server-side
 *  (the Auth admin API) for the self-service and Team screens, so a staff member
 *  is shown their true two-factor state without depending on their session's
 *  assurance level. */
export async function hasVerifiedFactor(userId: string): Promise<boolean> {
  const admin = createAdminClient()
  if (!admin) return false
  const { data } = await admin.auth.admin.mfa.listFactors({ userId })
  return (data?.factors ?? []).some((f) => f.status === 'verified' && f.factor_type === 'totp')
}

// ── backup codes ────────────────────────────────────────────────────────────

const CODE_COUNT = 10
/** sha256 of the normalised (upper, no spaces/dashes) code. */
export function hashBackupCode(code: string): string {
  return createHash('sha256').update(normaliseBackupCode(code)).digest('hex')
}
export function normaliseBackupCode(code: string): string {
  return (code ?? '').toUpperCase().replace(/[^A-Z0-9]/g, '')
}
/** A readable one-time code, e.g. "7F3K-9QW2" (unambiguous alphabet). */
function newBackupCode(): string {
  const alphabet = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789' // no I/O/0/1/L
  const pick = () => {
    const b = randomBytes(4)
    let s = ''
    for (let i = 0; i < 4; i++) s += alphabet[b[i] % alphabet.length]
    return s
  }
  return `${pick()}-${pick()}`
}

/**
 * Replace a staff member's backup codes with a fresh set of 10 and return the
 * plaintext ONCE (the caller shows them and never stores them). Hashed at rest.
 */
export async function regenerateBackupCodes(userId: string): Promise<string[] | null> {
  const admin = createAdminClient()
  if (!admin) return null
  const codes = Array.from({ length: CODE_COUNT }, newBackupCode)
  await admin.from('admin_backup_codes').delete().eq('user_id', userId)
  const { error } = await admin
    .from('admin_backup_codes')
    .insert(codes.map((c) => ({ user_id: userId, code_hash: hashBackupCode(c) })))
  if (error) return null
  return codes
}

/** How many unused backup codes remain (for the panel). */
export async function backupCodesLeft(userId: string): Promise<number> {
  const admin = createAdminClient()
  if (!admin) return 0
  const { count } = await admin
    .from('admin_backup_codes')
    .select('id', { count: 'exact', head: true })
    .eq('user_id', userId)
    .is('used_at', null)
  return count ?? 0
}

/** Consume one unused backup code. True if it matched. */
export async function useBackupCode(userId: string, code: string): Promise<boolean> {
  const admin = createAdminClient()
  if (!admin) return false
  const { data } = await admin
    .from('admin_backup_codes')
    .select('id')
    .eq('user_id', userId)
    .eq('code_hash', hashBackupCode(code))
    .is('used_at', null)
    .limit(1)
    .maybeSingle()
  if (!data) return false
  await admin.from('admin_backup_codes').update({ used_at: new Date().toISOString() }).eq('id', data.id)
  return true
}

/**
 * Delete every TOTP factor for a user (server side) — the shared step behind
 * "use a backup code" (self-recovery) and the owner resetting another staff
 * member. After this the account has no factor and enrols afresh next visit.
 */
export async function deleteAllFactors(userId: string): Promise<void> {
  const admin = createAdminClient()
  if (!admin) return
  const { data } = await admin.auth.admin.mfa.listFactors({ userId })
  for (const f of data?.factors ?? []) {
    await admin.auth.admin.mfa.deleteFactor({ id: f.id, userId })
  }
}
