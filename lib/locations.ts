// lib/locations.ts
//
// The gender value set, and the Job Type URL/legacy normaliser. Both the Job
// Type titles (migration 77) and the city/area lists (migration 73) are DATA
// now, not hardcoded arrays: read titles through lib/jobTitles.ts (client) or
// lib/jobTitlesServer.ts (server), and cities through lib/cityAreas.ts. Adding a
// title or a city is an INSERT. This file keeps only what is genuinely code
// (gender, the legacy Job Type normaliser) and stays free of any Supabase/React
// import so the server can import parseMode.

/**
 * A Job Type value from a URL or a stored value, normalised to a title.
 *
 * The stored values ARE the 19 titles now ("Home Tutor", "O Levels Teacher"),
 * so a real title passes through verbatim — that is what the select and the
 * stored column carry. The only mapping left is for the RETIRED short codes that
 * may still arrive from an old `?mode=` link or a pre-77 comparison:
 *   home / in_person / both / physical / …  -> 'Home Tutor'
 *   online / remote                          -> 'Online Tutor'
 *   school / school_job                      -> null (ambiguous: 17 school titles
 *                                               now exist, so drop the filter
 *                                               rather than guess one)
 * A blank input is null (no filter). Pure — no DB — so it cannot validate a
 * pass-through value against the 19; a crafted junk mode simply matches nothing.
 */
export function parseMode(raw: string | null | undefined): string | null {
  const v = (raw ?? '').trim()
  if (!v) return null
  switch (v.toLowerCase()) {
    case 'home':
    case 'home_tuition':
    case 'in_person':
    case 'in-person':
    case 'physical':
    case 'onsite':
    case 'on_site':
    case 'both':
    case 'either':
    case 'any':
      return 'Home Tutor'
    case 'online':
    case 'online_tuition':
    case 'remote':
      return 'Online Tutor'
    case 'school':
    case 'school_job':
      return null
    default:
      return v
  }
}

export const GENDERS = [
  { value: 'female', label: 'Female' },
  { value: 'male', label: 'Male' },
] as const
