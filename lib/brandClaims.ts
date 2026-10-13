// lib/brandClaims.ts
//
// What TutorMint may say about itself (owner, 13 Oct 2026). A cover once read
// "Pakistan's Largest Tutors Network" — not true, and not provable. Pure: the
// cover generator, the cover-upload guard, the AI writer's checker and the
// tests all read these.
//
//   bannedClaims(text)            the superlatives found in a short piece of
//                                 text (a cover line, a banner, an alt text).
//   superlativeClaims(body)       the sentences of a post that make such a
//                                 claim ABOUT TutorMint ("the best time to
//                                 revise" is not a claim about us).
//   brandLine(verifiedTutors)     the one brand line a cover carries, from the
//                                 live count of tutors holding the Verified badge.

const BANNED: { word: string; re: RegExp }[] = [
  { word: 'largest', re: /\blargest\b/i },
  { word: 'biggest', re: /\bbiggest\b/i },
  { word: 'best', re: /\bbest\b/i },
  { word: 'No.1', re: /\bno\.?\s*1\b|\bnumber\s+one\b|\bnumber\s+1\b/i },
  { word: '#1', re: /#\s*1\b/ },
  { word: 'most trusted', re: /\bmost[\s-]+trusted\b/i },
  { word: 'leading', re: /\bleading\b/i },
  { word: 'top-rated', re: /\btop[\s-]+rated\b/i },
]

/** The banned superlatives in a short text, in the words the owner listed.
 *  Empty when the text is clean. */
export function bannedClaims(text: string | null | undefined): string[] {
  const t = (text ?? '').replace(/[’‘]/g, "'")
  return BANNED.filter((b) => b.re.test(t)).map((b) => b.word)
}

/** Refusal in words, or null when the text may be used on a cover or banner. */
export function coverTextProblem(text: string | null | undefined): string | null {
  const found = bannedClaims(text)
  if (found.length === 0) return null
  return `Cover text cannot say “${found.join('”, “')}”. TutorMint makes no claim it cannot prove — remove ${found.length === 1 ? 'that word' : 'those words'}.`
}

const ABOUT_US = /\btutor\s?mint\b|\bour (?:platform|network|site|website|service|team)\b/i
// Superlatives that are a claim when said about a platform; "best" only next to
// a word that names one ("the best platform", "best tutoring site").
const CLAIM: RegExp[] = [
  /\blargest\b/i,
  /\bbiggest\b/i,
  /\bno\.?\s*1\b|\bnumber\s+one\b|#\s*1\b/i,
  /\bmost[\s-]+trusted\b/i,
  /\b(?:the\s+)?leading\b/i,
  /\btop[\s-]+rated\b/i,
  /\bbest\s+(?:\w+\s+){0,2}(?:platform|network|site|website|app|service|marketplace|place|way|choice|option)\b/i,
  /\b(?:platform|network|site|website|app|service|marketplace)\s+(?:is|are)\s+the\s+best\b/i,
]

/**
 * Sentences of a post that make a superlative or unprovable claim about
 * TutorMint. A sentence must name TutorMint (or "our platform") AND carry the
 * claim — "the best time to start revising" is left alone.
 */
export function superlativeClaims(body: string | null | undefined): string[] {
  const out: string[] = []
  const text = (body ?? '').replace(/[’‘]/g, "'")
  for (const raw of text.split(/(?<=[.!?])\s+|\n+/)) {
    const s = raw.replace(/^#{1,6}\s+/, '').trim()
    if (!s || !ABOUT_US.test(s)) continue
    if (CLAIM.some((re) => re.test(s))) out.push(s)
  }
  return out
}

export const BRAND_LINE_GROWING = "Pakistan's fast-growing tutor network"

/**
 * The brand line on a cover, from the live count of tutors who hold the
 * Verified badge: under 100 → "Pakistan's fast-growing tutor network"; 100 or
 * more → "100+ verified tutors across Pakistan", rounded DOWN to the nearest 50
 * ("150+", "200+"). Never a superlative.
 */
export function brandLine(verifiedTutors: number): string {
  const n = Number.isFinite(verifiedTutors) ? Math.floor(verifiedTutors) : 0
  if (n < 100) return BRAND_LINE_GROWING
  return `${Math.floor(n / 50) * 50}+ verified tutors across Pakistan`
}
