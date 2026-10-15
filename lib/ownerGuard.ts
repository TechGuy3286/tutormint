import 'server-only'

// lib/ownerGuard.ts
//
// OWNER PROTECTION on the server (owner, 13 Oct 2026). Every admin route that
// changes a member account calls refuseOwnerTarget() before it writes: nobody
// except the Owner may edit, pause, suspend, warn, ban or remove the Owner
// account, or change its password, email, mobile number or two-factor. The rule
// itself is pure (lib/adminAccessCore.ownerProtection); this file only reads the
// target's role and answers 403.

import { NextResponse } from 'next/server'

import { createAdminClient } from '@/lib/supabase/admin'
import { canApprove, OWNER_ONLY_APPROVAL, ownerProtection, type AdminRole } from '@/lib/adminAccessCore'
import { alertOwnerBlocked } from '@/lib/ownerAlerts'

/**
 * OWNER-ONLY APPROVALS (owner, 15 Oct 2026). Every approval route calls this
 * after its view gate and before it writes: a 403 for anyone but the Owner,
 * and the Owner is told of the attempt (bell + email + Audit). `what` says what
 * was tried, in words: "approve a tutor's CNIC".
 */
export async function refuseUnlessOwnerApproval(
  actor: { id: string; adminRole: AdminRole; email?: string | null },
  what: string,
  targetId?: string | null,
): Promise<NextResponse | null> {
  if (canApprove(actor.adminRole)) return null
  await alertOwnerBlocked({
    actor: { id: actor.id, adminRole: actor.adminRole, email: actor.email ?? null },
    problem: OWNER_ONLY_APPROVAL,
    what,
    targetId,
  })
  return NextResponse.json({ error: OWNER_ONLY_APPROVAL }, { status: 403 })
}

/** The target's staff role, or null for an ordinary member / unknown id. */
export async function staffRoleOf(userId: string | null | undefined): Promise<string | null> {
  if (!userId) return null
  const admin = createAdminClient()
  if (!admin) return null
  const { data } = await admin.from('profiles').select('role, admin_role').eq('id', userId).maybeSingle()
  return data?.role === 'admin' ? ((data.admin_role as string | null) ?? null) : null
}

/** The refusal in words, or null when this actor may change that account. */
export async function ownerTargetProblem(
  actor: { id: string; adminRole: AdminRole },
  targetId: string | null | undefined,
): Promise<string | null> {
  if (!targetId || actor.adminRole === 'owner') return null
  return ownerProtection(actor.adminRole, await staffRoleOf(targetId))
}

/**
 * A 403 response when the target is the Owner and the actor is not; else null.
 * A refusal also tells the Owner (bell + email + Audit; owner, 15 Oct 2026) —
 * `what` says what was tried, in words.
 */
export async function refuseOwnerTarget(
  actor: { id: string; adminRole: AdminRole; email?: string | null },
  targetId: string | null | undefined,
  what = 'change the Owner account',
): Promise<NextResponse | null> {
  const problem = await ownerTargetProblem(actor, targetId)
  if (!problem) return null
  await alertOwnerBlocked({ actor: { id: actor.id, adminRole: actor.adminRole, email: actor.email ?? null }, problem, what, targetId })
  return NextResponse.json({ error: problem }, { status: 403 })
}
