// PURE (scripts/test-pr16.ts). A tuition title in normal case, FOR DISPLAY ONLY
// (PR-16, owner: "LAHORE" → "Lahore" on the tutor dashboard). The stored title
// is never changed.
//
//   * a title typed wholly in capitals goes through the CV's displayCase
//     ("O LEVEL MATHS IN LAHORE" → "O Level Maths in Lahore");
//   * in a mixed title, only SHOUTED words of four or more letters are eased
//     ("Maths tutor in LAHORE" → "Maths tutor in Lahore"); short capitals
//     (DHA, FSC, O/A) and the known abbreviations keep their own form.

import { displayCase, KEEP } from '@/lib/cv/textRules'

export function displayTitle(title: string): string {
  const v = (title ?? '').trim()
  if (!v) return v
  if (/[A-Z]/.test(v) && !/[a-z]/.test(v)) return displayCase(v)
  return v.replace(/\b[A-Z][A-Z'’]{3,}\b/g, (w) => {
    const keep = KEEP[w.toLowerCase()]
    if (keep) return keep
    return w[0] + w.slice(1).toLowerCase()
  })
}
