// lib/subjectLimitCore.ts
//
// A tutor teaches at most 15 SUBJECTS (owner, 21 Oct 2026) — the PURE rule,
// read by onboarding, tutor Settings, the staff tutor editor and every server
// route that saves a tutor's subjects, so they never disagree.
//
// A subject counts ONCE however many levels it is taught at: "Mathematics" at
// Grade 1–5 and at O Level is one subject. Two taxonomy names for the same
// subject ("Islamiat / Islamic Studies", "Islamiyat") are one too — the display
// rule of lib/subjectDisplay.
//
// A tutor already over 15 keeps everything saved (nothing is removed
// automatically). They may save any other change, keep their set, or remove
// subjects; they may not ADD a subject they do not already have until they are
// at 15 or fewer. This is separate from TUTOR_SUBJECT_CAP (lib/tutorSubjectCap),
// which limits the number of subject × grade ENTRIES.

import { subjectDisplayKey } from './subjectDisplay'

export const SUBJECT_LIMIT = 15

/** At the limit, or refused by the server for adding a 16th. */
export const SUBJECT_LIMIT_MESSAGE = 'You can choose up to 15 subjects. Remove one to add another.'

/** The gentle note to a tutor already over the limit. */
export const OVER_LIMIT_NOTE = 'Parents trust focused profiles — please keep your top 15 subjects.'

/** "12 of 15 subjects". */
export function subjectCounterLabel(n: number): string {
  return `${n} of ${SUBJECT_LIMIT} subjects`
}

/** The distinct subjects (display keys) of a set of subject NAMES. */
export function subjectKeysOfNames(names: Iterable<string>): Set<string> {
  const out = new Set<string>()
  for (const n of names) {
    const k = subjectDisplayKey(n)
    if (k) out.add(k)
  }
  return out
}

/** The distinct subjects of a set of taxonomy_master ids; `nameOf` gives each
 *  id's subject name (an id with no name counts as its own subject). */
export function subjectKeysOfIds(ids: Iterable<number>, nameOf: (id: number) => string | null | undefined): Set<string> {
  const out = new Set<string>()
  for (const id of ids) {
    const name = nameOf(id)
    const k = name ? subjectDisplayKey(name) : ''
    out.add(k || `id:${id}`)
  }
  return out
}

/**
 * Whether moving from `before` to `after` (two sets of distinct subjects) is
 * allowed: always when `after` is within the limit; above it, only when no
 * subject is added (keeping the set, or removing subjects).
 */
export function subjectChangeAllowed(before: ReadonlySet<string>, after: ReadonlySet<string>): boolean {
  if (after.size <= SUBJECT_LIMIT) return true
  for (const k of after) if (!before.has(k)) return false
  return true
}

/** The server's refusal (the message), or null when the save may go ahead. */
export function subjectLimitProblem(
  newIds: readonly number[],
  savedIds: readonly number[],
  nameOf: (id: number) => string | null | undefined,
): string | null {
  const after = subjectKeysOfIds(newIds, nameOf)
  const before = subjectKeysOfIds(savedIds, nameOf)
  return subjectChangeAllowed(before, after) ? null : SUBJECT_LIMIT_MESSAGE
}

/** Whether a picker may ADD `name` to a selection whose subjects are `current`. */
export function canAddSubject(current: ReadonlySet<string>, name: string): boolean {
  const k = subjectDisplayKey(name)
  return current.has(k) || current.size < SUBJECT_LIMIT
}

/** The dashboard / Settings banner for a tutor over the limit (owner, 27 Oct
 *  2026), or null when they are within it. Nothing is trimmed: they may only
 *  remove subjects until they are at 15 or fewer. */
export function overCapBannerText(count: number): string | null {
  if (count <= SUBJECT_LIMIT) return null
  const extra = count - SUBJECT_LIMIT
  return `You have ${count} subjects. Please reduce to ${SUBJECT_LIMIT} — remove ${extra} subject${extra === 1 ? '' : 's'}. You can remove subjects but not add new ones until you are at ${SUBJECT_LIMIT} or fewer.`
}
