// lib/adminAuth.ts
//
// Admin permission checks for server components and route handlers.
//
// The matrix (CLAUDE.md "Admin team hierarchy"):
//   owner    everything, plus staff management (the Team screen is T7)
//   manager  everything except Team management
//   verifier tutor moderation queue + parent verification queue only
//   finance  payments, subscriptions and quota views (read-only here in T3.5)
//   support  reports, blocks, penalties, demos -- none of the T3.5 screens
//
// 'owner' satisfies every check, so callers list the specific roles that also
// qualify and never have to remember to add owner.

import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'

export type AdminRole = 'owner' | 'manager' | 'verifier' | 'finance' | 'support'

export type AdminActor = {
  id: string
  email: string | null
  adminRole: AdminRole
}

/** The current user if they are an admin, else null. Never throws. */
export async function getAdminActor(): Promise<AdminActor | null> {
  const supabase = await createClient()

  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return null

  const { data: profile } = await supabase
    .from('profiles')
    .select('role, admin_role, email, is_suspended')
    .eq('id', user.id)
    .maybeSingle()

  if (profile?.role !== 'admin' || !profile.admin_role) return null

  // A suspended staff account keeps its admin_role -- reactivating should not
  // mean re-deciding what they were -- but stops being an admin actor here, so
  // the same check covers every screen and every mutation route at once.
  if (profile.is_suspended) return null

  return {
    id: user.id,
    email: profile.email ?? user.email ?? null,
    adminRole: profile.admin_role as AdminRole,
  }
}

export function roleSatisfies(actorRole: AdminRole, allowed: AdminRole[]): boolean {
  return actorRole === 'owner' || allowed.includes(actorRole)
}

/**
 * For SERVER COMPONENTS. Redirects rather than returning an error:
 *   not an admin at all -> '/' (the admin area is not worth advertising)
 *   an admin without the right sub-role -> '/admin', which lands them on a
 *   screen they can actually use.
 */
export async function requireAdminRole(...allowed: AdminRole[]): Promise<AdminActor> {
  const actor = await getAdminActor()
  if (!actor) redirect('/')
  if (!roleSatisfies(actor.adminRole, allowed)) redirect('/admin')
  return actor
}

/**
 * For ROUTE HANDLERS. Returns a discriminated result instead of redirecting,
 * so the caller can answer with a real status code. Every admin mutation route
 * must call this -- a role must not be able to do through the API what the UI
 * hides from it.
 */
export async function checkAdminRole(
  ...allowed: AdminRole[]
): Promise<{ ok: true; actor: AdminActor } | { ok: false; status: 401 | 403; error: string }> {
  const actor = await getAdminActor()
  if (!actor) return { ok: false, status: 401, error: 'Admin access required.' }
  if (!roleSatisfies(actor.adminRole, allowed)) {
    return { ok: false, status: 403, error: 'Your admin role cannot perform this action.' }
  }
  return { ok: true, actor }
}

/** Which of the T3.5 screens a role may open. Drives the nav and the guards. */
export const SCREEN_ACCESS = {
  tutors: ['manager', 'verifier'] as AdminRole[],
  parents: ['manager', 'verifier'] as AdminRole[],
  // finance sees the plans screen read-only; only owner/manager may mutate.
  plans: ['manager', 'finance'] as AdminRole[],
  plansMutate: ['manager'] as AdminRole[],
  // T6. Money is finance's job, so unlike the plans screen finance may both
  // read and act here. verifier and support get neither -- a verifier who
  // could approve a payment would be able to hand out plans, which is exactly
  // the separation the roles exist to create.
  payments: ['manager', 'finance'] as AdminRole[],
  paymentsMutate: ['manager', 'finance'] as AdminRole[],
  // T7a.
  //
  // `team` is an empty list on purpose, not an oversight: roleSatisfies()
  // always admits the owner, so [] reads as "owner only" without a magic
  // string. Staff management is the one thing a manager does not get.
  team: [] as AdminRole[],
  reports: ['manager', 'support'] as AdminRole[],
  // The tuition board, as staff. READ is manager + support: support answers
  // "why can nobody see my job", which cannot be done without looking at the
  // job. MUTATE stops at manager -- closing or removing somebody's tuition
  // destroys the applications attached to it and is not a first-line action.
  jobs: ['manager', 'support'] as AdminRole[],
  jobsMutate: ['manager'] as AdminRole[],
  users: ['manager', 'support'] as AdminRole[],
  audit: ['manager'] as AdminRole[],
  // Publishing a tutor's video to the world is a bigger decision than
  // approving it for review, so it stops at manager rather than verifier.
  videoVisibility: ['manager'] as AdminRole[],
  // T7b — the growth tools. All owner + manager: each of them either spends
  // the platform's reputation (ads, social posts published as us) or creates
  // accounts and deletes them, which is not a queue-worker's job.
  ads: ['manager'] as AdminRole[],
  social: ['manager'] as AdminRole[],
  import: ['manager'] as AdminRole[],
  // Deleting accounts is owner-only: it is the one admin action with no undo.
  cleanup: [] as AdminRole[],
}
