// lib/formerStaffCore.ts
//
// PURE rules for the staff clean-up (owner, 24 Oct 2026).
//
// "Former staff" = a staff member whose admin access was removed: their
// account stays as an ordinary user (role 'parent', admin_role null — the same
// state "Remove from team" has always left), profiles.former_staff_at is set
// and the role they held is kept in former_staff_role, so the Owner's
// "Restore staff access" can put it back. Their staff link is deactivated
// (it still opens the site; a sign-up through it is credited to Admin), they
// leave City owners, the target list and every staff dropdown, and the
// tuitions they own move to the city owner of each tuition's city (else the
// site Owner). Past credits, tuitions and history stay, labelled
// "former staff". Owner-level access (the Owner and the Project Managers) is
// never changed by the clean-up.

export const FORMER_STAFF_WORDS = 'former staff'

/** "Javeria Fiaz (former staff)". */
export function formerStaffName(name: string, formerAt: string | null | undefined): string {
  return formerAt ? `${name} (${FORMER_STAFF_WORDS})` : name
}

/** Roles the clean-up never touches (owner-level access). */
export const UNTOUCHABLE_ROLES = new Set(['owner', 'partner'])

/** Roles Restore may put back. */
export const RESTORABLE_ROLES = ['admin', 'supervisor', 'operations', 'tuitions_staff'] as const
export type RestorableRole = (typeof RESTORABLE_ROLES)[number]

export function restoreRoleFor(formerRole: string | null | undefined): RestorableRole {
  return (RESTORABLE_ROLES as readonly string[]).includes(formerRole ?? '') ? (formerRole as RestorableRole) : 'tuitions_staff'
}

/** May the Owner restore this account? Only a former staff member who is not
 *  staff again. */
export function canRestore(p: { role: string | null; admin_role: string | null; former_staff_at: string | null } | null | undefined): boolean {
  return !!p && !!p.former_staff_at && p.role !== 'admin' && !p.admin_role
}

// ------------------------------------------------------------- the plan ----

export type StaffAccount = {
  id: string
  name: string
  role: string | null
  adminRole: string | null
  /** Has a staff link, owns a city, or is on the target list. */
  hasStaffTies: boolean
  formerAt: string | null
}

export type CleanupPlan = {
  /** Keep-list name → the one account it names. */
  keep: { name: string; account: StaffAccount }[]
  /** A keep-list name matching no account, or more than one: nothing is
   *  changed for that name. */
  unmatched: { name: string; matches: number }[]
  /** Owner-level accounts, left exactly as they are. */
  untouched: StaffAccount[]
  /** Everyone else with staff access or staff ties: becomes former staff. */
  remove: StaffAccount[]
}

const norm = (s: string) => s.normalize('NFKC').replace(/\s+/g, ' ').trim().toLowerCase()

/** An account has staff access (role admin / an admin_role) or staff ties. */
export function isStaffish(a: StaffAccount): boolean {
  return a.role === 'admin' || !!a.adminRole || a.hasStaffTies
}

/**
 * Who stays and who becomes former staff. A keep name matches an account only
 * by the EXACT full name (case and spacing aside), among accounts with staff
 * access or ties. A name matching none, or more than one, changes nothing for
 * that name — and its accounts are not removed either, so a typo in the list
 * can never take someone's access away.
 */
export function planStaffCleanup(accounts: StaffAccount[], keepNames: string[]): CleanupPlan {
  const staffish = accounts.filter(isStaffish)
  const plan: CleanupPlan = { keep: [], unmatched: [], untouched: [], remove: [] }
  const protectedIds = new Set<string>()
  for (const a of staffish) {
    if (UNTOUCHABLE_ROLES.has(a.adminRole ?? '')) {
      plan.untouched.push(a)
      protectedIds.add(a.id)
    }
  }
  for (const name of keepNames) {
    const matches = staffish.filter((a) => !protectedIds.has(a.id) && norm(a.name) === norm(name))
    if (matches.length === 1) {
      plan.keep.push({ name, account: matches[0] })
      protectedIds.add(matches[0].id)
    } else {
      plan.unmatched.push({ name, matches: matches.length })
      for (const m of matches) protectedIds.add(m.id)
    }
  }
  for (const a of staffish) {
    if (protectedIds.has(a.id)) continue
    if (a.formerAt && a.role !== 'admin' && !a.adminRole && !a.hasStaffTies) continue
    plan.remove.push(a)
  }
  return plan
}
