// lib/jobTitlesCore.ts
//
// The PURE core of the Job Type field (owner, 11 Sep 2026). Job Type is now a
// set of 19 job titles ("Home Tutor", "O Levels Teacher" …) stored as DATA in
// the job_titles table (migration 77), the location_cities pattern — so this
// file carries NO hardcoded list of titles, only the ordering rule and the one
// title the "online is city-agnostic" rule pivots on. No Supabase, no React, so
// the ordering and the online rule are unit-testable without the database.
//
// STORED VALUES ARE THE LABELS themselves (like location_cities stores "Lahore"
// verbatim), so a job's teaching_mode and a tutor's job_types[] hold the exact
// title text and display is identity.

/**
 * The one title the "online is city-agnostic" rule points at (owner item 6).
 * A tutor offering this takes online jobs anywhere; home/school titles stay
 * same-city. Kept here (and as the same literal in rank_tutors) rather than as a
 * flag, because it is exactly one title and the SQL needs a literal.
 */
export const ONLINE_JOB_TITLE = 'Online Tutor'

function norm(s: string | null | undefined): string {
  return (s ?? '').trim().toLowerCase()
}

/** Whether a Job Type value is the city-agnostic online title. */
export function isOnlineTitle(value: string | null | undefined): boolean {
  return norm(value) === norm(ONLINE_JOB_TITLE)
}

export type JobTitleRow = { name: string; sort_order: number }

/**
 * The titles in the owner's fixed order (sort_order, then name as a stable
 * tiebreak). The DB is the source of truth for the set AND the order; this only
 * sorts the rows it is handed.
 */
export function sortJobTitles(rows: JobTitleRow[]): string[] {
  return [...rows]
    .sort((a, b) => a.sort_order - b.sort_order || a.name.localeCompare(b.name))
    .map((r) => r.name)
}

/**
 * Keep only values that are real titles (case-insensitive), preserving input
 * order. Used by the write paths to drop anything not in the curated set — the
 * app-layer validation that replaces the CHECK constraint the data model
 * deliberately does not carry (adding a title is an insert, not an ALTER).
 */
export function keepKnownTitles(
  values: readonly string[] | null | undefined,
  known: readonly string[],
): string[] {
  const set = new Set(known.map(norm))
  const seen = new Set<string>()
  const out: string[] = []
  for (const v of values ?? []) {
    const t = (v ?? '').trim()
    if (!t) continue
    const k = norm(t)
    if (set.has(k) && !seen.has(k)) {
      seen.add(k)
      out.push(t)
    }
  }
  return out
}
