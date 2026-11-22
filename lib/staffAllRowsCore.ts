// lib/staffAllRowsCore.ts
//
// "Sees every row" for named staff accounts (owner, 20 Nov 2026 — PR-12).
// PURE, so the rule is unit-tested.
//
// Some lists are split by owner: Applications (a tuition's owner) and the
// Parent interest inbox (a tutor's city owner). The Owner and the Project
// Managers see every row and every badge count. The Owner also named ONE
// Backend Support account (Mohsin) to see every row and every badge count on
// those two screens; other Backend Support staff keep their own rows. That is a
// grant to an ACCOUNT, not to a role, so it is stored as a list of profile ids
// in app_settings ('staff.all_rows', a JSON array; migration 240 seeds it) — no
// id is written in code. It never widens anything else: no money, no Owner-only
// action, no other screen.

export const ALL_ROWS_KEY = 'staff.all_rows'

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/** The stored value → the set of granted profile ids. Anything malformed → empty. */
export function parseAllRowsStaff(value: string | null | undefined): Set<string> {
  try {
    const v = JSON.parse(value ?? '[]') as unknown
    if (!Array.isArray(v)) return new Set()
    return new Set(v.filter((x): x is string => typeof x === 'string' && UUID.test(x)).map((x) => x.toLowerCase()))
  } catch {
    return new Set()
  }
}

/**
 * Does this actor see every row of a split list? The Owner and the Partner
 * always; a role named in `roles` (the screen's "all rows" list); or an account
 * on the stored grant list — but only while it still holds a staff role.
 */
export function seesAllRowsFrom(
  actor: { id: string; adminRole: string | null | undefined },
  roles: readonly string[],
  granted: ReadonlySet<string>,
): boolean {
  const r = actor.adminRole
  if (!r) return false
  if (r === 'owner' || r === 'partner') return true
  if (roles.includes(r)) return true
  return granted.has(actor.id.toLowerCase())
}

// ---- Insights for named staff (PR-16, owner 22 Nov 2026) ------------------
// The Owner gave ONE Backend Support account (Mohsin) Admin → Insights — the
// same kind of grant as above: an ACCOUNT on a stored list, not a role. Its own
// key ('staff.insights', migration 242), so adding someone to the all-rows list
// never opens Insights and the other way round. Insights shows counts only — no
// rupees, no phone, email or CNIC — so it widens nothing else.

export const INSIGHTS_GRANT_KEY = 'staff.insights'

/** Does this actor open Insights? Owner and Partner always (SCREEN_ACCESS
 *  .insights is []), or an account on the stored grant while it holds a staff
 *  role. */
export function seesInsightsFrom(
  actor: { id: string; adminRole: string | null | undefined },
  granted: ReadonlySet<string>,
): boolean {
  return seesAllRowsFrom(actor, [], granted)
}
