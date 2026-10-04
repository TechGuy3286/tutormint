// lib/adminAccessCore.ts
//
// PURE admin access rules — no next/navigation, no Supabase, no server-only —
// so the whole access matrix is unit-testable and client-safe. lib/adminAuth
// imports and re-exports everything here; existing callers that import from
// '@/lib/adminAuth' are unaffected.
//
// The role tree (owner, 14 Sep 2026 + PR106-H2):
//   owner           everything, plus the Team screen.
//   admin           everything except Team.
//   operations      office staff: tuitions, verifying, assisting, marketing, SEO.
//   tuitions_staff  RESTRICTED: the tuition board, Post a tuition, and Staff
//                   activity filtered to ONLY their own actions, plus their own
//                   Two-factor page and sign out. Everything else is refused on
//                   the server, not just hidden.
//
// 'owner' satisfies every check, so callers list the OTHER roles that qualify
// and never have to remember to add owner.

export type AdminRole = 'owner' | 'admin' | 'operations' | 'tuitions_staff'

export function roleSatisfies(actorRole: AdminRole, allowed: AdminRole[]): boolean {
  return actorRole === 'owner' || allowed.includes(actorRole)
}

/**
 * Where a role lands when it opens /admin, and where a refused guard sends it.
 * Most roles' home is the Overview; tuitions_staff cannot see Overview figures,
 * so its home is the tuition board. requireAdminRole() redirects here on a
 * failed check, so a refused tuitions_staff never bounces to a screen it also
 * cannot open (which would loop).
 */
export function adminHomeFor(role: AdminRole): string {
  return role === 'tuitions_staff' ? '/admin/jobs' : '/admin'
}

/**
 * Which screen each role may open. Drives the nav and the guards.
 *
 * 'admin' has FULL ACCESS EVERYWHERE EXCEPT the Team screen — so every entry
 * except `team` includes 'admin'. 'operations' is office staff and holds the
 * day-to-day subset. `team`, `paymentsSwitches` and `cleanup` are `[]`, which
 * roleSatisfies() admits ONLY for the owner. 'tuitions_staff' appears ONLY in
 * jobs/jobsPost/jobsMutate and staffActivity (self-scoped in the page), so
 * every other screen's guard fails for it.
 */
export const SCREEN_ACCESS = {
  // The Overview landing and its figures. Every full role sees it; the
  // restricted tuitions_staff does NOT (its figures are refused), so this key
  // keeps it out of that role's nav and redirects it away from /admin.
  overview: ['admin', 'operations'] as AdminRole[],
  // Verifying tutors and parents — operations' core work.
  tutors: ['admin', 'operations'] as AdminRole[],
  parents: ['admin', 'operations'] as AdminRole[],
  // Money — admin (and owner) only, never operations.
  plans: ['admin'] as AdminRole[],
  plansMutate: ['admin'] as AdminRole[],
  payments: ['admin'] as AdminRole[],
  paymentsApprove: ['admin'] as AdminRole[],
  paymentsSettings: ['admin'] as AdminRole[],
  // Opening checkout to ALL members is an owner decision. `[]` = owner only.
  paymentsSwitches: [] as AdminRole[],
  // Staff management is the ONE thing an Admin does not get. `[]` = owner only.
  team: [] as AdminRole[],
  reports: ['admin', 'operations'] as AdminRole[],
  inbox: ['admin', 'operations'] as AdminRole[],
  // The tuition board. Operations and the restricted tuitions_staff work it
  // day-to-day. MUTATE is close / pause / resume / unfeature — nothing is
  // deleted (PR49 §4), so it is safe for tuitions_staff too (the role's whole
  // job is managing tuitions, which the owner's spec grants close/reopen).
  jobs: ['admin', 'operations', 'tuitions_staff'] as AdminRole[],
  jobsMutate: ['admin', 'tuitions_staff'] as AdminRole[],
  jobsPost: ['admin', 'operations', 'tuitions_staff'] as AdminRole[],
  users: ['admin', 'operations'] as AdminRole[],
  // Staff performance. Management view (admin/owner), plus tuitions_staff for
  // ITS OWN activity only — the page and detail route force the id to the actor
  // for this role, so it can never read another staff member's.
  staffActivity: ['admin', 'tuitions_staff'] as AdminRole[],
  orphans: ['admin', 'operations'] as AdminRole[],
  signups: ['admin', 'operations'] as AdminRole[],
  usersExport: ['admin'] as AdminRole[],
  audit: ['admin'] as AdminRole[],
  seo: ['admin', 'operations'] as AdminRole[],
  videoVisibility: ['admin'] as AdminRole[],
  tutorSlug: ['admin'] as AdminRole[],
  tutorEdit: ['admin', 'operations'] as AdminRole[],
  ads: ['admin', 'operations'] as AdminRole[],
  social: ['admin', 'operations'] as AdminRole[],
  import: ['admin', 'operations'] as AdminRole[],
  // Permanent junk-account deletion — the one admin action with no undo — is
  // OWNER ONLY. `[]` = owner and nobody else.
  cleanup: [] as AdminRole[],
  blog: ['admin', 'operations'] as AdminRole[],
  blogPublish: ['admin', 'operations'] as AdminRole[],
  blogQueue: ['admin', 'operations'] as AdminRole[],
  blogGenerate: ['admin', 'operations'] as AdminRole[],
}
