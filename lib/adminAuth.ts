// lib/adminAuth.ts
//
// Admin permission checks for server components and route handlers.
//
// The role tree (owner, 14 Sep 2026) — exactly three roles:
//   owner       everything, plus staff management (the Team screen). Cannot be
//               demoted or suspended; transfer of ownership is a DB operation.
//   admin       full access EVERYWHERE except the Team screen.
//   operations  office staff: posting tuitions, verifying tutors and parents,
//               assisting, marketing, SEO. Absorbed the deleted Support role.
//
// 'manager' was renamed to 'admin' and 'support' + 'finance' were deleted
// (migrations 83, 84). 'owner' satisfies every check, so callers list the
// specific roles that also qualify and never have to remember to add owner.

import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'

export type AdminRole = 'owner' | 'admin' | 'operations'

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

/**
 * Which screen each role may open. Drives the nav and the guards.
 *
 * The tree (owner, 14 Sep 2026): 'admin' has FULL ACCESS EVERYWHERE EXCEPT the
 * Team screen — so every entry below except `team` includes 'admin'.
 * 'operations' is office staff (posting tuitions, verifying, assisting,
 * marketing, SEO) and holds the day-to-day subset. `team` is `[]`, which
 * roleSatisfies() admits ONLY for the owner — so an Admin cannot open Team, add
 * staff, change a role or remove anyone, enforced here, not just in the nav.
 */
export const SCREEN_ACCESS = {
  // Verifying tutors and parents — operations' core work.
  tutors: ['admin', 'operations'] as AdminRole[],
  parents: ['admin', 'operations'] as AdminRole[],
  // Money — admin (and owner) only, never operations.
  plans: ['admin'] as AdminRole[],
  plansMutate: ['admin'] as AdminRole[],
  payments: ['admin'] as AdminRole[],
  paymentsMutate: ['admin'] as AdminRole[],
  // Staff management is the ONE thing an Admin does not get. `[]` +
  // roleSatisfies() = owner only, with no magic string.
  team: [] as AdminRole[],
  // Assisting — reports, the Team inbox, the member directory and its worklists.
  reports: ['admin', 'operations'] as AdminRole[],
  inbox: ['admin', 'operations'] as AdminRole[],
  // The tuition board. Operations posts and works it day-to-day; MUTATE
  // (closing/removing a tuition, which destroys its applications) stays admin.
  jobs: ['admin', 'operations'] as AdminRole[],
  jobsMutate: ['admin'] as AdminRole[],
  jobsPost: ['admin', 'operations'] as AdminRole[],
  users: ['admin', 'operations'] as AdminRole[],
  orphans: ['admin', 'operations'] as AdminRole[],
  signups: ['admin', 'operations'] as AdminRole[],
  // Exporting the directory carries mobile numbers off the platform — admin
  // only, and audit-logged.
  usersExport: ['admin'] as AdminRole[],
  audit: ['admin'] as AdminRole[],
  // SEO — operations' work (landing pages, locations).
  seo: ['admin', 'operations'] as AdminRole[],
  // Publishing a tutor's video / moving a public URL are irreversible SEO
  // decisions — admin only, above the verifying operations does.
  videoVisibility: ['admin'] as AdminRole[],
  tutorSlug: ['admin'] as AdminRole[],
  // Marketing — ads, social posts and bulk onboarding are operations' work.
  ads: ['admin', 'operations'] as AdminRole[],
  social: ['admin', 'operations'] as AdminRole[],
  import: ['admin', 'operations'] as AdminRole[],
  // Permanent junk-account deletion is the one admin action with NO undo, so it
  // is OWNER ONLY (owner PR12 §2.4, restoring the T7b rule — this supersedes the
  // 14 Sep note that made it admin). `[]` + roleSatisfies() = owner and nobody
  // else, the same pattern as `team`; the cleanup route and the /admin/users
  // "suspicious" filter both read this key, so an Admin gets neither the UI nor
  // the DELETE.
  cleanup: [] as AdminRole[],
  // The blog CMS — SEO/marketing content, operations' work end to end.
  blog: ['admin', 'operations'] as AdminRole[],
  blogPublish: ['admin', 'operations'] as AdminRole[],
  blogQueue: ['admin', 'operations'] as AdminRole[],
  blogGenerate: ['admin', 'operations'] as AdminRole[],
}
