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
import { ownerProtection, type AdminRole } from '@/lib/adminAccessCore'

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

/** A 403 response when the target is the Owner and the actor is not; else null. */
export async function refuseOwnerTarget(
  actor: { id: string; adminRole: AdminRole },
  targetId: string | null | undefined,
): Promise<NextResponse | null> {
  const problem = await ownerTargetProblem(actor, targetId)
  return problem ? NextResponse.json({ error: problem }, { status: 403 }) : null
}
