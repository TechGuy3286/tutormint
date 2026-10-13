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
//   partner         FULL MANAGEMENT (owner, 13 Oct 2026; view-only from 8 Oct):
//                   everything the owner can do — approvals, tuitions, payments,
//                   Finance, Plans, Payment gateways, Team, Settings, Blog,
//                   Audit — EXCEPT anything that touches the Owner account or
//                   ownership (ownerProtection / staffChangeProblem below, and
//                   lib/ownerGuard on the server). Two-factor is always
//                   required of a Partner.
//
// 'owner' satisfies every check, so callers list the OTHER roles that qualify
// and never have to remember to add owner. 'partner' satisfies every check too.

export type AdminRole = 'owner' | 'admin' | 'operations' | 'tuitions_staff' | 'partner'

export function roleSatisfies(actorRole: AdminRole, allowed: AdminRole[]): boolean {
  return actorRole === 'owner' || actorRole === 'partner' || allowed.includes(actorRole)
}

/**
 * A role that may change nothing. No role is view-only today (owner, 13 Oct
 * 2026 — the Partner became full management); the check and the screens that
 * read it stay, so a future view-only role is one line here.
 */
export function isReadOnlyRole(role: AdminRole | null | undefined): boolean {
  void role
  return false
}

/** Roles that must ALWAYS have two-factor on — no grace window, and no admin
 *  request is served to a session that has not passed it. */
export function alwaysNeedsTwoFactor(role: AdminRole | null | undefined): boolean {
  return role === 'partner'
}

// ---------------------------------------------------------------------------
// OWNER PROTECTION (owner, 13 Oct 2026). Pure rules; the server applies them in
// lib/ownerGuard and lib/staff. Hiding a button is never the control.
// ---------------------------------------------------------------------------

export const OWNER_PROTECTED = 'Only the Owner can change the Owner account.'
export const OWNER_ONLY_OWNERSHIP = 'Only the Owner can make someone Owner or transfer ownership.'
export const PARTNER_PROTECTED = 'Only the Owner can change or remove a Partner.'

/**
 * May this actor change the TARGET account at all — edit it, pause, suspend,
 * warn, ban, change its password, email, mobile number or two-factor, or remove
 * it? Returns the refusal in words, or null when allowed. Nobody except the
 * Owner may touch the Owner account.
 */
export function ownerProtection(
  actorRole: AdminRole | null | undefined,
  targetRole: string | null | undefined,
): string | null {
  if (targetRole === 'owner' && actorRole !== 'owner') return OWNER_PROTECTED
  return null
}

/**
 * A change to a staff member's role, or their removal (`newRole` null). On top
 * of ownerProtection: nobody but the Owner hands out the Owner role, and a
 * Partner cannot demote, remove or reset another Partner.
 */
export function staffChangeProblem(
  actorRole: AdminRole | null | undefined,
  targetRole: string | null | undefined,
  newRole?: string | null,
): string | null {
  const owner = ownerProtection(actorRole, targetRole)
  if (owner) return owner
  if (newRole === 'owner' && actorRole !== 'owner') return OWNER_ONLY_OWNERSHIP
  if (targetRole === 'partner' && actorRole !== 'owner') return PARTNER_PROTECTED
  return null
}

/** The owner and the Partner see the real staff roles; everyone else sees the
 *  one word "Admin" for every staff member (owner, 8 Oct 2026, item 2). */
export function seesRealRoles(viewer: AdminRole | null | undefined): boolean {
  return viewer === 'owner' || viewer === 'partner'
}

/** The real role, in words — for the owner and the Partner (Team page). */
export const ROLE_LABEL: Record<AdminRole, string> = {
  owner: 'Owner',
  partner: 'Partner',
  admin: 'Admin',
  operations: 'Operations',
  tuitions_staff: 'Tuitions staff',
}

/**
 * The badge a staff member wears (header, Overview, People pages). Owner and
 * Partner show as themselves; Admin, Operations and Tuitions staff all show as
 * "Admin". The owner and the Partner see the real role (pass their role as
 * `viewer`); rights never depend on this word.
 */
export function roleBadge(role: string | null | undefined, viewer?: AdminRole | null): string {
  if (!role) return ''
  if (seesRealRoles(viewer ?? null)) return ROLE_LABEL[role as AdminRole] ?? role
  if (role === 'owner') return 'Owner'
  if (role === 'partner') return 'Partner'
  return 'Admin'
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
  // OWNER AND PARTNER AREAS (owner, 8 Oct 2026, item 3; Partner full rights
  // from 13 Oct): `[]` = the owner and the Partner (roleSatisfies admits both),
  // everyone else gets 403 and no menu item. Finance, the Overview revenue figure, payment amounts and
  // totals, Plans and prices, Payment gateways + the settlement check, Team and
  // the Audit log.
  finance: [] as AdminRole[],
  revenue: [] as AdminRole[],
  paymentAmounts: [] as AdminRole[],
  plans: [] as AdminRole[],
  plansMutate: [] as AdminRole[],
  // Payments: admin and operations see each payment's STATUS (to help tutors),
  // never an amount or a total — the amounts are removed on the server.
  payments: ['admin', 'operations'] as AdminRole[],
  // Approving or rejecting a bank-transfer receipt: owner, admin and operations
  // (owner, 11 Oct 2026). The Partner views; the server refuses their POST.
  paymentsApprove: ['admin', 'operations'] as AdminRole[],
  // Marking a payment refunded is money in rupees: owner only.
  paymentsRefund: [] as AdminRole[],
  paymentsSettings: ['admin'] as AdminRole[],
  // PayPro reconciliation moved into Payment gateways → Settlement check
  // (owner, 6 Oct 2026): owner only, like that screen. `[]` = owner only.
  reconciliation: [] as AdminRole[],
  // The Duplicates view and its one-tap merge (owner, 6 Oct 2026).
  duplicates: ['admin', 'operations'] as AdminRole[],
  duplicatesMerge: ['admin'] as AdminRole[],
  // Opening checkout to ALL members is an owner decision. `[]` = owner only.
  paymentsSwitches: [] as AdminRole[],
  // Admin → Settings → Payment gateways (owner, 6 Oct 2026, item 19): owner
  // ONLY, enforced on the server (an admin or staff role gets 403).
  paymentGateways: [] as AdminRole[],
  // Admin → Settings → Subjects (owner, 7 Oct 2026): which subjects are a
  // level's "Main subjects". Owner and admin only, enforced on the server.
  subjectsCore: ['admin'] as AdminRole[],
  // A second-role account for a member, created by support (owner, 8 Oct 2026):
  // owner and Admin only.
  secondRole: ['admin'] as AdminRole[],
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
  // Marketplace → Paused tuitions (owner, 8 Oct 2026): every role that can post
  // tuitions sees the auto-paused list and may Resume (one or many).
  pausedTuitions: ['admin', 'operations', 'tuitions_staff'] as AdminRole[],
  // Marketplace → Applicants to forward (owner, 10 Oct 2026): tell a tuition's
  // parent which paid tutors applied. Owner, admin, operations and tuitions
  // staff act; the Partner views (refused on every write by checkAdminRole).
  applicantForwards: ['admin', 'operations', 'tuitions_staff'] as AdminRole[],
  users: ['admin', 'operations'] as AdminRole[],
  // Staff performance. Management view (admin/owner), plus tuitions_staff for
  // ITS OWN activity only — the page and detail route force the id to the actor
  // for this role, so it can never read another staff member's.
  staffActivity: ['admin', 'tuitions_staff'] as AdminRole[],
  // Staff outreach under People (owner, 8 Oct 2026): Unpaid signups (call /
  // WhatsApp new tutors who have not paid) and Featured WhatsApp (send Featured
  // tutors their new matches). Owner, admin, Operations AND Tuitions staff — the
  // owner named all four. These are the only People screens tuitions_staff opens.
  unpaidSignups: ['admin', 'operations', 'tuitions_staff'] as AdminRole[],
  featuredWhatsapp: ['admin', 'operations', 'tuitions_staff'] as AdminRole[],
  orphans: ['admin', 'operations'] as AdminRole[],
  signups: ['admin', 'operations'] as AdminRole[],
  usersExport: ['admin'] as AdminRole[],
  // The audit log is owner-only (owner, 8 Oct 2026, item 3).
  audit: [] as AdminRole[],
  seo: ['admin', 'operations'] as AdminRole[],
  // Overview → Unmet searches (owner, 11 Oct 2026): add a Search word, copy a
  // hiring post, mark done. The roles that could already open the list; the
  // Partner views and changes nothing.
  unmetSearches: ['admin', 'operations'] as AdminRole[],
  videoVisibility: ['admin'] as AdminRole[],
  tutorSlug: ['admin'] as AdminRole[],
  tutorEdit: ['admin', 'operations'] as AdminRole[],
  // Unlock an approved, locked CNIC / selfie for ONE re-upload (owner, 9 Oct
  // 2026). Owner, admin and operations; a Partner is refused by checkAdminRole.
  documentUnlock: ['admin', 'operations'] as AdminRole[],
  // Save a document's display rotation, and read a CNIC number from the photo
  // (owner, 10 Oct 2026). Owner, admin and operations; a Partner is refused by
  // checkAdminRole (both are POSTs).
  documentRotate: ['admin', 'operations'] as AdminRole[],
  cnicRead: ['admin', 'operations'] as AdminRole[],
  ads: ['admin', 'operations'] as AdminRole[],
  social: ['admin', 'operations'] as AdminRole[],
  import: ['admin', 'operations'] as AdminRole[],
  // Permanent junk-account deletion — the one admin action with no undo — is
  // OWNER ONLY. `[]` = owner and nobody else.
  cleanup: [] as AdminRole[],
  blog: ['admin', 'operations'] as AdminRole[],
  // Publish / schedule / unpublish / delete: manager (admin) + owner ONLY
  // (owner, 5 Oct 2026). Operations drafts and ticks Reviewed; approval and
  // publishing stop at a manager. tuitions_staff is in none of these.
  blogPublish: ['admin'] as AdminRole[],
  // Approve a post for publishing (and tick "Numbers checked"): manager + owner.
  blogApprove: ['admin'] as AdminRole[],
  blogQueue: ['admin', 'operations'] as AdminRole[],
  blogGenerate: ['admin', 'operations'] as AdminRole[],
}
