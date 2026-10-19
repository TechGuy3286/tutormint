// lib/subjectDisplay.ts
//
// How a tutor's subjects are SHOWN (owner, 17 Oct 2026): each subject once.
// The taxonomy holds a few subjects twice under different names ("Islamiat /
// Islamic Studies", "Islamic Studies", "Islamiyat"). They are merged here for
// display only — nothing stored is deleted or rewritten, and matching still runs
// on taxonomy_master ids.
//
// PURE — no imports — so the card, the profile page and the tests read one rule.

/** Lower case, "&" as "and", punctuation and extra spaces dropped. */
function normal(name: string): string {
  return name
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

/** Groups of names that are the same subject → the one name shown. */
const SAME_SUBJECT: { display: string; names: string[] }[] = [
  {
    display: 'Islamiat / Islamic Studies',
    names: [
      'Islamiat / Islamic Studies',
      'Islamiyat / Islamic Studies',
      'Islamic Studies',
      'Islamiyat',
      'Islamiat',
    ],
  },
  {
    display: 'Translation of the Holy Quran',
    names: ['Translation of the Holy Quran', 'Translation of Holy Quran', 'Translation of Quran', 'Translation of the Quran'],
  },
  // Five more pairs (owner, 17 Oct 2026), display only. Deliberately NOT merged:
  // English / English Literature / English Language & Literature, Urdu / Urdu
  // Literature, the IB "Language A" pair, and any "Language & Literature" vs
  // plain "Language" pair — those are different subjects.
  { display: 'Business Studies', names: ['Business Studies', 'Business'] },
  { display: 'Design & Technology', names: ['Design & Technology', 'Design Technology'] },
  { display: 'Robotics & Engineering', names: ['Robotics & Engineering', 'Robotics Engineering'] },
  { display: 'French', names: ['French', 'French Language'] },
  { display: 'German', names: ['German', 'German Language'] },
]

const DISPLAY_BY_KEY = new Map<string, string>()
for (const g of SAME_SUBJECT) for (const n of g.names) DISPLAY_BY_KEY.set(normal(n), g.display)

/** The key two names share when they are the same subject. */
export function subjectDisplayKey(name: string): string {
  const k = normal(name)
  const display = DISPLAY_BY_KEY.get(k)
  return display ? normal(display) : k
}

/** The one name shown for a subject. */
export function subjectDisplayName(name: string): string {
  return DISPLAY_BY_KEY.get(normal(name)) ?? name.trim()
}

/**
 * Each subject once, in the order first seen, under its display name. Works on
 * plain labels or on `{ label }` objects (the card's linked subjects keep the
 * first entry's id and link).
 */
export function dedupeSubjects<T extends string | { label: string }>(list: readonly T[] | null | undefined): T[] {
  const seen = new Set<string>()
  const out: T[] = []
  for (const item of list ?? []) {
    const label = typeof item === 'string' ? item : item.label
    if (!label || !label.trim()) continue
    const key = subjectDisplayKey(label)
    if (seen.has(key)) continue
    seen.add(key)
    const display = subjectDisplayName(label)
    out.push((typeof item === 'string' ? display : { ...(item as { label: string }), label: display }) as T)
  }
  return out
}

/** Shown when a save carries a subject that is not on the master list. */
export const NOT_A_MASTER_SUBJECT =
  'One of those subjects is not on our subject list. Please choose your subjects from the list.'

/**
 * The ids in a subject save that are not taxonomy_master rows. A tutor's
 * subjects are master-list ids only (owner, 17 Oct 2026); free text, such as a
 * school's name, belongs in a school field, never in subjects.
 */
export function notMasterSubjects(ids: readonly number[], masterIds: Iterable<number>): number[] {
  const known = new Set(masterIds)
  return ids.filter((id) => !Number.isInteger(id) || !known.has(id))
}

/**
 * The ids a subject save must REFUSE (owner, 19 Oct 2026): only NEWLY ADDED ids
 * that are not on the master list. A value the tutor already had saved — even
 * one the display leaves out, such as a school name saved earlier — never blocks
 * the save; it is kept as it is.
 */
export function refusedNewSubjects(ids: readonly number[], savedIds: Iterable<number>, masterIds: Iterable<number>): number[] {
  const saved = new Set(savedIds)
  return notMasterSubjects(ids, masterIds).filter((id) => !saved.has(id))
}
