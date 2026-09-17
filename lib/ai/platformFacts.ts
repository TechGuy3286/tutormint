// lib/ai/platformFacts.ts
//
// THE PLATFORM FACTS SHEET (PR16 §6.1). One canonical statement of how TutorMint
// actually works — fees, plans, what is checked, who can message whom, refunds,
// visibility — passed to EVERY blog generation call so the model writes nothing
// that contradicts the product, and used by the contradiction check (§6.2) that
// blocks publishing a draft that does.
//
// PURE — no imports — so the generation prompt, the publish gate (lib/blog.ts)
// and the tests all read the same words. Update this when the product changes; it
// is the single source the blog is held to.
//
// A published post once claimed TutorMint charges no fees, that experience claims
// are reviewed, that parents hear back quickly, and that verified tutors can
// message parents directly. Every one of those is false, and this sheet plus the
// contradiction check exist to stop the next one.

export const PLATFORM_FACTS_TEXT = [
  'TutorMint — how it actually works (do NOT contradict any of this):',
  '',
  'FEES AND MONEY:',
  '- Tutors pay a ONE-TIME verification fee to become verified (this is what earns the Verified badge, ranking above unverified tutors, applying to tuitions, and reading/replying to parent messages). Do NOT state the price.',
  '- Tutors may optionally buy a MONTHLY membership (Premium or Featured) for more reach. Parents may optionally buy Featured.',
  '- TutorMint takes NO commission on what a tutor charges or a parent pays — "no commission, no middleman". This is NOT the same as "free": the verification fee and memberships are real charges. NEVER say TutorMint is free, charges nothing, has no fees, or is free to join.',
  '- No refunds on any payment.',
  '',
  'WHAT IS CHECKED (verification):',
  '- Tutors are verified by identity documents (CNIC), a reviewed DEGREE certificate, and an introduction video reviewed by the team.',
  '- Parents are verified by CNIC and address.',
  '- EXPERIENCE, fees and subjects a tutor states are SELF-DECLARED and are NOT verified or reviewed. Never claim TutorMint checks, verifies or reviews a tutor’s experience.',
  '',
  'WHO CAN MESSAGE WHOM:',
  '- Any verified parent can message any tutor and request a free demo.',
  '- A tutor can REPLY to parents and apply to tuitions once verified. Only a tutor on the Premium or Featured membership can START a conversation with a parent. A basic verified tutor cannot message parents first.',
  '- Seeing a parent’s or tutor’s phone number is a paid power (Featured parent / Premium-or-higher tutor). Never claim ordinary verified tutors can contact parents directly.',
  '',
  'OUTCOMES:',
  '- TutorMint makes tutors visible to parents searching their subject and area. It does NOT promise tuitions, replies, income, or that anyone will "hear back quickly". Never promise or imply a fast reply, a guaranteed response, or a hire.',
  '',
  'VISIBILITY:',
  '- A tutor appears in search once their mobile is verified and their city, area, subjects and gender are set. The Verified badge, ranking first, and applying require the one-time fee.',
].join('\n')

// ─────────────────────────────────────────────── contradiction check (§6.2) ──
//
// Heuristic, line-scoped, and deliberately conservative to avoid catching the
// legitimate brand line "No fee, no commission, no middleman" (which is about the
// TUTION transaction, not membership). Each rule pairs a trigger with the true
// fact, so the editor message says what is wrong.

type FactRule = { test: RegExp; why: string }

const CONTRADICTIONS: FactRule[] = [
  {
    // "free to join", "completely free", "charges no fee", "no membership fee",
    // "does not charge", "costs nothing" — claims TutorMint takes no money.
    // "no commission" and the exact slogan are NOT matched.
    test: /\b(free to (join|sign ?up|use|register)|completely free|totally free|entirely free|no (membership|sign-?up|joining|registration) fee|charges? (you )?(no|nothing|zero)|does not charge|doesn'?t charge|costs? (you )?nothing|no cost to (join|use|sign))\b/i,
    why: 'TutorMint charges a one-time verification fee and sells memberships — it is not free to join. (You may say "no commission".)',
  },
  {
    // Claims experience is verified/checked/reviewed.
    test: /\bexperience\b[^.]{0,40}\b(is|are|gets?|being)?\s*(verified|checked|reviewed|confirmed|validated)\b/i,
    why: 'A tutor’s experience is self-declared and NOT verified. Only identity, degree and video are checked.',
  },
  {
    // "verify … experience" / "check … experience" (verb before the noun, any
    // words between: "verify every tutor’s experience").
    test: /\b(verif(y|ies|ied|ication|ying)|check(s|ed|ing)?|review(s|ed|ing)?|confirm(s|ed|ing)?|validate(s|d)?)\b[^.]{0,30}\bexperience\b/i,
    why: 'A tutor’s experience is self-declared and NOT verified. Only identity, degree and video are checked.',
  },
  {
    // Promises a fast reply / hearing back quickly / guaranteed response.
    test: /\b(hear back (quickly|fast|soon|within)|quick (reply|replies|response)s? (guaranteed|assured)|guaranteed (reply|response|hire)|respond within \d|replies within \d|get a (fast|quick|guaranteed) (reply|response))\b/i,
    why: 'TutorMint promises visibility, not a fast reply or a guaranteed response.',
  },
  {
    // Claims ordinary/verified tutors can message/contact parents directly.
    test: /\b(verified tutors? can (directly )?(message|contact|call|reach)|tutors? can (directly )?contact parents|message parents directly)\b/i,
    why: 'Only Premium/Featured tutors can start a conversation with a parent; a basic verified tutor can only reply.',
  },
]

/** Lines in the draft that contradict the platform facts (PR16 §6.2). Empty when
 *  clean. Each entry names the offending line and why it is wrong. */
export function contradictionViolations(body: string): { line: string; why: string }[] {
  const out: { line: string; why: string }[] = []
  for (const raw of body.split('\n')) {
    const line = raw.trim()
    if (!line || line.startsWith('|')) continue // skip blanks and table rows
    for (const rule of CONTRADICTIONS) {
      if (rule.test.test(line)) {
        out.push({ line: line.slice(0, 120), why: rule.why })
        break
      }
    }
  }
  return out
}

// ─────────────────────────────────────────────── internal-link check (§6.3) ──

const MD_LINK_RE = /\]\((\/[^)\s]+)\)/g

/** Every internal (site-relative) link target the body uses. */
export function internalLinksIn(body: string): string[] {
  const out: string[] = []
  for (const m of body.matchAll(MD_LINK_RE)) out.push(m[1].split('#')[0].replace(/\/$/, '') || '/')
  return [...new Set(out)]
}

/**
 * Internal links in the body that are NOT in the allowed set (PR16 §6.3 — links
 * must exist). `allowed` is the live set the editor built: published post URLs,
 * live landing pages, plus the always-valid static pages. Returns the offending
 * hrefs; empty when every internal link resolves.
 */
export function invalidInternalLinks(body: string, allowed: string[]): string[] {
  const ok = new Set(allowed.map((h) => h.split('#')[0].replace(/\/$/, '') || '/'))
  // Always-valid destinations a post may link without them being in the live set.
  for (const h of ['/membership-plans', '/faq', '/browse/tutors', '/browse/tuitions', '/about', '/support', '/blog', '/register', '/']) {
    ok.add(h)
  }
  return internalLinksIn(body).filter((h) => !ok.has(h))
}
