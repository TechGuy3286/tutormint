// lib/memberNamesCore.ts
//
// TWO NAMES (owner, 5 Nov 2026; migration 224). PURE — the save routes, the
// admin screens and the tests read the same rules.
//
//   Name on CNIC   profiles.cnic_name — the legal name, used ONLY for
//                  verification. Never shown publicly or to another member.
//                  Locked for the member once the CNIC is approved (staff
//                  change it, reason required, logged).
//   Display name   profiles.display_name — optional; shown everywhere public
//                  and to other members.
//   full_name      what every existing reader already uses — DERIVED by the
//                  database (trigger profiles_sync_names): the Display name
//                  when set, else the Name on CNIC. So public pages, cards,
//                  messages, the CV, social posts, og tags and JSON-LD all show
//                  the Display name with no change of their own.

export const DISPLAY_NAME_MAX = 60
export const CNIC_NAME_MAX = 120

export function normaliseName(s: string | null | undefined): string {
  return (s ?? '').toLowerCase().replace(/[^a-z0-9؀-ۿ]+/g, ' ').replace(/\s+/g, ' ').trim()
}

/** The name a member is shown by: the Display name, else the Name on CNIC. */
export function effectiveName(displayName: string | null | undefined, cnicName: string | null | undefined): string {
  return (displayName ?? '').trim() || (cnicName ?? '').trim()
}

/** Does the Name on CNIC differ from the shown name (so admin should show both)? */
export function cnicNameDiffers(shown: string | null | undefined, cnicName: string | null | undefined): boolean {
  const c = normaliseName(cnicName)
  return c.length > 0 && c !== normaliseName(shown)
}

/** Admin shows both: "Alee Sabeer (CNIC: Sabir Ali)" — or just the name when they match. */
export function adminNameLabel(shown: string | null | undefined, cnicName: string | null | undefined): string {
  const s = (shown ?? '').trim()
  if (!cnicNameDiffers(s, cnicName)) return s
  return `${s} (CNIC: ${(cnicName ?? '').trim()})`
}

// ----------------------------------------------------------- Display name check

/** Words that make a Display name look like TutorMint or its staff. */
const IMPERSONATION = [
  'tutormint', 'tutor mint', 'tutor-mint', 'tutor_mint',
  'admin', 'administrator', 'moderator', 'support', 'helpdesk', 'help desk',
  'official', 'staff', 'team', 'customer care', 'customer service',
]

/** A short list of offensive words (English and Roman Urdu), whole words only. */
const OFFENSIVE = [
  'fuck', 'fucker', 'shit', 'bitch', 'bastard', 'asshole', 'dick', 'cunt', 'slut', 'whore', 'porn', 'sex',
  'chutiya', 'chutiye', 'harami', 'haramzada', 'haramzadi', 'kutta', 'kutti', 'kamina', 'kamini', 'gandu',
  'bhenchod', 'behenchod', 'madarchod', 'bhosdi', 'randi', 'lun', 'lund', 'phuddi', 'gashti',
]

export const DISPLAY_NAME_PROBLEMS = {
  short: 'Write at least 2 letters, or leave the Display name empty.',
  long: `Keep the Display name to ${DISPLAY_NAME_MAX} characters.`,
  chars: 'Use letters, spaces, dots, hyphens and apostrophes only.',
  impersonation: 'Choose a Display name that does not name TutorMint or its staff.',
  staff: 'That name belongs to a TutorMint staff member. Choose another Display name.',
  offensive: 'Choose a Display name without offensive words.',
} as const

function hasWord(text: string, word: string): boolean {
  const t = ` ${normaliseName(text)} `
  const w = normaliseName(word)
  return w.length > 0 && t.includes(` ${w} `)
}

/**
 * Why this Display name cannot be used, or null. An empty value is allowed
 * (it means "use my Name on CNIC"). `staffNames` are the names of active staff
 * accounts; a staff member's own name is fine for themselves (`ownNames`).
 */
export function displayNameProblem(
  value: string | null | undefined,
  opts: { staffNames?: string[]; ownNames?: string[] } = {},
): string | null {
  const v = (value ?? '').replace(/\s+/g, ' ').trim()
  if (v === '') return null
  if (v.length < 2) return DISPLAY_NAME_PROBLEMS.short
  if (v.length > DISPLAY_NAME_MAX) return DISPLAY_NAME_PROBLEMS.long
  if (!/^[\p{L}\p{M}][\p{L}\p{M} .'’-]*$/u.test(v)) return DISPLAY_NAME_PROBLEMS.chars
  const squashed = normaliseName(v).replace(/ /g, '')
  if (squashed.includes('tutormint')) return DISPLAY_NAME_PROBLEMS.impersonation
  if (IMPERSONATION.some((w) => hasWord(v, w))) return DISPLAY_NAME_PROBLEMS.impersonation
  if (OFFENSIVE.some((w) => hasWord(v, w))) return DISPLAY_NAME_PROBLEMS.offensive
  const own = new Set((opts.ownNames ?? []).map(normaliseName).filter(Boolean))
  const n = normaliseName(v)
  if ((opts.staffNames ?? []).some((s) => normaliseName(s) === n && !own.has(n))) return DISPLAY_NAME_PROBLEMS.staff
  return null
}

/** Why this Name on CNIC cannot be saved, or null. */
export function cnicNameProblem(value: string | null | undefined): string | null {
  const v = (value ?? '').replace(/\s+/g, ' ').trim()
  if (v.length < 2) return 'Write your name exactly as it is on your CNIC.'
  if (v.length > CNIC_NAME_MAX) return `Keep the Name on CNIC to ${CNIC_NAME_MAX} characters.`
  if (!/^[\p{L}\p{M}][\p{L}\p{M} .'’-]*$/u.test(v)) return 'Use letters, spaces, dots, hyphens and apostrophes only.'
  return null
}

/** Is the Name on CNIC locked for the member (the CNIC is approved)? */
export function cnicNameLocked(p: { cnic_verified_at?: string | null; verification_state?: string | null }): boolean {
  return !!p.cnic_verified_at || (p.verification_state ?? '').toLowerCase() === 'approved'
}
