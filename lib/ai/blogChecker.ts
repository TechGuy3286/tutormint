// lib/ai/blogChecker.ts
//
// Two pure things the blog editor and the generation pipeline both need (PR35):
//
//   sanitizeDraft()      — the DETERMINISTIC fixer (§3). After a draft is
//                          assembled it makes the mechanical problems go away by
//                          construction: full tutormint.org URLs become relative,
//                          a link repeated after its first use is unlinked,
//                          "free demo" loses the "free", and the required links
//                          are added in a closing paragraph if missing. A draft
//                          out the far side of this passes every LINK rule.
//
//   collectBlogProblems() — the CHECKER (§4). One plain-text list of EVERY
//                          problem at once, each naming the section it is in, so
//                          the editor shows them together instead of one at a
//                          time. It is the same set the publish route enforces,
//                          so the editor and the server cannot disagree.
//
// THE REQUIRED LINKS (owner, 6 Oct 2026 — supersedes PR35's /membership-plans +
// /faq + one post): 3–5 internal links, each once; at least ONE to a live
// tuition or city × subject landing page; at least ONE to another blog post or
// an indexable tutor profile. /membership-plans is never required (pricing is
// never pushed from a post) and /faq is optional. The rule itself lives in
// lib/ai/platformFacts linkRuleViolations; this file composes it.
//
// PURE — no network, no server-only import — so the editor (client), the publish
// route (server) and the tests all read the same rules. It draws the individual
// rules from lib/ai/platformFacts.ts and lib/ai/blogBrief.ts; this file only
// composes them into one fixer and one list.

import {
  contradictionViolations,
  ctaLinkTextFor,
  ctaPathFor,
  ctaViolation,
  closingParagraph,
  internalLinksIn,
  invalidInternalLinks,
  isLandingOrTuitionLink,
  isPostOrProfileLink,
  linkRuleViolations,
  noindexLinkViolations,
  priceViolations,
  seoFieldViolations,
} from './platformFacts'
import { staticValidPaths, suggestValidPage } from './blogRoutes'
import { scaffoldViolations, promptLeakViolations } from './blogBrief'
import { buildPlatformFacts, type PlatformFacts } from './factsSheet'

// ─────────────────────────────────────────────────────────── plain text ──
//
// A warning must read as words, never as raw Markdown (§4): no "###", no
// "[text](/path)". This strips the marks a warning line might carry.
export function plainText(md: string): string {
  return md
    .replace(/^#{1,6}\s+/, '') // heading marks
    .replace(/\[([^\]]+)\]\([^)\s]*\)/g, '$1') // links → their text
    .replace(/\*\*([^*]+)\*\*/g, '$1')
    .replace(/(^|[^*])\*([^*]+)\*/g, '$1$2')
    .replace(/_([^_]+)_/g, '$1')
    .replace(/`([^`]+)`/g, '$1')
    .replace(/[*_`>#]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
}

const HEADING_RE = /^#{1,6}\s+/

/** The nearest ## / ### heading above the first line containing `needle`. Null
 *  when the text is above the first heading or not found. */
export function headingForText(body: string, needle: string): string | null {
  if (!needle) return null
  const lines = body.split('\n')
  let heading: string | null = null
  for (const raw of lines) {
    const line = raw.trim()
    if (HEADING_RE.test(line)) heading = plainText(line)
    if (line.includes(needle)) return heading
  }
  return null
}

/** The nearest heading above the first line an internal link `href` appears in. */
function headingForLink(body: string, href: string): string | null {
  const lines = body.split('\n')
  let heading: string | null = null
  const re = new RegExp(`\\]\\(${href.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?:[)#/])`)
  for (const raw of lines) {
    const line = raw.trim()
    if (HEADING_RE.test(line)) heading = plainText(line)
    if (re.test(line) || line.includes(`](${href})`)) return heading
  }
  return null
}

export type BlogProblem = {
  /** The plain-words problem. */
  message: string
  /** The section heading it sits under, when it is a line-level problem. */
  heading: string | null
  /** True when it blocks publishing (all of these do today). */
  blocking: true
  /** What kind of problem — "Fix with AI" uses it to brief the writer. */
  kind?: string
  /** The exact passage as it appears in the body (or the field's value), so a
   *  fix can replace only that. Absent for whole-post problems (link counts). */
  match?: string
  /** Which field the problem is in. Body unless stated. */
  field?: 'body' | 'seoTitle' | 'seoDescription'
  /** A corrected passage, when one is obvious. */
  suggestion?: string
}

export type CheckerContext = {
  /** Published post slugs OTHER than this one — a /blog/<slug> link may point at
   *  any of these. */
  publishedPostSlugs: string[]
  /** Live landing-page paths (with the leading slash), e.g. /tutors/lahore/… */
  landingPaths: string[]
  /** Indexable tutor profile slugs — a /tutor/<slug> link may point at any of
   *  these (owner, 6 Oct 2026). Optional; defaults to none. */
  tutorSlugs?: string[]
  /** The live facts sheet. Defaults to the built-in plan rows. */
  facts?: PlatformFacts
  /** Pages Google is told not to index right now → the page to link instead. */
  noindexLinks?: Record<string, string>
  /** Indexable /tuition-jobs/<city> pages — valid link targets. */
  cityJobPaths?: string[]
  /** The post's audience — decides where the closing CTA must link. When
   *  absent the CTA check is skipped. */
  audience?: 'parents' | 'tutors' | 'both'
  /** The SEO fields — when given, their length, tagline and facts are checked. */
  seo?: { title: string; description: string }
}

/**
 * Every body-level publish problem, at once, in plain words with its section.
 * (State problems — no title, not reviewed, etc. — come from canPublish and are
 * merged by the caller.) The order is: scaffold, leaked prompt, fact
 * contradictions, prices, the closing CTA, dead and noindex links, the
 * link-count/coverage/text rules, then the SEO fields.
 */
export function collectBlogProblems(body: string, ctx: CheckerContext): BlogProblem[] {
  const out: BlogProblem[] = []
  const add = (message: string, heading: string | null = null, extra: Partial<BlogProblem> = {}) =>
    out.push({ message, heading, blocking: true, ...extra })
  const facts = ctx.facts ?? buildPlatformFacts()

  for (const line of scaffoldViolations(body)) {
    add(`Remove the draft scaffold line: “${plainText(line)}”`, headingForText(body, line), { kind: 'scaffold', match: line })
  }
  for (const line of promptLeakViolations(body)) {
    add(`Remove this instruction/internal-data line: “${plainText(line)}”`, headingForText(body, line), { kind: 'leak', match: line })
  }
  for (const c of contradictionViolations(body, facts)) {
    add(
      `“${c.line}” — ${c.why}${c.suggestion ? ` Suggested: “${c.suggestion}”` : ''}`,
      c.heading,
      { kind: c.kind, match: c.match, suggestion: c.suggestion },
    )
  }
  for (const p of priceViolations(body)) {
    add(`“${p.line}” — remove the amount “${p.amount}”. A post never states a price or a Rs amount.`, p.heading, {
      kind: 'price',
      match: p.match,
    })
  }
  if (ctx.audience) {
    const cta = ctaViolation(body, ctx.audience)
    if (cta) {
      add(`The closing call to action has no link: “${cta.line}” — link it to ${cta.path}.`, headingForText(body, cta.match.split('\n')[0]), {
        kind: 'cta',
        match: cta.match,
      })
    }
  }

  const tutorSlugs = ctx.tutorSlugs ?? []
  const noindex = ctx.noindexLinks ?? {}
  for (const n of noindexLinkViolations(body, noindex)) {
    add(`${n.href} is not in Google right now (too few listings) — link ${n.instead} instead.`, headingForLink(body, n.href), {
      kind: 'noindex_link',
      match: n.href,
      suggestion: n.instead,
    })
  }
  const allowed = [
    ...ctx.landingPaths,
    ...Object.keys(noindex), // they exist; flagged above, not as dead links
    ...(ctx.cityJobPaths ?? []),
    ...ctx.publishedPostSlugs.map((s) => `/blog/${s}`),
    ...tutorSlugs.map((s) => `/tutor/${s}`),
  ]
  for (const href of invalidInternalLinks(body, allowed)) {
    const base = href.startsWith('/blog/')
      ? `This links to a blog post that is not published: ${href}`
      : href.startsWith('/tutor/')
        ? `This links to a tutor profile that is not indexable: ${href}`
        : `This links to a page that does not exist: ${href}`
    // Plain-words guidance on which page to use instead (PR36 §2).
    const hint = suggestValidPage(href)
    add(hint ? `${base} — ${hint}` : base, headingForLink(body, href), { kind: 'dead_link', match: href })
  }

  for (const v of linkRuleViolations(body, {
    hasPublishedPosts: ctx.publishedPostSlugs.length > 0,
    hasTutorProfiles: tutorSlugs.length > 0,
    hasLandingPages: ctx.landingPaths.length > 0 || (ctx.cityJobPaths ?? []).length > 0,
  })) {
    add(v.replace(/\s+/g, ' ').trim(), null, { kind: 'links' })
  }

  if (ctx.seo) {
    for (const s of seoFieldViolations(ctx.seo, facts)) {
      add(s.message, null, { kind: 'seo', field: s.field, match: s.field === 'seoTitle' ? ctx.seo.title : ctx.seo.description })
    }
  }

  return out
}

// ─────────────────────────────────────────────────── deterministic fixer ──

const INTERNAL_LINK_RE = /\[([^\]]+)\]\((\/[^)\s]+)\)/g
const normHref = (h: string) => h.split('#')[0].replace(/\/$/, '') || '/'

/** A single href, with a full tutormint.org URL turned into its relative path
 *  (PR35 §5, the Link picker). A non-tutormint URL is returned unchanged. */
export function toRelativeHref(url: string): string {
  const t = url.trim()
  const m = /^https?:\/\/(?:www\.)?tutormint\.org(\/[^\s]*)?$/i.exec(t)
  if (m) return m[1] || '/'
  return t
}

/** Join link fragments as "a, b and c". */
function joinList(parts: string[]): string {
  if (parts.length <= 1) return parts.join('')
  return `${parts.slice(0, -1).join(', ')} and ${parts[parts.length - 1]}`
}

/** "grade-1-mathematics" → "Grade 1 Mathematics"; "lahore" → "Lahore". */
function wordsFromSlug(slug: string): string {
  return slug
    .split('-')
    .filter(Boolean)
    .map((w) => w[0].toUpperCase() + w.slice(1))
    .join(' ')
}

/**
 * Link text for a landing/tuition path that passes the text rule: a /tutors/
 * page says "tutors", a /tuitions/ page says "tuitions".
 * "/tutors/lahore/grade-1-mathematics" → "Grade 1 Mathematics tutors in Lahore".
 */
export function landingLinkText(path: string): string {
  const m = /^\/(tutors|tuitions)\/([^/]+)\/([^/]+)$/.exec(normHref(path))
  if (!m) return path
  const [, kind, citySlug, subjectSlug] = m
  const city = wordsFromSlug(citySlug)
  const subject = wordsFromSlug(subjectSlug)
  return kind === 'tutors' ? `${subject} tutors in ${city}` : `${subject} tuitions in ${city}`
}

export type SanitizeOptions = {
  /** Published post slugs other than this post — for the "another post" rule. */
  blogSlugs: string[]
  audience: 'parents' | 'tutors' | 'both'
  /** Live landing-page paths (with leading slash), so a valid landing link is
   *  not stripped as unknown, and so a missing landing link can be added. */
  landingPaths?: string[]
  /** Indexable tutor profile slugs — valid /tutor/<slug> targets, and the
   *  fallback for the "another post or a profile" rule when no post exists. */
  tutorSlugs?: string[]
  /** Published post titles by slug — the link text for an added /blog link, so
   *  it is descriptive rather than "a related guide". */
  blogTitles?: Record<string, string>
  /** Tutor names by slug — the link text for an added /tutor link. */
  tutorNames?: Record<string, string>
  /** Indexable /tuition-jobs/<city> pages — valid targets. */
  cityJobPaths?: string[]
  /** Noindex pages → the page to link instead; the fixer swaps them. */
  noindexLinks?: Record<string, string>
}

/**
 * Make the mechanical link problems go away (§3), deterministically:
 *   1. full tutormint.org URLs → relative paths,
 *   2. "free demo" → "demo",
 *   3. an internal link repeated after its first use → unlinked (text kept),
 *   4. the required links (one live tuition/landing page, one other post or
 *      indexable tutor profile, and an audience link if still fewer than three)
 *      added in a closing paragraph when missing,
 *   5. capped at five internal links — extra non-required ones unlinked.
 * The result passes linkRuleViolations by construction.
 */
export function sanitizeDraft(body: string, opts: SanitizeOptions): string {
  let out = body
  const landingPaths = (opts.landingPaths ?? []).map(normHref)
  const tutorSlugs = opts.tutorSlugs ?? []

  // 1. Absolute site URLs → relative. Both apex and www, in link targets.
  out = out.replace(
    /\]\(https?:\/\/(?:www\.)?tutormint\.org(\/[^)\s]*)?\)/gi,
    (_m, path: string | undefined) => `](${path || '/'})`,
  )

  // 2. A demo is never "free".
  out = out.replace(/\bfree\s+(demos?)\b/gi, '$1')

  // 2a. A link to a page Google is told not to index right now points at the
  // page the checker suggests instead (owner, 7 Oct 2026). The words stay.
  if (opts.noindexLinks) {
    const swap = opts.noindexLinks
    out = out.replace(INTERNAL_LINK_RE, (m, text: string, href: string) => {
      const instead = swap[normHref(href)]
      return instead ? `[${text}](${instead})` : m
    })
  }

  // 2b. Unlink any internal link to a page that is NOT valid (PR36 §4): the
  // shared static pages, a published /blog/<slug>, a live landing page, or an
  // indexable /tutor/<slug>. An unknown page (an old typo, an invented path) is
  // turned back into plain text, so a draft never carries a dead link. The
  // required links are ensured afterwards, so the post still passes the checker.
  {
    const valid = new Set<string>(staticValidPaths().map(normHref))
    for (const s of opts.blogSlugs) valid.add(`/blog/${s}`)
    for (const p of landingPaths) valid.add(p)
    for (const p of opts.cityJobPaths ?? []) valid.add(normHref(p))
    for (const s of tutorSlugs) valid.add(`/tutor/${s}`)
    // A post never links pricing (owner, 7 Oct 2026): /membership-plans is a
    // real page, but a draft's link to it is turned back into plain words.
    valid.delete('/membership-plans')
    out = out.replace(INTERNAL_LINK_RE, (m, text: string, href: string) =>
      valid.has(normHref(href)) ? m : text,
    )
  }

  // 3. Unlink an internal link repeated after its first occurrence.
  {
    const seen = new Set<string>()
    out = out.replace(INTERNAL_LINK_RE, (m, text: string, href: string) => {
      const key = normHref(href)
      if (seen.has(key)) return text // drop the link, keep the words
      seen.add(key)
      return m
    })
  }

  // 4. Ensure the required links exist; add the missing ones in a closing line.
  const present = new Set(internalLinksIn(out))
  const missing: string[] = []
  const link = (href: string, text: string) => `[${text}](${href})`

  if (![...present].some(isLandingOrTuitionLink)) {
    const city = (opts.cityJobPaths ?? [])[0]
    if (landingPaths.length > 0) missing.push(link(landingPaths[0], landingLinkText(landingPaths[0])))
    else if (city) missing.push(link(city, `tuition jobs in ${wordsFromSlug(city.split('/').pop() ?? '')}`))
  }
  if (![...present].some(isPostOrProfileLink)) {
    // Descriptive text (owner, 7 Oct 2026): the post's own title, never "a related guide".
    if (opts.blogSlugs.length > 0) {
      const slug = opts.blogSlugs[0]
      missing.push(link(`/blog/${slug}`, opts.blogTitles?.[slug] || wordsFromSlug(slug)))
    } else if (tutorSlugs.length > 0) {
      const slug = tutorSlugs[0]
      const name = opts.tutorNames?.[slug]
      missing.push(link(`/tutor/${slug}`, name ? `${name}'s tutor profile` : 'a tutor profile on TutorMint'))
    }
  }

  // Reach at least three internal links: add an audience-appropriate link.
  const willHave = present.size + missing.length
  if (willHave < 3) {
    if (opts.audience === 'parents') {
      if (!present.has('/parent/dashboard/post-job')) missing.push(link('/parent/dashboard/post-job', 'post a tuition'))
    } else if (!present.has('/browse/tuitions')) {
      missing.push(link('/browse/tuitions', 'open tuitions'))
    }
  }
  if (present.size + missing.length < 3 && !present.has('/browse/tutors')) {
    missing.push(link('/browse/tutors', 'browse tutors'))
  }

  if (missing.length > 0) {
    out = `${out.trimEnd()}\n\nMore on TutorMint: see ${joinList(missing)}.`
  }

  // 5. The closing call to action always carries a link (owner, 7 Oct 2026):
  // when the last paragraph has none, the audience's page is linked at its end.
  const ctaPath = ctaPathFor(opts.audience)
  const closing = closingParagraph(out)
  const ctaNeeded = closing != null && !/\]\(\/[^)\s]*\)/.test(closing)

  // 6. Cap at five internal links (four when the CTA link is still to come).
  out = capLinks(out, ctaNeeded ? 4 : 5, ctaPath)

  if (ctaNeeded && closing) {
    // Unlink any earlier link to the CTA page so it is linked only once.
    out = out.replace(INTERNAL_LINK_RE, (m, text: string, href: string) => (normHref(href) === ctaPath ? text : m))
    const linked = `${closing.replace(/[\s.!]*$/, '')}. [${capitalise(ctaLinkTextFor(opts.audience))}](${ctaPath}).`
    const at = out.lastIndexOf(closing)
    if (at >= 0) out = out.slice(0, at) + linked + out.slice(at + closing.length)
  }

  return out
}

function capitalise(s: string): string {
  return s ? s[0].toUpperCase() + s.slice(1) : s
}

/** Keep at most five internal links: the first landing/tuition link and the
 *  first post/profile link always survive; the earliest remaining links fill up
 *  to five; the rest are unlinked (text kept). */
function capLinks(body: string, max = 5, reserved?: string): string {
  const links: { href: string; index: number }[] = []
  for (const m of body.matchAll(INTERNAL_LINK_RE)) {
    const href = normHref(m[2])
    // A link to the CTA page is about to be moved to the closing line, so it
    // does not count toward the cap here.
    if (href === reserved) continue
    links.push({ href, index: m.index ?? 0 })
  }
  if (new Set(links.map((l) => l.href)).size <= max) return body

  const keep = new Set<string>()
  if (reserved) keep.add(reserved)
  const firstLanding = links.find((l) => isLandingOrTuitionLink(l.href))
  if (firstLanding) keep.add(firstLanding.href)
  const firstPost = links.find((l) => isPostOrProfileLink(l.href))
  if (firstPost) keep.add(firstPost.href)
  for (const l of links) {
    if (keep.size >= max + (reserved ? 1 : 0)) break
    keep.add(l.href)
  }

  const dropped = new Set<string>()
  return body.replace(INTERNAL_LINK_RE, (m, text: string, href: string) => {
    const key = normHref(href)
    if (keep.has(key) || dropped.has(key)) return keep.has(key) ? m : text
    dropped.add(key)
    return text
  })
}
