// lib/article.ts
//
// "a" or "an", by SOUND, not by spelling.
//
// The bug this fixes: the landing-page CTA read "Looking for a O Levels tutor".
// "O" is a vowel sound ("oh"), so it wants "an". A letter-only rule gets this
// exactly backwards — "O" is not a vowel letter — which is why the choice has
// to be made on how the word is spoken.
//
// Three cases, in order:
//
//   1. ACRONYMS / single capitals ("O", "A", "IGCSE", "SAT", "MDCAT"). Read
//      letter by letter, so the article follows the spoken NAME of the first
//      letter. The letters whose names begin with a vowel sound are
//      A E F H I L M N O R S X — giving "an O Levels", "an A Levels",
//      "an IGCSE", "an FSc", and "a GCSE", "a BSc", "a PhD".
//
//   2. VOWEL-LETTER words with a consonant sound ("university", "European",
//      "one", "useful") — a curated set, because the rule that catches them
//      ("u" said as "you") has no clean regex that does not also swallow
//      "umbrella" and "under".
//
//   3. Everything else: an initial vowel letter takes "an", plus a short
//      silent-h set ("hour", "honest").
//
// Used wherever a subject or level name follows an article — the landing CTAs
// today, and anywhere the blog or a future surface writes "a <subject>".

/** Letters whose spoken name starts with a vowel sound. */
const VOWEL_SOUND_LETTERS = new Set(['A', 'E', 'F', 'H', 'I', 'L', 'M', 'N', 'O', 'R', 'S', 'X'])

/** Vowel-initial words pronounced with a leading consonant ("you"/"w") sound. */
const CONSONANT_SOUND = new Set([
  'university', 'universities', 'unique', 'unit', 'united', 'universal', 'union',
  'uniform', 'unicorn', 'unicef', 'use', 'used', 'useful', 'user', 'usual', 'utility',
  'ubiquitous', 'one', 'once', 'european', 'euro', 'ewe', 'ukulele',
])

/** Consonant-initial words with a silent leading letter, so a vowel sound leads. */
const VOWEL_SOUND_EXCEPTIONS = new Set(['hour', 'honest', 'honour', 'honor', 'heir', 'honourable'])

const VOWEL_LETTERS = /^[aeiou]/i

/**
 * "a" or "an" for the phrase that follows. Looks only at the first word.
 * Returns lowercase; capitalise at the call site if it starts a sentence.
 */
export function article(phrase: string | null | undefined): 'a' | 'an' {
  const trimmed = (phrase ?? '').trim()
  if (!trimmed) return 'a'

  // The first run of letters/digits — drops leading punctuation and stops at a
  // space, so "O Levels" is judged on "O".
  const token = trimmed.match(/[A-Za-z0-9]+/)?.[0] ?? ''
  if (!token) return 'a'

  // 1. An acronym or single capital: all its letters upper-case (allowing
  //    digits, e.g. "O3" or "A2"). Judge by the first letter's spoken name.
  const isAcronym = /^[A-Z0-9]+$/.test(token) && /[A-Z]/.test(token)
  if (isAcronym) {
    return VOWEL_SOUND_LETTERS.has(token[0]) ? 'an' : 'a'
  }

  const lower = token.toLowerCase()

  // 2. Vowel-initial but spoken with a consonant.
  if (CONSONANT_SOUND.has(lower)) return 'a'

  // 3. Silent-leading-consonant, then the plain vowel-letter rule.
  if (VOWEL_SOUND_EXCEPTIONS.has(lower)) return 'an'
  return VOWEL_LETTERS.test(token) ? 'an' : 'a'
}

/** The phrase with its article: `withArticle('O Levels')` → "an O Levels". */
export function withArticle(phrase: string): string {
  return `${article(phrase)} ${phrase}`
}
