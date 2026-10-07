// lib/ai/platformFacts.ts
//
// THE BLOG FACT RULES (PR16 §6, rebuilt 7 Oct 2026). What a post may say about
// how TutorMint works comes from ONE place — the facts sheet in lib/ai/
// factsSheet.ts, built from the live plan rows — and the rules below compare a
// post's claims against it. Each rule flags ONLY a sentence that contradicts the
// sheet, and quotes that sentence; a correct statement is never flagged.
//
// Why rebuilt: the old hard-coded sheet said the Verified badge needs a degree
// certificate and an intro video and called the fee a "verification fee". The
// writer repeated it into a published post, and the checker — reading the same
// wrong sheet — flagged a CORRECT messaging sentence instead. The badge rule, the
// fee name and the messaging rights now come from the live facts.
//
// PURE — no network, no server-only import — so the editor (client), the publish
// route and the tests all read the same rules.

import { buildPlatformFacts, factsSheetText, type PlatformFacts } from './factsSheet'
import { staticValidPaths } from './blogRoutes'

/** The facts sheet from the built-in plan rows. The LIVE sheet travels on the
 *  brief (lib/blogGenerate) and the editor props; this default serves code that
 *  has no request (tests, fallbacks). */
export const PLATFORM_FACTS_TEXT = factsSheetText(buildPlatformFacts())

// The link map and the checker's valid-page list are ONE list (PR36 §2), defined
// in lib/ai/blogRoutes.ts and re-exported here for the existing importers.
export { LINK_MAP as PLATFORM_LINK_MAP, LINK_MAP_TEXT } from './blogRoutes'

// ───────────────────────────────────────────────────────── fact rules ──

/** One flagged sentence. `match` is the sentence exactly as it appears in the
 *  body (so "Fix with AI" can find it); `line` is the same sentence as plain
 *  words for display. `suggestion`, when set, is a corrected version. */
export type FactViolation = {
  kind: string
  line: string
  match: string
  why: string
  heading: string | null
  suggestion?: string
}

type Hit = { index: number; text: string }
type FactRule = {
  kind: string
  why: string
  find: (sentence: string) => Hit | null
  /** A deterministic corrected sentence, when one is obvious. */
  fix?: (sentence: string) => string
}

const re = (r: RegExp) => (s: string): Hit | null => {
  const m = r.exec(s)
  return m ? { index: m.index, text: m[0] } : null
}

// A negation just before the matched phrase means the sentence DENIES the false
// claim ("TutorMint never promises tuitions") rather than making it.
const DENIAL_BEFORE = /\b(no|not|never|isn'?t|aren'?t|doesn'?t|don'?t|won'?t|cannot|can'?t|without)\b[^.?!]{0,12}$/i

const FEE_NAME_RE =
  /\b(?:verification|verify|verified|registration|sign-?up|listing|joining|profile|badge|activation)\s+fees?\b/i

const BADGE_WORD = /\b(verified badge|the badge|verified|verification|get verified|getting verified)\b/i
const BADGE_ITEM = /\b(degree|degrees|certificate|certificates|intro(?:duction)? video|video introduction)\b/i
const REQUIRE_WORD = /\b(requires?|required|needs?|needed|must|includes?|including|comes? with|on file|depends on|based on|proof of|by (?:uploading|submitting|adding|providing|having))\b/i
const OPTIONAL_WORD = /\b(optional|not (?:needed|required|necessary)|(?:is|are)n'?t (?:needed|required)|(?:do|does)(?: not|n'?t) need|no need|not a requirement)\b/i

function rulesFor(facts: PlatformFacts): FactRule[] {
  const fee = facts.feeLabel
  const order = facts.searchOrder.join(', then ')
  const nonInitiators = facts.tutorPlans.filter((p) => !p.canInitiateMessage).map((p) => p.name.toLowerCase())

  const rules: FactRule[] = [
    {
      kind: 'free_demo',
      why: 'A demo is a demo lesson — never call it free.',
      find: re(/\bfree\s+demos?\b/i),
      fix: (s) => s.replace(/\bfree\s+(demos?)\b/gi, '$1'),
    },
    {
      kind: 'fee_name',
      why: `The one-time fee is always called the “${fee}”.`,
      find: re(FEE_NAME_RE),
      fix: (s) => s.replace(new RegExp(FEE_NAME_RE.source, 'gi'), fee),
    },
    {
      kind: 'free_claim',
      why: `Signing up is free, but the ${fee} and the paid plans are real charges — never say TutorMint has no fee or is completely free.`,
      find: (s) => {
        // Browsing, signing up, posting and a parent's CNIC check really are
        // free — "Browsing tutors and tuitions is completely free" is correct.
        if (/\b(?:brows\w*|sign(?:ing)? ?up|register\w*|join\w*|posting|post a tuition)\b/i.test(s)) return null
        const m =
          /\b(?:completely free|totally free|entirely free|100% free|no fees?(?! (?:to|for) (?:browse|browsing|sign|join|regist|post|search|create|parents))|charges? (?:you )?(?:no fees?|nothing|zero)|does(?: not|n'?t) charge (?:you )?(?:anything|a fee|any fees?|fees)|costs? (?:you )?nothing|never pay anything)\b/i.exec(s)
        return m ? { index: m.index, text: m[0] } : null
      },
    },
    {
      kind: 'badge_rule',
      why: `The Verified badge comes from the ${fee} plus a CNIC, a profile photo and a selfie. A degree, certificates and an intro video are optional and not needed for any badge.`,
      find: (s) => {
        if (!BADGE_WORD.test(s) || !BADGE_ITEM.test(s) || OPTIONAL_WORD.test(s)) return null
        const m = REQUIRE_WORD.exec(s)
        return m ? { index: m.index, text: m[0] } : null
      },
    },
    {
      kind: 'experience_checked',
      why: 'A tutor’s experience is self-declared — TutorMint does not check it.',
      find: re(/\bexperience\b[^.]{0,40}\b(?:is|are|gets?|being)?\s*(?:verified|checked|reviewed|confirmed|validated)\b/i),
    },
    {
      kind: 'experience_checked',
      why: 'A tutor’s experience is self-declared — TutorMint does not check it.',
      find: re(/\b(?:verif(?:y|ies|ied|ying)|check(?:s|ed|ing)?|review(?:s|ed|ing)?|confirm(?:s|ed|ing)?|validate(?:s|d)?)\b[^.]{0,30}\bexperience\b/i),
    },
    {
      kind: 'promise',
      why: 'TutorMint promises visibility only — never a reply, a tuition, a hire or income.',
      find: re(
        /\b(?:hear back (?:quickly|fast|soon|within)|guaranteed (?:reply|replies|response|hire|tuitions?|students?|income|work)|respond within \d|replies within \d|get a (?:fast|quick|guaranteed) (?:reply|response)|(?:guarantees?|promises?) (?:you )?(?:(?:a|an|more|new|your first) )?(?:tuitions?|students?|income|hires?|jobs?|work|earnings|replies|clients)|you(?:'ll| will) (?:definitely |surely |certainly )?(?:get|receive|land) (?:(?:a|an|more|new|your first|plenty of|lots of) )?(?:tuitions?|students?|hires?|clients|replies)|(?:start|begin) (?:hearing|to hear) from[^.]{0,25}\btutors?\b)\b/i,
      ),
    },
    {
      kind: 'messaging',
      why: `Only a tutor who has paid the ${fee} can apply to tuitions or reply to parents.`,
      find: (s) => {
        const a = /\b(?:unverified|non-verified|not-verified) tutors? can (?:still )?(?:reply|message|apply|contact|start|chat)\b/i.exec(s)
        if (a) return { index: a.index, text: a[0] }
        const b = /\bwithout (?:paying|verifying|verification|the fee)\b[^.]{0,40}\b(?:you|tutors?) can (?:still )?(?:apply|reply|message|contact)\b/i.exec(s)
        return b ? { index: b.index, text: b[0] } : null
      },
    },
    {
      kind: 'parent_verify',
      why: 'Parents verify their CNIC and address (free) before they can post a tuition, message a tutor or request a demo.',
      find: re(
        /\b(?:parents? can (?:post|message|request|contact)[^.]{0,40}\bwithout (?:verif\w*|a cnic|any verification)|no verification (?:is )?(?:needed|required) (?:for|to) (?:parents|post|message))\b/i,
      ),
    },
    {
      kind: 'ranking',
      why: `Search order is ${order}. Paid plans do rank higher.`,
      find: re(
        /\b(?:(?:do(?:es)?\s?n'?t|does not|do not|never)\s+rank[^.]{0,40}\b(?:pay|paid|money|more)\b|rank(?:ing|ed)?[^.]{0,30}\b(?:is|are)?\s*(?:not|never)\b[^.]{0,20}\b(?:paid|pay|money)\b|not\s+(?:ranked|based on|about)[^.]{0,20}who pays|pay(?:ing)?\s+(?:more\s+)?(?:does not|doesn'?t|will not|won'?t)[^.]{0,20}\b(?:rank|move you|help you rank))/i,
      ),
    },
    {
      kind: 'badge_paid',
      why: `The Verified badge comes with the ${fee} — it is tied to that payment.`,
      find: re(/\b(?:verified )?badge\b[^.]{0,60}\b(?:not|never|isn'?t|is not)\b[^.]{0,30}\b(?:paid|pay for|purchase|bought|buy|money|paid placement)\b/i),
    },
    {
      kind: 'all_checked',
      why: 'A tutor can appear in Browse before verification — unverified tutors are shown as “Not verified”.',
      find: re(
        /\b(?:every (?:tutor|profile) is (?:checked|verified|vetted)|all (?:tutors|profiles) are (?:checked|verified|vetted)|before[^.]{0,50}\b(?:profile|tutor|they)[^.]{0,20}\b(?:goes?|going|is|become)\s+(?:live|visible|listed|public)[^.]{0,50}\b(?:check|verif|confirm)\w*|(?:check|verif\w+|confirm\w*)[^.]{0,40}\bbefore[^.]{0,20}\b(?:profile|they|a tutor)[^.]{0,20}\b(?:goes?|going|is)\s+(?:live|visible|listed|public))\b/i,
      ),
    },
    {
      kind: 'refund',
      why: `Payments are not refundable — the ${fee} and plans carry no refund.`,
      find: (s) => {
        const m = /\b(?:refundable|money[- ]back|refunds? (?:are|is) (?:available|possible|given|offered)|get (?:a|your|a full) refund|full refund)\b/i.exec(s)
        if (!m) return null
        if (/non-$/i.test(s.slice(0, m.index))) return null // "non-refundable" is correct
        return { index: m.index, text: m[0] }
      },
    },
    {
      kind: 'commission',
      why: 'TutorMint takes no commission.',
      find: (s) => {
        const m = /\b(?:takes?|charges?|keeps?|deducts?) (?:a |any |its )?(?:commission|cut|percentage)\b/i.exec(s)
        if (!m) return null
        // "We do not set fees, … or take a commission" denies it, however far
        // the "not" sits from the verb.
        if (/\b(?:no|not|never|without)\b|n't\b/i.test(s.slice(0, m.index))) return null
        return { index: m.index, text: m[0] }
      },
    },
  ]

  // Starting a conversation: flag only an OVER-claim — a plan said to start
  // conversations when the live plan cannot. A restrictive sentence ("Only
  // Premium and Featured tutors can start a conversation") is never flagged:
  // it sends nobody to expect a right they lack.
  if (nonInitiators.length > 0) {
    const names = nonInitiators.map((n) => n.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|')
    rules.push({
      kind: 'messaging',
      why: `Only ${facts.tutorInitiators.join(' and ')} tutors can start a conversation with a parent; others reply when a parent writes first.`,
      find: re(
        new RegExp(
          `\\b(?:(?:${names})(?:[- ]plan)? tutors? can (?:directly )?(?:start|initiate|begin|message|contact|reach)|any (?:verified )?tutor can (?:start|initiate|message|contact) (?:a )?(?:conversation|parents?)|message parents directly)\\b`,
          'i',
        ),
      ),
    })
  }
  return rules
}

const HEADING_RE = /^#{1,6}\s+/
const ANSWER_DENIES = /^\s*(no\b|nope\b|not\b)|(\bis not\b|\bisn'?t\b|\bdoes not\b|\bdoesn'?t\b|\bthere is no\b|\bnot free\b|\bone-?time\b|\boptional\b)/i

/** The answer under a heading: the following non-empty, non-heading lines. */
function answerUnder(lines: string[], headingIndex: number): string {
  const parts: string[] = []
  for (let j = headingIndex + 1; j < lines.length; j++) {
    const t = lines[j].trim()
    if (!t) {
      if (parts.length) break
      continue
    }
    if (HEADING_RE.test(t)) break
    parts.push(t)
    if (parts.length >= 2) break
  }
  return parts.join(' ')
}

/** A line split into sentences, each exactly as written. */
export function sentencesOf(line: string): string[] {
  return line
    .split(/(?<=[.!?])\s+(?=[A-Z"“‘(*\[])/)
    .map((s) => s.trim())
    .filter(Boolean)
}

/** Markdown marks off, for display. */
function plain(md: string): string {
  return md
    .replace(/^#{1,6}\s+/, '')
    .replace(/^\s*(?:[-*+]|\d+\.)\s+/, '')
    .replace(/\[([^\]]+)\]\([^)\s]*\)/g, '$1')
    .replace(/[*_`>]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
}

/**
 * Sentences that contradict the facts sheet, each quoted (owner, 7 Oct 2026).
 * Empty when clean. A sentence that DENIES a false claim is not flagged, and a
 * QUESTION heading is judged with its answer ("Is the badge paid?" answered
 * correctly is fine). Table rows are checked too — a table can make a claim.
 */
export function contradictionViolations(body: string, facts: PlatformFacts = buildPlatformFacts()): FactViolation[] {
  const rules = rulesFor(facts)
  const out: FactViolation[] = []
  const lines = body.split('\n')
  let heading: string | null = null

  const check = (sentence: string, where: string | null, isHeading = false) => {
    // Curly apostrophes read as straight ones, so “doesn’t” denies like "doesn't".
    const norm = sentence.replace(/[’‘]/g, "'")
    // A question in the body ASKS, it claims nothing ("Are memberships
    // refundable?"). Question HEADINGS are judged with their answer below.
    if (!isHeading && /\?\s*$/.test(plain(norm))) return
    const kinds = new Set<string>()
    for (const rule of rules) {
      if (kinds.has(rule.kind)) continue // each kind once per sentence
      const hit = rule.find(norm)
      if (!hit) continue
      if (DENIAL_BEFORE.test(norm.slice(0, hit.index))) continue
      const fixed = rule.fix ? rule.fix(sentence) : undefined
      out.push({
        kind: rule.kind,
        line: plain(sentence).slice(0, 240),
        match: sentence,
        why: rule.why,
        heading: where,
        suggestion: fixed && fixed !== sentence ? plain(fixed) : undefined,
      })
      kinds.add(rule.kind)
    }
  }

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim()
    if (!line) continue
    if (HEADING_RE.test(line)) {
      heading = plain(line)
      if (heading.endsWith('?')) {
        const before = out.length
        check(line, heading, true)
        // A correctly answered question is not a contradiction.
        if (out.length > before && ANSWER_DENIES.test(answerUnder(lines, i))) out.length = before
      }
      continue
    }
    if (line.startsWith('|')) {
      for (const cell of line.split('|').map((c) => c.trim()).filter(Boolean)) check(cell, heading)
      continue
    }
    for (const s of sentencesOf(line)) check(s, heading)
  }
  return out
}

// ───────────────────────────────────────────── prices, CTA, meta (§4) ──

const PRICE_RE = /\b(?:Rs\.?|PKR|Rupees?)\s?\d[\d,.]*\s?(?:k\b|\/-)?|\b\d[\d,.]*\s?(?:k\s)?(?:rupees|PKR)\b|\b\d[\d,]*\s?\/-/i

/** Sentences that state a price or a Rs amount — never allowed in a post. */
export function priceViolations(body: string): { line: string; match: string; heading: string | null; amount: string }[] {
  const out: { line: string; match: string; heading: string | null; amount: string }[] = []
  let heading: string | null = null
  for (const raw of body.split('\n')) {
    const line = raw.trim()
    if (!line) continue
    if (HEADING_RE.test(line)) heading = plain(line)
    const parts = line.startsWith('|') ? line.split('|').map((c) => c.trim()).filter(Boolean) : sentencesOf(line)
    for (const s of parts) {
      const m = PRICE_RE.exec(s)
      if (m) out.push({ line: plain(s).slice(0, 240), match: s, heading, amount: m[0].trim() })
    }
  }
  return out
}

/** Where the closing call to action links, by audience (owner, 7 Oct 2026). */
export function ctaPathFor(audience: 'parents' | 'tutors' | 'both'): string {
  return audience === 'tutors' ? '/apply' : audience === 'parents' ? '/browse/tutors' : '/browse/tuitions'
}

/** The link text the fixer uses for the CTA link. */
export function ctaLinkTextFor(audience: 'parents' | 'tutors' | 'both'): string {
  return audience === 'tutors' ? 'create your free tutor profile' : audience === 'parents' ? 'browse tutors near you' : 'see open tuitions'
}

/** The closing call-to-action paragraph: the last prose block, skipping the
 *  "More on TutorMint" link line, headings, tables and embeds. */
export function closingParagraph(body: string): string | null {
  const blocks = body.split(/\n\s*\n/).map((b) => b.trim()).filter(Boolean)
  for (let i = blocks.length - 1; i >= 0; i--) {
    const b = blocks[i]
    if (/^More on TutorMint:/i.test(b)) continue
    if (HEADING_RE.test(b) || b.startsWith('|') || b.startsWith('{{')) continue
    return b
  }
  return null
}

/** The closing CTA has no link → a problem (owner, 7 Oct 2026). */
export function ctaViolation(body: string, audience: 'parents' | 'tutors' | 'both'): { match: string; line: string; path: string } | null {
  const p = closingParagraph(body)
  if (p == null) return null
  if (/\]\(\/[^)\s]*\)/.test(p)) return null
  return { match: p, line: plain(p).slice(0, 240), path: ctaPathFor(audience) }
}

const TAGLINE_RE = /\bno fee,?\s*no commission|\bno middleman\b/i
export const SEO_TITLE_LIMIT = 60
export const SEO_DESCRIPTION_LIMIT = 155

/** SEO title / meta description problems: length, the site tagline, and a meta
 *  description that contradicts the facts (owner, 7 Oct 2026). */
export function seoFieldViolations(
  seo: { title: string; description: string },
  facts: PlatformFacts = buildPlatformFacts(),
): { field: 'seoTitle' | 'seoDescription'; message: string }[] {
  const out: { field: 'seoTitle' | 'seoDescription'; message: string }[] = []
  const t = seo.title.trim()
  const d = seo.description.trim()
  if (t.length > SEO_TITLE_LIMIT) out.push({ field: 'seoTitle', message: `The SEO title is ${t.length} characters — keep it to ${SEO_TITLE_LIMIT}.` })
  if (d.length > SEO_DESCRIPTION_LIMIT) out.push({ field: 'seoDescription', message: `The meta description is ${d.length} characters — keep it to ${SEO_DESCRIPTION_LIMIT}.` })
  if (TAGLINE_RE.test(d)) {
    out.push({ field: 'seoDescription', message: 'The meta description uses the site tagline (“No fee, no commission, no middleman”) — describe this post instead.' })
  } else {
    for (const v of contradictionViolations(d, facts)) {
      out.push({ field: 'seoDescription', message: `The meta description contradicts the facts: “${v.line}” — ${v.why}` })
    }
  }
  if (TAGLINE_RE.test(t)) out.push({ field: 'seoTitle', message: 'The SEO title uses the site tagline — describe this post instead.' })
  return out
}

/** Links to pages Google is told not to index right now, each with the page to
 *  link instead. `noindexLinks` maps a path to its replacement. */
export function noindexLinkViolations(body: string, noindexLinks: Record<string, string>): { href: string; instead: string }[] {
  const out: { href: string; instead: string }[] = []
  for (const href of internalLinksIn(body)) {
    const instead = noindexLinks[href]
    if (instead) out.push({ href, instead })
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
  // The always-valid static pages come from the ONE shared list (PR36 §2), the
  // same list the AI link map is built from — so a page the AI is told to link
  // (e.g. /parent/dashboard/post-job) is never rejected here.
  for (const h of staticValidPaths()) ok.add(h.split('#')[0].replace(/\/$/, '') || '/')
  return internalLinksIn(body).filter((h) => !ok.has(h))
}

// ─────────────────────────────────────────────────── link rules (§4.3) ──
//
// A post carries 3–5 internal links, each target at most once (owner, 6 Oct
// 2026 — supersedes the /membership-plans + /faq requirement of PR17/PR35):
//   • at least ONE to a live tuition, city or city × subject page
//     (/tuition-jobs/<city>, /tutors/<city>/<subject>, /tuitions/<city>/<subject>);
//   • at least ONE to another published blog post or an indexable tutor
//     profile (/blog/<slug> or /tutor/<slug>);
//   • /membership-plans is never required (pricing is never pushed from a
//     post); /faq is optional.
// Link text must be descriptive — only generic text ("click here", "this page",
// "a related guide") is flagged (owner, 7 Oct 2026). Enforced on publish.

const LINK_TEXT_RE = /\[([^\]]+)\]\((\/[^)\s]+)\)/g

/** A live tuition page, a city × subject landing page, or a city tuition-jobs page. */
export const LANDING_OR_TUITION_RE = /^\/(?:(?:tutors|tuitions)\/[^/]+\/[^/]+|tuition-jobs\/[^/]+(?:\/[^/]+)?)$/
/** Another blog post, or a tutor profile. */
export const POST_OR_PROFILE_RE = /^\/(blog|tutor)\/[^/]+$/

export function isLandingOrTuitionLink(href: string): boolean {
  return LANDING_OR_TUITION_RE.test(href.split('#')[0].replace(/\/$/, ''))
}
export function isPostOrProfileLink(href: string): boolean {
  return POST_OR_PROFILE_RE.test(href.split('#')[0].replace(/\/$/, ''))
}

export type LinkRuleContext = {
  /** Any published post exists (another post can satisfy the second rule). */
  hasPublishedPosts: boolean
  /** Any indexable tutor profile exists (a profile can satisfy the second rule). */
  hasTutorProfiles?: boolean
  /** Any live landing page exists; when none do, the landing rule is skipped. */
  hasLandingPages?: boolean
}

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

// Link text that tells a reader nothing (owner, 7 Oct 2026). Descriptive text —
// "open tuitions for Grade 3 Mathematics in Karachi", "Tuition jobs in Karachi" —
// is always accepted; only these generic phrases are flagged.
const GENERIC_LINK_TEXT =
  /^(?:click here|here|this|this page|this link|this post|this article|this guide|a related guide|related guide|a guide|read more|learn more|see more|more|link|see here|go here|find out more)$/i

export function isGenericLinkText(text: string): boolean {
  return GENERIC_LINK_TEXT.test(text.replace(/[.!?:,"“”'‘’]/g, '').replace(/\s+/g, ' ').trim())
}

export function linkRuleViolations(body: string, opts: LinkRuleContext): string[] {
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

  const hrefs = [...new Set(links.map((l) => l.href))]
  if (opts.hasLandingPages !== false && !hrefs.some(isLandingOrTuitionLink)) {
    v.push('Add one link to a live tuition, city or city × subject landing page (a /tuition-jobs/<city>, /tutors/<city>/<subject> or /tuitions/<city>/<subject> page).')
  }
  if ((opts.hasPublishedPosts || opts.hasTutorProfiles) && !hrefs.some(isPostOrProfileLink)) {
    v.push('Add one link to another blog post or an indexable tutor profile.')
  }
  if (hrefs.includes('/membership-plans')) {
    v.push('Remove the link to /membership-plans — a post never pushes pricing.')
  }

  for (const l of links) {
    if (isGenericLinkText(l.text)) {
      v.push(`Use descriptive link text — “${l.text}” does not say where ${l.href} goes.`)
    }
  }

  return v
}
