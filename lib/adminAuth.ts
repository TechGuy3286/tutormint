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
//
// tuitions_staff (owner, PR106-H2) — a RESTRICTED role: the tuition board, Post
// a tuition, and Staff activity filtered to ONLY their own actions, plus their
// own Two-factor page and sign out. Everything else is refused on the SERVER,
// not just hidden. It is in SCREEN_ACCESS only for jobs/jobsPost/jobsMutate and
// staffActivity (self-scoped in the page), so every other screen's guard fails
// for it exactly as it does for a role that was never listed.

import { headers } from 'next/headers'
import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import {
  type AdminRole,
  roleSatisfies,
  adminHomeFor,
  isReadOnlyRole,
  roleBadge,
  seesRealRoles,
  ROLE_LABEL,
  SCREEN_ACCESS,
} from '@/lib/adminAccessCore'
import { METHOD_HEADER, isReadMethod } from '@/lib/requestMethod'

// The pure access matrix lives in lib/adminAccessCore (no server imports, so it
// is unit-testable). Re-exported here so every existing `@/lib/adminAuth`
// importer is unchanged.
export { type AdminRole, roleSatisfies, adminHomeFor, isReadOnlyRole, roleBadge, seesRealRoles, ROLE_LABEL, SCREEN_ACCESS }

/** The words a Partner sees when a write is refused. */
export const PARTNER_READ_ONLY = 'Partner accounts are view-only. This change was not made.'

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

/**
 * For SERVER COMPONENTS. Redirects rather than returning an error:
 *   not an admin at all -> '/' (the admin area is not worth advertising)
 *   an admin without the right sub-role -> the role's home (adminHomeFor),
 *   with ?denied=1 so the destination can say so in words.
 */
export async function requireAdminRole(...allowed: AdminRole[]): Promise<AdminActor> {
  const actor = await getAdminActor()
  if (!actor) redirect('/')
  if (!roleSatisfies(actor.adminRole, allowed)) {
    // Land them on a screen they CAN open (per role), and flag it so the
    // destination can say "You don't have access to this page." in words.
    redirect(`${adminHomeFor(actor.adminRole)}?denied=1`)
  }
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
  return checkAdmin(allowed, { self: false })
}

/**
 * For the routes where a staff member manages their OWN two-factor (backup
 * codes, the lost-phone path). A Partner must be able to set up two-factor —
 * it is required of them — so these are the only writes a Partner may make,
 * and they need no verified session (they are how one becomes verified).
 */
export async function checkAdminSelf(
  ...allowed: AdminRole[]
): Promise<{ ok: true; actor: AdminActor } | { ok: false; status: 401 | 403; error: string }> {
  return checkAdmin(allowed, { self: true })
}

/** Was this request a GET or HEAD? proxy.ts stamps the real method on every
 *  request (overwriting anything the client sent); a missing stamp reads as a
 *  write, so the Partner rule fails closed. */
async function isReadRequest(): Promise<boolean> {
  try {
    return isReadMethod((await headers()).get(METHOD_HEADER))
  } catch {
    return false
  }
}

async function checkAdmin(
  allowed: AdminRole[],
  opts: { self: boolean },
): Promise<{ ok: true; actor: AdminActor } | { ok: false; status: 401 | 403; error: string }> {
  const actor = await getAdminActor()
  if (!actor) return { ok: false, status: 401, error: 'Admin access required.' }
  if (!roleSatisfies(actor.adminRole, allowed)) {
    return { ok: false, status: 403, error: 'Your admin role cannot perform this action.' }
  }
  if (isReadOnlyRole(actor.adminRole) && !opts.self) {
    // Partner (owner, 8 Oct 2026): view-only everywhere, and only with
    // two-factor on. Reads (GET/HEAD — pages' data, downloads) pass; every
    // other method is refused here, whatever the route.
    if (!(await isReadRequest())) return { ok: false, status: 403, error: PARTNER_READ_ONLY }
    const { mfaState } = await import('@/lib/adminMfa')
    const supabase = await createClient()
    if ((await mfaState(supabase)) !== 'verified') {
      return { ok: false, status: 403, error: 'Set up two-factor first, then try again.' }
    }
  }
  return { ok: true, actor }
}

