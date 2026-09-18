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
  'RANKING AND BADGES (money DOES affect these — do not deny it):',
  '- Premium and Featured tutors rank HIGHER in search than others; verified tutors rank above unverified ones. Payment DOES affect ranking. NEVER claim ranking ignores who pays, that TutorMint does not rank by payment, or that paying does not move a tutor up.',
  '- The Verified badge comes WITH the one-time verification fee (paid) — it is not purely a reflection of unpaid checks. NEVER claim the badge is not tied to payment or is "not a paid placement".',
  '',
  'WHAT IS CHECKED (verification):',
  '- Tutors are verified by identity documents (CNIC), a reviewed DEGREE certificate, and an introduction video reviewed by the team.',
  '- Parents are verified by CNIC and address.',
  '- EXPERIENCE, fees and subjects a tutor states are SELF-DECLARED and are NOT verified or reviewed. Never claim TutorMint checks, verifies or reviews a tutor’s experience.',
  '- NOT every profile is checked before it is visible. UNVERIFIED tutors CAN appear in search (marked "Not verified"). NEVER claim TutorMint checks every tutor’s identity before their profile goes live, or that all visible tutors are verified.',
  '',
  'WHO CAN MESSAGE WHOM:',
  '- Any verified parent can message any tutor and request a free demo.',
  '- A tutor can REPLY to parents and apply to tuitions once verified. Only a tutor on the Premium or Featured membership can START a conversation with a parent. A basic (verified) tutor cannot message parents first.',
  '- Completing a HIRE needs a Featured PARENT. A verified (free) parent can message and request demos but cannot complete a hire.',
  '- Seeing a parent’s or tutor’s phone number is a paid power (Featured parent / Premium-or-higher tutor). Never claim ordinary verified tutors can contact parents directly.',
  '',
  'OUTCOMES (promise NONE of these):',
  '- TutorMint makes tutors visible to parents searching their subject and area. It does NOT promise tuitions, replies, applications, income, hires, or that anyone will "hear back" or "hear from tutors directly". Never promise or imply a reply, a response, an application, a hire, or that a parent will start hearing from tutors.',
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
  {
    // PR17 §4.2 — claims that ranking is NOT influenced by payment. Premium and
    // Featured DO rank higher.
    test: /\b((do(es)?\s?n'?t|does not|do not|never)\s+rank[^.]{0,40}\b(pay|paid|money|more)\b|rank(ing|ed)?[^.]{0,30}\b(is|are)?\s*(not|never)\b[^.]{0,20}\b(paid|pay|money)\b|not\s+(ranked|based on|about)[^.]{0,20}who pays|pay(ing)?\s+(more\s+)?(does not|doesn'?t|will not|won'?t)[^.]{0,20}\b(rank|move you|help you rank))/i,
    why: 'Payment DOES affect ranking — Premium and Featured tutors rank higher, and verified tutors rank above unverified.',
  },
  {
    // PR17 §4.2 — claims the Verified badge is NOT tied to payment.
    test: /\b(verified )?badge\b[^.]{0,60}\b(not|never|isn'?t|is not)\b[^.]{0,30}\b(paid|pay for|purchase|bought|buy|money|paid placement)\b/i,
    why: 'The Verified badge comes with the one-time verification fee — it is tied to a payment, not "checks only".',
  },
  {
    // PR17 §4.2 — claims EVERY tutor is checked before their profile is visible.
    test: /\b(before[^.]{0,50}\b(profile|tutor|they)[^.]{0,20}\b(goes?|going|is|become)\s+(live|visible|listed|public)[^.]{0,50}\b(check|verif|confirm)|(check|verif\w+|confirm\w*)[^.]{0,40}\bbefore[^.]{0,20}\b(profile|they|a tutor)[^.]{0,20}\b(goes?|going|is)\s+(live|visible|listed|public)|every (tutor|profile) is (checked|verified|vetted)|all (tutors|profiles) are (checked|verified|vetted) before)/i,
    why: 'Not every profile is checked before it is visible — unverified tutors can appear in search, marked "Not verified".',
  },
  {
    // PR17 §4.2 — outcome promises (hearing from tutors, guaranteed contact).
    test: /\b((start|begin)\s+(hearing|to hear)\s+from[^.]{0,25}\btutors?\b|hear\s+(back\s+)?from[^.]{0,25}\btutors?\s+(directly|soon|quickly|fast)|you'?ll\s+(start\s+)?(hear|get)[^.]{0,25}\b(replies|responses|tutors|applications)\b)/i,
    why: 'TutorMint promises visibility, not that a parent will hear from tutors or get replies.',
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

// ─────────────────────────────────────────────────── link rules (§4.3) ──
//
// A post carries 3–5 internal links, each target at most once, with at least one
// to a published blog post (when any exist), one to /membership-plans and one to
// /faq, and the link TEXT must match the page type: a /tuitions page reads as
// "open tuitions", a /browse/tutors page as "tutors". Enforced on publish.

const LINK_TEXT_RE = /\[([^\]]+)\]\((\/[^)\s]+)\)/g

type ParsedLink = { text: string; href: string }

function parseLinks(body: string): ParsedLink[] {
  const out: ParsedLink[] = []
  for (const m of body.matchAll(LINK_TEXT_RE)) {
    out.push({ text: m[1].trim(), href: (m[2].split('#')[0].replace(/\/$/, '') || '/') })
  }
  return out
}

// ─────────────────────────────────────── fact-notes topic warning (§4.5) ──
//
// Warn (not block) when the fact notes mention a SUBJECT or LEVEL that differs
// from the post's own subject — the sign that notes from another post were left
// behind (an O Level Physics note on a Grade 1–5 Maths post). Heuristic and
// conservative; it only fires when the notes name a clearly different subject.

const KNOWN_SUBJECTS = [
  'physics', 'chemistry', 'biology', 'mathematics', 'maths', 'math', 'english',
  'urdu', 'islamiat', 'computer', 'accounting', 'economics', 'statistics',
  'history', 'geography', 'pak studies', 'science',
]
const KNOWN_LEVELS = ['o level', 'a level', 'o-level', 'a-level', 'matric', 'intermediate', 'inter', 'igcse']
// The major cities, so a note like "…in Lahore" left over on an Islamabad post
// is caught. Distinctive names, so a substring match is safe here.
const KNOWN_CITIES = [
  'lahore', 'karachi', 'islamabad', 'rawalpindi', 'faisalabad', 'multan',
  'peshawar', 'quetta', 'gujranwala', 'sialkot', 'hyderabad', 'bahawalpur',
  'sargodha', 'abbottabad',
]

/**
 * Warn (not block) when the fact notes name a SUBJECT, LEVEL or CITY different
 * from this post's own — the sign notes from another post were left behind (§2.3).
 * Heuristic and conservative: it only fires on a clearly different, recognised
 * subject/level/city, and only when there is something on the post to compare to.
 */
export function notesTopicMismatch(
  notes: string,
  subject: string | null | undefined,
  city?: string | null | undefined,
): string | null {
  const n = (notes ?? '').toLowerCase()
  if (!n.trim()) return null

  const s = (subject ?? '').trim().toLowerCase()
  if (s) {
    // A subject the notes mention that is NOT the post's subject.
    const foreignSubject = KNOWN_SUBJECTS.find((w) => n.includes(w) && !s.includes(w) && !subjectAlias(w, s))
    if (foreignSubject) {
      return `Your fact notes mention "${foreignSubject}", which is different from this post's subject ("${subject}"). Check the notes belong to this post.`
    }
    // A level the notes mention that is not in the post's subject or title context.
    const foreignLevel = KNOWN_LEVELS.find((w) => n.includes(w) && !s.includes(w))
    if (foreignLevel && KNOWN_LEVELS.some((w) => s.includes(w))) {
      return `Your fact notes mention "${foreignLevel}", a different level from this post. Check the notes belong to this post.`
    }
  }

  const c = (city ?? '').trim().toLowerCase()
  if (c) {
    // A city the notes mention that is NOT the post's city.
    const foreignCity = KNOWN_CITIES.find((w) => n.includes(w) && !c.includes(w))
    if (foreignCity) {
      const shown = foreignCity.charAt(0).toUpperCase() + foreignCity.slice(1)
      return `Your fact notes mention "${shown}", a different city from this post ("${city}"). Check the notes belong to this post.`
    }
  }
  return null
}

/** Treat the maths spellings as one subject so "maths" ≠ foreign on a "Mathematics" post. */
function subjectAlias(word: string, subject: string): boolean {
  const maths = ['math', 'maths', 'mathematics']
  if (maths.includes(word)) return maths.some((m) => subject.includes(m))
  return false
}

export function linkRuleViolations(body: string, opts: { hasPublishedPosts: boolean }): string[] {
  const links = parseLinks(body)
  const v: string[] = []

  // 3–5 links total.
  if (links.length < 3) v.push(`Add more internal links — a post needs 3 to 5, this has ${links.length}.`)
  if (links.length > 5) v.push(`Too many internal links — a post may have at most 5, this has ${links.length}.`)

  // Each target at most once.
  const counts = new Map<string, number>()
  for (const l of links) counts.set(l.href, (counts.get(l.href) ?? 0) + 1)
  for (const [href, n] of counts) {
    if (n > 1) v.push(`Link the same page only once — "${href}" appears ${n} times.`)
  }

  const hrefs = new Set(links.map((l) => l.href))
  if (opts.hasPublishedPosts && ![...hrefs].some((h) => h.startsWith('/blog/'))) {
    v.push('Add one link to a published blog post.')
  }
  if (![...hrefs].some((h) => h === '/membership-plans')) v.push('Add one link to /membership-plans.')
  if (![...hrefs].some((h) => h === '/faq')) v.push('Add one link to /faq.')

  // Link text must match the page type.
  for (const l of links) {
    const isTuitions = l.href.startsWith('/tuitions/') || l.href === '/browse/tuitions'
    const isTutors = l.href.startsWith('/tutors/') || l.href === '/browse/tutors'
    const t = l.text.toLowerCase()
    if (isTuitions && !/\b(tuition|open tuitions|job)\b/.test(t)) {
      v.push(`Link text for a tuitions page should say "open tuitions" — "${l.text}" → ${l.href}`)
    }
    if (isTutors && !/\btutor/.test(t)) {
      v.push(`Link text for a tutors page should say "tutors" — "${l.text}" → ${l.href}`)
    }
  }

  return v
}
