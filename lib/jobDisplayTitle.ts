// lib/jobDisplayTitle.ts
//
// The composed display title for a tuition (owner, 11 Sep 2026):
//
//   Job Title | Gender | Subject | Level | Area | City | Budget
//
// Gender and budget are optional, and any segment can be missing — a missing
// segment and its separator are omitted entirely, so the string never carries a
// stray pipe or an empty segment. This one string feeds the job card's title,
// the tuition page <title>, and the JobPosting structured data, so it lives in
// one pure place (no I/O) — the caller resolves each part to a plain string and
// hands them in already-formatted.

export type JobTitleParts = {
  /** The Job Type title, e.g. "Home Tutor" / "O Levels Teacher". */
  jobType?: string | null
  /** The preferred-gender word, e.g. "Female" — omitted when there is none. */
  gender?: string | null
  /** The subject(s), already joined, e.g. "Physics, Chemistry". */
  subject?: string | null
  /** The class level / grade. */
  level?: string | null
  area?: string | null
  city?: string | null
  /** The budget label, e.g. "Rs 15,000–20,000" — omitted when there is none. */
  budget?: string | null
}

/**
 * Build the pipe-joined title from the parts, in the fixed order, dropping every
 * empty segment (and its separator) so nothing reads as a machine-joined row
 * with holes in it.
 */
export function jobDisplayTitle(parts: JobTitleParts): string {
  return [
    parts.jobType,
    parts.gender,
    parts.subject,
    parts.level,
    parts.area,
    parts.city,
    parts.budget,
  ]
    .map((s) => (s ?? '').trim())
    .filter(Boolean)
    .join(' | ')
}
