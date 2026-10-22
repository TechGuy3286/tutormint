// lib/cityOwnersCore.ts
//
// PURE, client-safe. City owners (owner, 22 Oct 2026).
//
// A tuition with no staff poster — a parent's own post, or an older one whose
// poster was never recorded — belongs to the staff member who owns its city.
// A city with no city owner goes to the site Owner. A tuition a staff member
// posted is never changed, and neither is one the Owner reassigned by hand.
//
// The settings live in the city_owners table (migration 193); only the site
// Owner edits them (Admin → Settings → City owners).

export type CityOwnerSeed = { name: string; cities: string[] }

/** The owner's list, exactly as given on 22 Oct 2026. */
export const CITY_OWNER_SEED: CityOwnerSeed[] = [
  { name: 'Zubia Bashir', cities: ['Peshawar', 'Mardan', 'Abbottabad', 'Quetta'] },
  { name: 'Mahnoor Amin', cities: ['Hyderabad', 'Sukkur', 'Larkana', 'Sargodha', 'Bahawalpur', 'Gujrat'] },
  { name: 'Nabeel', cities: ['Islamabad', 'Rawalpindi'] },
  { name: 'Inzamam', cities: ['Multan', 'Rahim Yar Khan'] },
  { name: 'Aseer Ul Hassan', cities: ['Faisalabad', 'Gujranwala', 'Sialkot', 'Sheikhupura', 'Jhang'] },
  { name: 'Khizra Danish', cities: ['Karachi'] },
  { name: 'Aqsa Mughal', cities: ['Lahore'] },
]

const norm = (s: string | null | undefined) => (s ?? '').toLowerCase().replace(/\s+/g, ' ').trim()

/**
 * The ONE staff account a name means, or null. An exact full-name match wins;
 * otherwise the name must be the whole first word(s) of exactly one staff
 * member's name ("Nabeel" → "Nabeel Khan"). Two or more candidates, or none,
 * is null — never a guess.
 */
export function matchStaffName<T extends { id: string; name: string | null }>(name: string, staff: T[]): T | null {
  const want = norm(name)
  if (!want) return null
  const exact = staff.filter((s) => norm(s.name) === want)
  if (exact.length === 1) return exact[0]
  if (exact.length > 1) return null
  const prefix = staff.filter((s) => norm(s.name).startsWith(`${want} `))
  return prefix.length === 1 ? prefix[0] : null
}

/** City name compared the way cities are stored (canonical case). */
export const cityKey = (city: string | null | undefined) => norm(city)

export type OwnerRow = { staffId: string | null; source: string; postedBy: string | null } | undefined

/**
 * Should the city rule (re)assign this tuition? Only when no staff member
 * posted it AND nobody chose its owner by hand: no owner row, or an unassigned
 * row that came from a poster backfill or an earlier city assignment. A row the
 * city rule wrote itself is re-pointed when the city owner changes.
 */
export function cityRuleApplies(row: OwnerRow): boolean {
  if (!row) return true
  if (row.postedBy) return false
  if (row.source === 'reassigned') return false
  if (row.source === 'city') return true
  return row.staffId === null
}

/** Who the city rule gives a tuition to: its city's owner, else the site Owner. */
export function cityOwnerFor(city: string | null | undefined, map: Map<string, string>, siteOwnerId: string): string {
  return map.get(cityKey(city)) ?? siteOwnerId
}
