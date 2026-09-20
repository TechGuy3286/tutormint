// lib/ai/blogChecker.ts
//
// Two pure things the blog editor and the generation pipeline both need (PR35):
//
//   sanitizeDraft()      — the DETERMINISTIC fixer (§3). After a draft is
//                          assembled it makes the mechanical problems go away by
//                          construction: full tutormint.org URLs become relative,
//                          a link repeated after its first use is unlinked,
//                          "free demo" loses the "free", and the required links
//                          (/membership-plans, /faq, and one published blog post)
//                          are added in a closing paragraph if missing. A draft
//                          out the far side of this passes every LINK rule.
//
//   collectBlogProblems() — the CHECKER (§4). One plain-text list of EVERY
//                          problem at once, each naming the section it is in, so
//                          the editor shows them together instead of one at a
//                          time. It is the same set the publish route enforces,
//                          so the editor and the server cannot disagree.
//
// PURE — no network, no server-only import — so the editor (client), the publish
// route (server) and the tests all read the same rules. It draws the individual
// rules from lib/ai/platformFacts.ts and lib/ai/blogBrief.ts; this file only
// composes them into one fixer and one list.

import {
  contradictionViolations,
  internalLinksIn,
  invalidInternalLinks,
  linkRuleViolations,
} from './platformFacts'
import { staticValidPaths, suggestValidPage } from './blogRoutes'
import { scaffoldViolations, promptLeakViolations } from './blogBrief'

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
}

export type CheckerContext = {
  /** Published post slugs OTHER than this one — a /blog/<slug> link may point at
   *  any of these. */
  publishedPostSlugs: string[]
  /** Live landing-page paths (with the leading slash), e.g. /tutors/lahore/… */
  landingPaths: string[]
}

/**
 * Every body-level publish problem, at once, in plain words with its section.
 * (State problems — no title, not reviewed, etc. — come from canPublish and are
 * merged by the caller.) The order is: scaffold, leaked prompt, fact
 * contradictions, dead links, then the link-count/coverage rules.
 */
export function collectBlogProblems(body: string, ctx: CheckerContext): BlogProblem[] {
  const out: BlogProblem[] = []
  const add = (message: string, heading: string | null = null) =>
    out.push({ message, heading, blocking: true })

  for (const line of scaffoldViolations(body)) {
    add(`Remove the draft scaffold line: “${plainText(line)}”`, headingForText(body, line))
  }
  for (const line of promptLeakViolations(body)) {
    add(`Remove this instruction/internal-data line: “${plainText(line)}”`, headingForText(body, line))
  }
  for (const c of contradictionViolations(body)) {
    add(`${c.why} (in “${plainText(c.line)}”)`, c.heading)
  }

  const allowed = [
    ...ctx.landingPaths,
    ...ctx.publishedPostSlugs.map((s) => `/blog/${s}`),
  ]
  for (const href of invalidInternalLinks(body, allowed)) {
    const base = href.startsWith('/blog/')
      ? `This links to a blog post that is not published: ${href}`
      : `This links to a page that does not exist: ${href}`
    // Plain-words guidance on which page to use instead (PR36 §2).
    const hint = suggestValidPage(href)
    add(hint ? `${base} — ${hint}` : base, headingForLink(body, href))
  }

  for (const v of linkRuleViolations(body, { hasPublishedPosts: ctx.publishedPostSlugs.length > 0 })) {
    add(plainText(v))
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

export type SanitizeOptions = {
  /** Published post slugs other than this post — for the "one blog link" rule. */
  blogSlugs: string[]
  audience: 'parents' | 'tutors' | 'both'
  /** Live landing-page paths (with leading slash), so a valid landing link is
   *  not stripped as unknown. Optional; defaults to none. */
  landingPaths?: string[]
}

/**
 * Make the mechanical link problems go away (§3), deterministically:
 *   1. full tutormint.org URLs → relative paths,
 *   2. "free demo" → "demo",
 *   3. an internal link repeated after its first use → unlinked (text kept),
 *   4. the required links (/membership-plans, /faq, one published /blog post,
 *      and an audience link if fewer than three) added in a closing paragraph
 *      when missing,
 *   5. capped at five internal links — extra non-required ones unlinked.
 * The result passes linkRuleViolations by construction.
 */
export function sanitizeDraft(body: string, opts: SanitizeOptions): string {
  let out = body

  // 1. Absolute site URLs → relative. Both apex and www, in link targets.
  out = out.replace(
    /\]\(https?:\/\/(?:www\.)?tutormint\.org(\/[^)\s]*)?\)/gi,
    (_m, path: string | undefined) => `](${path || '/'})`,
  )

  // 2. A demo is never "free".
  out = out.replace(/\bfree\s+(demos?)\b/gi, '$1')

  // 2b. Unlink any internal link to a page that is NOT valid (PR36 §4): the
  // shared static pages, a published /blog/<slug>, or a live landing page. An
  // unknown page (an old /parent/dashboard/post-job typo, an invented path) is
  // turned back into plain text, so a draft never carries a dead link. The
  // required links are ensured afterwards, so the post still passes the checker.
  {
    const valid = new Set<string>(staticValidPaths().map(normHref))
    for (const s of opts.blogSlugs) valid.add(`/blog/${s}`)
    for (const p of opts.landingPaths ?? []) valid.add(normHref(p))
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

  if (!present.has('/membership-plans')) missing.push(link('/membership-plans', 'membership plans'))
  if (!present.has('/faq')) missing.push(link('/faq', 'the FAQ'))
  const hasBlog = [...present].some((h) => h.startsWith('/blog/'))
  if (!hasBlog && opts.blogSlugs.length > 0) {
    missing.push(link(`/blog/${opts.blogSlugs[0]}`, 'a related guide'))
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

  if (missing.length > 0) {
    out = `${out.trimEnd()}\n\nMore on TutorMint: read ${joinList(missing)}.`
  }

  // 5. Cap at five internal links. Keep the required ones + the earliest others.
  out = capLinks(out)

  return out
}

/** Keep at most five internal links: /membership-plans, /faq and the first
 *  /blog link always survive; the earliest remaining links fill up to five; the
 *  rest are unlinked (text kept). */
function capLinks(body: string): string {
  const links: { href: string; index: number }[] = []
  for (const m of body.matchAll(INTERNAL_LINK_RE)) {
    links.push({ href: normHref(m[2]), index: m.index ?? 0 })
  }
  if (links.length <= 5) return body

  const keep = new Set<string>()
  const required = ['/membership-plans', '/faq']
  for (const r of required) if (links.some((l) => l.href === r)) keep.add(r)
  const firstBlog = links.find((l) => l.href.startsWith('/blog/'))
  if (firstBlog) keep.add(firstBlog.href)
  for (const l of links) {
    if (keep.size >= 5) break
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
