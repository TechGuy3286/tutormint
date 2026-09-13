// lib/jobDisplayTitle.ts
//
// The composed display title for a tuition (owner, 13 Sep 2026) — a natural
// phrase, not a pipe-joined field list:
//
//   [Gender] [Job Title] for [Level] in [Area], [City]
//   → "Female Home Tutor for Grade 1–5 in Johar Town, Lahore"
//
// Every segment is optional and a missing one takes its preposition with it, so
// the string never reads "for in" or trails a comma. Subjects and budget are
// DELIBERATELY dropped: both already appear elsewhere on the card (subjects as
// chips, budget as its own row), and seven spelled-out subjects were what made
// the old pipe row unreadable.
//
// This one string is the job card's title, and — only when there is no stored
// human headline — the fallback for the tuition page <title> and the JobPosting
// structured data (see preferHumanTitle). It lives in one pure place (no I/O):
// the caller resolves each part to a plain string and hands them in.

export type JobTitleParts = {
  /** The Job Type title, e.g. "Home Tutor" / "O Levels Teacher". */
  jobType?: string | null
  /** The preferred-gender word, any case — capitalised here as an adjective, and
   *  omitted entirely when there is no preference. */
  gender?: string | null
  /** The class level / grade, already collapsed and joined, e.g. "Grade 1–5"
   *  or "Grade 2 and Grade 5". */
  level?: string | null
  area?: string | null
  city?: string | null
}

/** Capitalise the first letter of a word, leaving the rest as given ("female" →
 *  "Female"). Empty in, empty out. */
function capitaliseWord(word: string): string {
  return word ? word.charAt(0).toUpperCase() + word.slice(1) : ''
}

/**
 * Build the natural-phrase title from the parts, dropping every empty segment
 * (and its preposition) so nothing reads as a machine-joined row with holes.
 *
 *   who      = "[Gender] [Job Title]"     (a leading adjective when set)
 *   for X    = " for [Level]"             (omitted with no level)
 *   in Y     = " in [Area], [City]"       (area omitted → "in [City]")
 */
export function jobDisplayTitle(parts: JobTitleParts): string {
  const clean = (s: string | null | undefined) => (s ?? '').trim()

  const gender = capitaliseWord(clean(parts.gender))
  const jobType = clean(parts.jobType)
  const level = clean(parts.level)
  const location = [clean(parts.area), clean(parts.city)].filter(Boolean).join(', ')

  const who = [gender, jobType].filter(Boolean).join(' ')

  return [who, level ? `for ${level}` : '', location ? `in ${location}` : '']
    .filter(Boolean)
    .join(' ')
}

/**
 * Which title a PAGE surface (the tuition page <title>, its heading, the
 * JobPosting structured data) shows: the human-written / AI-generated headline
 * the parent or admin actually wrote (`stored`), falling back to the composed
 * phrase only when there is no stored title. The composed phrase reads well in a
 * browser tab or a Google Jobs result too, so this fallback improved with it —
 * but the stored headline still wins where it exists (owner, 11 Sep 2026).
 */
export function preferHumanTitle(
  stored: string | null | undefined,
  composed: string,
): string {
  const s = (stored ?? '').trim()
  return s || composed
}
