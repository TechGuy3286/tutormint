// lib/formatName.ts
//
// THE ONE member-name formatter (#46, owner 5 Oct 2026). Every word starts with
// a capital letter and the rest of the word is lower case: "ali RAZA" → "Ali
// Raza", "FATIMA  noor" → "Fatima Noor". Hyphenated and apostrophe parts are
// each capitalised ("al-rashid" → "Al-Rashid"). Non-Latin scripts (Urdu) have no
// case and pass through unchanged.
//
// Used in TWO places, deliberately:
//   • on WRITE — every path that stores a member's name (signup, pending signup,
//     profile save, parent profile, bulk import, staff invite) stores it in this
//     shape from now on;
//   • on READ — every surface that shows a stored name (cards, public pages,
//     dashboards, inbox, notifications, emails, admin lists) formats it at the
//     mapping point, so names stored BEFORE this rule render the same way
//     without rewriting any row. Display formatting only for existing data; URLs
//     and slugs are never derived from it.
//
// Pure, client-safe, no imports. `properName` in lib/display.ts delegates here.

/** Words that keep their own casing — the brand name on the team account. */
const KEEP: Record<string, string> = { tutormint: 'TutorMint' }

function capWord(w: string): string {
  if (!w) return w
  const keep = KEEP[w.toLowerCase()]
  if (keep) return keep
  return w.charAt(0).toLocaleUpperCase('en') + w.slice(1).toLocaleLowerCase('en')
}

export function formatName(raw: string | null | undefined): string {
  const s = (raw ?? '').trim().replace(/\s+/g, ' ')
  if (!s) return ''
  return s
    .split(' ')
    .map((word) =>
      word
        .split(/([-'’])/)
        .map((part, i) => (i % 2 === 1 ? part : capWord(part)))
        .join(''),
    )
    .join(' ')
}
