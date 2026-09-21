// lib/abuse/filter.ts
//
// The pure abuse matcher (PR40 §2). Given a piece of text, return which banned
// terms it contains. No I/O, no server-only — so the server flagger and the
// tests read the same decision.
//
// FLAG, DO NOT BLOCK is the caller's job; this only decides "does this contain a
// banned term". It is tuned HARD against false positives (an innocent tutor
// suspended after three false flags cannot easily appeal), so it matches a term
// only as a WHOLE WORD: leetspeak is mapped to letters first, then the term's
// letters are matched in order with any run of NON-LETTERS allowed between them
// and each letter allowed to repeat — catching "fuck", "FUUCK", "f4ck", "f*ck",
// "f u c k", "f.u.c.k", "ch0d", "g@ndu", "sh1t", and standalone Roman-Urdu words
// like "gandu" / "harami" / "kutti".
//
// The two word boundaries — a non-letter (or the string edge) on each side — are
// what stop substring false positives: "the class", "pass", "grass roots",
// "assignment", "analysis", "Gandhi", "Uganda", "Scunthorpe", "shiitake" never
// match, because the banned term is not a whole word there. A non-letter run may
// bridge two letters of a term but never a real letter, so "for u can know" is
// not "fuck".

import { ABUSE_TERMS } from './words'

// Leetspeak → letter. Kept to the common, unambiguous substitutions; a bare "8"
// or "9" is left as a digit (it just acts as a separator) to avoid inventing
// letters inside ordinary text.
const LEET: Record<string, string> = {
  '@': 'a', '4': 'a', '0': 'o', '1': 'i', '!': 'i', '|': 'i', '3': 'e', '5': 's', '$': 's', '7': 't',
}

/** Lowercase and map leetspeak to letters; separators are left as-is. */
function normalizeLeet(s: string): string {
  let out = ''
  for (const ch of s.toLowerCase()) out += LEET[ch] ?? ch
  return out
}

// One compiled regex per term, built once: the term's letters (each allowed to
// repeat) in order, any run of non-letters allowed between them, word-bounded.
const COMPILED: { term: string; re: RegExp }[] = ABUSE_TERMS.map((term) => {
  const chars = term.split('') // terms are a-z only, so no escaping needed
  return { term, re: new RegExp(`(?<![a-z])${chars.map((c) => `${c}+`).join('[^a-z]*')}(?![a-z])`) }
})

/**
 * The banned terms present in `text`, deduplicated. Empty when clean. The result
 * is the list of what MATCHED, for the flag record's "match" field.
 */
export function detectAbuse(text: string | null | undefined): string[] {
  const norm = normalizeLeet(String(text ?? ''))
  if (!norm.trim()) return []
  const hits = new Set<string>()
  for (const c of COMPILED) if (c.re.test(norm)) hits.add(c.term)
  return [...hits]
}

/** Convenience: is there any banned term in the text? */
export function isAbusive(text: string | null | undefined): boolean {
  return detectAbuse(text).length > 0
}
