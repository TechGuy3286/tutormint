// lib/tutorSubjectCap.ts
//
// The ONE limit on how many subject entries (taxonomy_master ids) a tutor may
// save, shared by onboarding, the tutor's Settings and the admin tutor editor so
// they never disagree (hotfix, 7 Oct 2026). PURE — client-safe and unit-tested.
//
// Why 400. A subject picked under a level is saved for EVERY grade of that level,
// so ids multiply fast. From the live taxonomy (7 Oct 2026):
//   main subjects × grades per level — Pre-primary 15, Primary 35, Middle 21,
//   Matriculation 26, IGCSE 20, Intermediate 25 (other levels have none);
//   Primary + Middle + IGCSE + Intermediate main subjects = 101 (the reported
//   case, which the old cap of 60 refused);
//   EVERY level with all its main subjects = 142.
// 400 leaves ~258 entries of room for "More subjects" on top of that, and still
// stops a scripted "select the whole taxonomy" (1,593 live entries).

import { z } from 'zod'

export const TUTOR_SUBJECT_CAP = 400

/** Shown when a tutor goes over the cap — never the field name. */
export const TOO_MANY_SUBJECTS =
  'You picked a lot of subjects. Please keep only the ones you teach most.\nآپ نے بہت زیادہ مضامین چنے ہیں۔ صرف وہ رکھیں جو آپ زیادہ پڑھاتے ہیں۔'

/** Any other malformed request from these forms (a bad id, an unknown action). */
export const RELOAD_AND_RETRY =
  'That request was not understood. Reload the page and try again.\nیہ درخواست سمجھ نہیں آئی۔ صفحہ دوبارہ لوڈ کر کے کوشش کریں۔'

/** Whole positive integers only, duplicates removed, first-seen order kept. */
export function dedupeSubjectIds(raw: unknown): unknown {
  if (!Array.isArray(raw)) return raw
  const out: unknown[] = []
  const seen = new Set<unknown>()
  for (const v of raw) {
    if (seen.has(v)) continue
    seen.add(v)
    out.push(v)
  }
  return out
}

/** The request field every tutor-subject save validates with: duplicates are
 *  removed FIRST, then the cap applies; every message is plain English + Urdu. */
export const subjectIdsSchema = z.preprocess(
  dedupeSubjectIds,
  z
    .array(
      z.number({ message: RELOAD_AND_RETRY }).int({ message: RELOAD_AND_RETRY }).positive({ message: RELOAD_AND_RETRY }),
      { message: RELOAD_AND_RETRY },
    )
    .max(TUTOR_SUBJECT_CAP, { message: TOO_MANY_SUBJECTS }),
)
