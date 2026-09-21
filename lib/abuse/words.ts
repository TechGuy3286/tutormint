// lib/abuse/words.ts
//
// THE ABUSE WORD LIST — English and Roman Urdu — in ONE place (PR40 §2).
//
// HOW TO EXTEND: add the plain lowercase term to the right array below. The
// matcher (lib/abuse/filter.ts) already handles, for every term:
//   - case ("FUCK" == "fuck"),
//   - leetspeak substitutions (f4ck, ch0d, g@ndu, sh1t),
//   - separators / censoring between letters (f u c k, f.u.c.k, f-u-c-k, f*ck),
//   - repeated letters (fuuuck, chodddu).
// So add the BASE spelling only; do not add spaced or leet variants. Add an
// explicit censored variant (e.g. "fck") only when a letter is commonly dropped.
//
// AVOID FALSE POSITIVES. Every term is matched as a WHOLE WORD (bounded by a
// non-letter or the string edge), never as a substring — so "class", "pass",
// "grass", "assignment", "Gandhi", "Uganda", "analysis" never match. Do NOT add
// a term that is a normal word or a fragment of one (e.g. never add bare "ass",
// "sex ed" material words, "hell", "damn"). When in doubt, leave it out — a
// missed slur is a report not raised; a false positive suspends an innocent
// tutor who cannot easily appeal.
//
// PURE data — imported by the pure matcher, the server flagger and the tests.

/** English obscenities and slurs. Whole-word, leet/spacing-tolerant. */
export const ABUSE_EN: string[] = [
  'fuck', 'fuk', 'fck', 'fucker', 'fuckin', 'fucking', 'motherfucker', 'mofo',
  'bitch', 'bitches', 'bastard', 'asshole', 'arsehole', 'dick', 'dickhead',
  'pussy', 'slut', 'whore', 'cunt', 'cock', 'bollocks', 'wanker', 'shit',
  'bullshit', 'nigga', 'nigger', 'faggot', 'retard',
  // Sexual propositions (whole-word; kept conservative to avoid edu false hits).
  'nude', 'nudes', 'sexy', 'horny', 'boobs', 'penis', 'sexchat', 'hookup',
]

/** Roman Urdu obscenities, slurs and propositions. Distinctive spellings only. */
export const ABUSE_UR: string[] = [
  'gandu', 'gaand', 'gand', 'harami', 'haramzada', 'haramzadi', 'haramkhor',
  'kutta', 'kutti', 'kuttay', 'kutte', 'kuttiya',
  'chutiya', 'chutya', 'chutiye', 'chutyapa', 'chutmarani',
  'madarchod', 'madarchood', 'behenchod', 'bhenchod', 'benchod',
  'bhosdi', 'bhosdike', 'bhosda', 'bhosdiwala',
  'lund', 'lauda', 'laura', 'loda', 'lawda',
  'phudi', 'phuddi', 'fuddi', 'choot', 'chut',
  'chod', 'chood', 'chodu', 'chudai', 'chodna',
  'tatti', 'randi', 'raand', 'jhaant', 'jhant', 'gashti', 'kanjar', 'kanjri',
  'tharki', 'kamini', 'kamina', 'kaminey', 'suar', 'sooar',
]

/** Every banned term, one list. */
export const ABUSE_TERMS: string[] = [...ABUSE_EN, ...ABUSE_UR]
