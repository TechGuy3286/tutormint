// lib/adminAccessCore.ts
//
// PURE admin access rules — no next/navigation, no Supabase, no server-only —
// so the whole access matrix is unit-testable and client-safe. lib/adminAuth
// imports and re-exports everything here; existing callers that import from
// '@/lib/adminAuth' are unaffected.
//
// The role tree (owner, 14 Sep 2026 + PR106-H2):
//   owner           everything, plus the Team screen and every approval
//                   (OWNER-ONLY APPROVALS below, owner 15 Oct 2026).
//   admin           everything except Team and approvals.
//   operations      office staff: tuitions, assisting, marketing, SEO; views
//                   the verification queues (approvals are Owner only).
//   tuitions_staff  RESTRICTED: the Tuitions group (the board, Post a tuition,
//                   Paused tuitions, Duplicates, Applicants to forward, Team
//                   activity without its Verifications tab) and the two
//                   outreach lists, plus their own Two-factor page and sign
//                   out. Everything else is refused on
//                   the server, not just hidden.
//   partner         EDITS TUTORS, PARENTS AND TUITIONS; EVERYTHING ELSE VIEW
//                   ONLY (owner, 13 Oct 2026, later the same day — this replaces
//                   the "full management" of migration 165). A Partner may OPEN
//                   every screen (roleSatisfies admits the role everywhere, so
//                   pages, the menu and GET routes are unchanged), but may only
//                   WRITE where the screen's list names 'partner'
//                   (roleMayWrite). checkAdminRole refuses any other write with
//                   403, whatever the route. Never the Owner account
//                   (ownerProtection / staffChangeProblem below, lib/ownerGuard).
//                   Two-factor is always required of a Partner.
//
// 'owner' satisfies every check, so callers list the OTHER roles that qualify
// and never have to remember to add owner.

export type AdminRole = 'owner' | 'admin' | 'operations' | 'tuitions_staff' | 'partner'

export function roleSatisfies(actorRole: AdminRole, allowed: AdminRole[]): boolean {
  return actorRole === 'owner' || actorRole === 'partner' || allowed.includes(actorRole)
}

/**
 * May this role CHANGE things on a screen whose access list is `allowed`?
 * Everyone except the Partner: the same answer as roleSatisfies. The Partner:
 * only when the list names 'partner' — opening a screen and changing it are two
 * different questions for that role (owner, 13 Oct 2026).
 */
export function roleMayWrite(actorRole: AdminRole, allowed: AdminRole[]): boolean {
  if (actorRole === 'partner') return allowed.includes('partner')
  return roleSatisfies(actorRole, allowed)
}

/** The words a Partner sees when a write is refused. */
export const PARTNER_VIEW_ONLY = 'View only. Your account cannot change this.'

/**
 * The admin pages a Partner may CHANGE things on — presentation only (which
 * screens show their buttons). The control is roleMayWrite on the server.
 * Tutors, parents, People (and its outreach lists), Abandoned signups, the
 * tuition board and everything under it, Reports, Flagged messages, the Team
 * inbox, and the Overview work lists (not Unmet searches).
 */
const PARTNER_EDIT_PREFIXES = ['/admin/tutors', '/admin/parents', '/admin/users', '/admin/follow-ups', '/admin/signups', '/admin/orphans', '/admin/jobs', '/admin/reports', '/admin/flags', '/admin/inbox', '/admin/overview', '/admin/security']
const PARTNER_VIEW_PREFIXES = ['/admin/overview/todo-unmet']

export function partnerEditsPath(pathname: string | null | undefined): boolean {
  const p = (pathname ?? '').replace(/\/+$/, '') || '/admin'
  const under = (prefix: string) => p === prefix || p.startsWith(prefix + '/')
  if (PARTNER_VIEW_PREFIXES.some(under)) return false
  return PARTNER_EDIT_PREFIXES.some(under)
}

/**
 * A role that may change nothing ANYWHERE. No role is like that today: the
 * Partner changes some areas and views the rest (roleMayWrite). Kept so a
 * future fully view-only role is one line here.
 */
export function isReadOnlyRole(role: AdminRole | null | undefined): boolean {
  void role
  return false
}

/** Roles that must ALWAYS have two-factor on — no grace window, and no admin
 *  request is served to a session that has not passed it. Every staff role
 *  since 15 Oct 2026 (owner: "same flow as Partner"); it was the Partner only. */
export const STAFF_ROLES: AdminRole[] = ['owner', 'admin', 'operations', 'tuitions_staff', 'partner']
export function alwaysNeedsTwoFactor(role: AdminRole | null | undefined): boolean {
  return !!role && STAFF_ROLES.includes(role)
}

// ---------------------------------------------------------------------------
// OWNER PROTECTION (owner, 13 Oct 2026). Pure rules; the server applies them in
// lib/ownerGuard and lib/staff. Hiding a button is never the control.
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// OWNER-ONLY APPROVALS (owner, 15 Oct 2026). Only the Owner account may:
//   • approve / reject (re-upload) a tutor's or parent's CNIC, selfie, profile
//     photo, address or video, type or confirm a CNIC number (and read one
//     from the photo), rotate or crop a document or profile photo, and unlock
//     an approved CNIC or selfie;
//   • approve / reject a bank-transfer receipt;
//   • approve / reject a staff sign-up claim.
// Every other role (Project Manager, Admin, Operations, Tuitions staff) may
// still OPEN the queues and records — view only. The server refuses them with
// 403 (lib/ownerGuard refuseUnlessOwnerApproval, which also alerts the Owner),
// and the screens hide the controls (canApprove).
// ---------------------------------------------------------------------------

export const OWNER_ONLY_APPROVAL = 'Only the Owner can approve or reject. Your account can view this.'

/** May this role make an approval decision? The Owner only. */
export function canApprove(role: AdminRole | null | undefined): boolean {
  return role === 'owner'
}

export const OWNER_PROTECTED = 'Only the Owner can change the Owner account.'
export const OWNER_ONLY_OWNERSHIP = 'Only the Owner can make someone Owner or transfer ownership.'
export const PARTNER_PROTECTED = 'Only the account owner can change or remove a Project Manager.'

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

/** What the Owner and the Partner are both called, everywhere a role is shown
 *  (owner, 13 Oct 2026). A label only: the internal role names, the rights and
 *  Owner protection do not change. */
export const PROJECT_MANAGER = 'Project Manager'

/** The Partner's line in the Team role dropdown. */
export const PARTNER_ROLE_OPTION = 'Project Manager — edits tutors, parents and tuitions; approvals are Owner only; everything else view only; two-factor required'

/** The real role, in words — for the owner and the Partner (Team page). */
export const ROLE_LABEL: Record<AdminRole, string> = {
  owner: PROJECT_MANAGER,
  partner: PROJECT_MANAGER,
  admin: 'Admin',
  operations: 'Operations',
  tuitions_staff: 'Tuitions staff',
}

/**
 * The badge a staff member wears (header, Overview, People pages). Owner and
 * Partner both show as "Project Manager"; Admin, Operations and Tuitions staff
 * all show as "Admin". The owner and the Partner see the real role of other
 * staff (pass their role as `viewer`); rights never depend on this word.
 */
export function roleBadge(role: string | null | undefined, viewer?: AdminRole | null): string {
  if (!role) return ''
  if (seesRealRoles(viewer ?? null)) return ROLE_LABEL[role as AdminRole] ?? role
  if (role === 'owner' || role === 'partner') return PROJECT_MANAGER
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
  // The tutor and parent verification queues: open to these roles; the
  // approve / reject decisions themselves are the Owner's alone (canApprove).
  tutors: ['admin', 'operations', 'partner'] as AdminRole[],
  parents: ['admin', 'operations', 'partner'] as AdminRole[],
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
  // Tuitions staff open it too since it joined the Tuitions group (owner,
  // 15 Oct 2026); merging stays admin + Partner.
  duplicates: ['admin', 'operations', 'tuitions_staff', 'partner'] as AdminRole[],
  duplicatesMerge: ['admin', 'partner'] as AdminRole[],
  // Opening checkout to ALL members is an owner decision. `[]` = owner only.
  paymentsSwitches: [] as AdminRole[],
  // Admin → Settings → Payment gateways (owner, 6 Oct 2026, item 19): owner
  // ONLY, enforced on the server (an admin or staff role gets 403).
  paymentGateways: [] as AdminRole[],
  // Admin → Settings → SMS (owner, 15 Oct 2026): Owner only; the Partner views
  // (roleSatisfies admits them) but cannot send a test (roleMayWrite is false).
  smsHealth: [] as AdminRole[],
  // Admin → Settings → Email (owner, 16 Oct 2026): the send log and failed
  // emails. Owner and admin; the Partner views. Read only — no write route.
  emailHealth: ['admin'] as AdminRole[],
  // Admin → Settings → Subjects (owner, 7 Oct 2026): which subjects are a
  // level's "Main subjects". Owner and admin only, enforced on the server.
  subjectsCore: ['admin'] as AdminRole[],
  // A second-role account for a member, created by support (owner, 8 Oct 2026):
  // owner and Admin only.
  secondRole: ['admin'] as AdminRole[],
  // Staff management is the ONE thing an Admin does not get. `[]` = owner only.
  team: [] as AdminRole[],
  reports: ['admin', 'operations', 'partner'] as AdminRole[],
  inbox: ['admin', 'operations', 'partner'] as AdminRole[],
  // The tuition board. Operations and the restricted tuitions_staff work it
  // day-to-day. MUTATE is close / pause / resume / unfeature — nothing is
  // deleted (PR49 §4), so it is safe for tuitions_staff too (the role's whole
  // job is managing tuitions, which the owner's spec grants close/reopen).
  jobs: ['admin', 'operations', 'tuitions_staff', 'partner'] as AdminRole[],
  jobsMutate: ['admin', 'tuitions_staff', 'partner'] as AdminRole[],
  jobsPost: ['admin', 'operations', 'tuitions_staff', 'partner'] as AdminRole[],
  // Marketplace → Paused tuitions (owner, 8 Oct 2026): every role that can post
  // tuitions sees the auto-paused list and may Resume (one or many).
  pausedTuitions: ['admin', 'operations', 'tuitions_staff', 'partner'] as AdminRole[],
  // Marketplace → Applicants to forward (owner, 10 Oct 2026): tell a tuition's
  // parent which paid tutors applied. Owner, admin, operations and tuitions
  // staff act; the Partner views (refused on every write by checkAdminRole).
  applicantForwards: ['admin', 'operations', 'tuitions_staff', 'partner'] as AdminRole[],
  users: ['admin', 'operations', 'partner'] as AdminRole[],
  // Team activity → "Verifications & messages" tab, its API and the per-staff
  // detail pages: the Owner, the Project Managers and Admin, view only (owner,
  // 15 Oct 2026). Operations and Tuitions staff are refused (403 on the API).
  staffActivity: ['admin'] as AdminRole[],
  // Team activity → "Paid sign-ups" (owner, 15 Oct 2026). The tab opens for
  // every role on tuitionPosting; who sees EVERY row
  // and the Team total is staffSignupsAll (Owner, Project Managers, Admin) —
  // everyone else sees only their own row and lists (lib/staffSignupsCore).
  staffSignupsAll: ['admin'] as AdminRole[],
  // Claiming a sign-up that came without a link: the participants (Tuitions
  // staff, Operations, Admin). The Owner passes this list but carries no link,
  // so the server refuses; the Partner is refused by roleMayWrite.
  staffSignupClaim: ['admin', 'operations', 'tuitions_staff'] as AdminRole[],
  // Tuitions → My sign-ups (owner, 16 Oct 2026): every staff member with a join
  // link sees ONLY the people credited to them (lib/mySignups). The Owner and
  // the Project Managers pass this list but carry no link; the page says so.
  mySignups: ['admin', 'operations', 'tuitions_staff'] as AdminRole[],
  // Claims to review: the Owner and Admin approve or reject; the Project
  // Managers view (roleMayWrite refuses their POST).
  staffClaimsReview: ['admin'] as AdminRole[],
  // Tuitions → Team activity (owner, 15 Oct 2026; it merged Tuition posting
  // activity and Staff activity): every role that posts tuitions — Tuitions
  // staff, Operations, Admin, the Project Managers. Opens the page and the
  // "Paid sign-ups" and "Tuitions posted" tabs; the third tab is staffActivity.
  tuitionPosting: ['admin', 'operations', 'tuitions_staff', 'partner'] as AdminRole[],
  // The daily sign-up funnel on Overview (owner, 15 Oct 2026): the Owner and
  // the Project Managers. `[]` = owner + Partner.
  signupFunnel: [] as AdminRole[],
  // Staff outreach under People (owner, 8 Oct 2026): Unpaid signups (call /
  // WhatsApp new tutors who have not paid) and Featured WhatsApp (send Featured
  // tutors their new matches). Owner, admin, Operations AND Tuitions staff — the
  // owner named all four. These are the only People screens tuitions_staff opens.
  unpaidSignups: ['admin', 'operations', 'tuitions_staff', 'partner'] as AdminRole[],
  featuredWhatsapp: ['admin', 'operations', 'tuitions_staff', 'partner'] as AdminRole[],
  orphans: ['admin', 'operations', 'partner'] as AdminRole[],
  signups: ['admin', 'operations', 'partner'] as AdminRole[],
  usersExport: ['admin'] as AdminRole[],
  // The audit log is owner-only (owner, 8 Oct 2026, item 3).
  audit: [] as AdminRole[],
  seo: ['admin', 'operations'] as AdminRole[],
  // Overview → Unmet searches (owner, 11 Oct 2026): add a Search word, copy a
  // hiring post, mark done. The roles that could already open the list; the
  // Partner views and changes nothing.
  unmetSearches: ['admin', 'operations'] as AdminRole[],
  videoVisibility: ['admin', 'partner'] as AdminRole[],
  tutorSlug: ['admin', 'partner'] as AdminRole[],
  tutorEdit: ['admin', 'operations', 'partner'] as AdminRole[],
  // Unlock an approved, locked CNIC / selfie for ONE re-upload (owner, 9 Oct
  // 2026). Owner, admin and operations; a Partner is refused by checkAdminRole.
  documentUnlock: ['admin', 'operations', 'partner'] as AdminRole[],
  // Save a document's display rotation, and read a CNIC number from the photo
  // (owner, 10 Oct 2026). Owner, admin and operations; a Partner is refused by
  // checkAdminRole (both are POSTs).
  documentRotate: ['admin', 'operations', 'partner'] as AdminRole[],
  cnicRead: ['admin', 'operations', 'partner'] as AdminRole[],
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

/** A stored role (an Audit row's actor_role, a staff row) in the words a screen
 *  shows: the Owner and the Partner both read "Project Manager"; anything that
 *  is not a staff role ("system", "member") is shown as stored. */
export function roleWord(raw: string | null | undefined): string {
  if (!raw) return '—'
  return ROLE_LABEL[raw as AdminRole] ?? raw
}
