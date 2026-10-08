// lib/ai/blogCopy.ts
//
// The Claude half of blog drafting.
//
// The composer and the verifier live in lib/ai/blogBrief.ts and are pure; this
// file is the part that talks to the API, so it is the part that can only run
// on a server (it imports lib/ai/anthropic.ts, which imports 'server-only').
// EVERYTHING HERE FALLS BACK TO composeBlogDraft -- never to an error -- because
// a manager is trying to draft a post and a generation problem must not become
// their problem. No key, a failed call, unparseable JSON, or the wrong length
// all return the composed draft, plainly labelled so the UI can say it wrote
// this one itself.
//
// THE MODEL IS INSTRUCTED, THE OUTPUT IS VERIFIED. The brief forbids inventing
// statistics; the returned body is then run through unsupportedFigures() and
// any figure not in the notes is handed back as `untraced` for the editor to
// flag. The gate that blocks Reviewed on those figures is enforced again on
// save (app/api/admin/blog/route.ts) -- the browser is never the only thing
// holding the line.

import { complete, isConfigured, MODEL } from './anthropic'
import { PLATFORM_FACTS_TEXT, LINK_MAP_TEXT, ctaPathFor, ctaLinkTextFor, SEO_TITLE_LIMIT, SEO_DESCRIPTION_LIMIT } from './platformFacts'
import {
  BLOG_MAX_WORDS,
  BLOG_MIN_WORDS,
  BLOG_WARN_WORDS,
  composeBlogDraft,
  fitSeoDescription,
  unsupportedFigures,
  wordCount,
  type BlogBrief,
  type BlogDraft,
} from './blogBrief'

// The intro every prompt opens with. It never uses the RETIRED tagline: "No fee"
// contradicts the Spam Free Platform Fee (owner, 7 Oct 2026). The current one,
// "Free to join. No commission. No middleman." (owner, 8 Oct 2026), is true.
const INTRO =
  'You write for the TutorMint blog. TutorMint is a Pakistani platform where parents find verified tutors and tutors find tuitions. TutorMint takes no commission.'

/** The LIVE facts sheet when the brief carries it, else the built-in one. */
function factsFor(brief: BlogBrief): string {
  return brief.factsText?.trim() || PLATFORM_FACTS_TEXT
}

/**
 * EVERY rule the checker enforces, given to the writer up front (owner, 7 Oct
 * 2026), so a draft passes on its first try instead of being fixed afterwards.
 */
function checklistRules(brief: BlogBrief): string {
  return [
    'THE PUBLISHING CHECKLIST — the draft is checked against every one of these:',
    '- Never contradict the TutorMint facts above. Call the one-time fee the "Spam Free Platform Fee" every time. The Verified badge never needs a degree, certificate or intro video.',
    `- Length ${BLOG_MIN_WORDS}-${BLOG_MAX_WORDS} words in total.`,
    '- 3 to 5 internal links in the whole post, each page linked once: at least ONE to a live tuition or city page (/tuition-jobs/<city>, /tutors/<city>/<subject> or /tuitions/<city>/<subject>) and at least ONE to another blog post or a tutor profile from the list. Never link /membership-plans.',
    '- Link text must describe the page ("open Grade 3 Mathematics tuitions in Karachi", "tuition jobs in Karachi") — never "click here", "this page", "read more" or "a related guide".',
    '- Never write a price, a fee amount or any Rs/PKR figure.',
    '- Never invent fees, statistics, counts or percentages.',
    `- The closing call to action is a short paragraph with a Markdown link to ${ctaPathFor(brief.audience)} (link text like "${ctaLinkTextFor(brief.audience)}").`,
    '- Plain English (or plain Roman Urdu when asked), in the audience voice.',
  ].join('\n')
}

/** The closing call to action, always linked (owner, 7 Oct 2026). */
function ctaLine(brief: BlogBrief): string {
  const who =
    brief.audience === 'tutors' ? 'inviting tutors to create their profile' : brief.audience === 'parents' ? 'inviting parents to find a tutor' : 'for parents and tutors'
  return `End with a short closing call-to-action paragraph ${who}. It MUST contain a Markdown link to ${ctaPathFor(brief.audience)} (link text like "${ctaLinkTextFor(brief.audience)}"). No price.`
}

/** How the SEO fields are written (owner, 7 Oct 2026). */
const SEO_RULE = `Also write an SEO title (at most ${SEO_TITLE_LIMIT} characters) and a meta description (at most ${SEO_DESCRIPTION_LIMIT} characters) for THIS post: say what the post covers, accurately. Never use the retired tagline ("No fee, no commission, no middleman" — it contradicts the Spam Free Platform Fee); the current tagline "Free to join. No commission. No middleman." is true and may be used. Never contradict the post or the facts.`

// PR16 §6.3 — how the internal-link list is described to the model, shared by the
// full-draft and sectioned prompts. It must place real links from the list only.
const LINK_RULE =
  'Internal links: place 3 to 5 relevant internal links in the body, using the EXACT relative paths from this list and no others (never a full https://tutormint.org URL). Never invent a link, and never link to a path not in this list:'

// The specific links a passing post must carry (owner, 6 Oct 2026 — supersedes
// PR35's /membership-plans + /faq), placed where they fit. The deterministic
// fixer guarantees these too, so the model only has to try — but asking keeps
// the draft natural rather than bolted-on.
const REQUIRED_LINKS_RULE = [
  'Across the whole post, include: at least ONE link to a live tuition or city × subject landing page from the list (a /tutors/<city>/<subject> or /tuitions/<city>/<subject> path), and at least ONE link to another published blog post or an indexable tutor profile from the list. Never link to pricing or membership pages — a post never pushes pricing. Link each page at most once.',
].join('\n')

// Who the post is FOR (owner, 6 Oct 2026). The chosen audience decides the
// voice: a tutor-career post speaks to a tutor, not to a parent reading about
// tutors.
function audienceRule(brief: BlogBrief): string {
  if (brief.audience === 'tutors') {
    return 'AUDIENCE: TUTORS. Write TO a tutor in Pakistan — "you" is the tutor. Write about their teaching, their students, the fee they set, how they find tuitions and present themselves. Never write as if the reader were a parent choosing a tutor.'
  }
  if (brief.audience === 'parents') {
    return 'AUDIENCE: PARENTS. Write TO a parent in Pakistan — "you" is the parent. Write about their child, choosing a tutor and working with one. Never write as if the reader were a tutor.'
  }
  return 'AUDIENCE: BOTH parents and tutors. When a point applies to one group only, say which.'
}

// Never produced, in any step (PR35 §3): the banned demo phrasing, prices, and
// outcome promises.
const OUTCOME_RULE =
  'Never write "free demo" — a demo is a demo lesson, never described as free. Never state a price, fee or amount. Never promise or imply tuitions, replies, applications, hires or income.'

export { composeBlogDraft, unsupportedFigures } from './blogBrief'
export type { BlogBrief, BlogDraft } from './blogBrief'

/** The model, from the one place it is defined. Reported to the audit log. */
export const BLOG_MODEL = MODEL

// The banned marketing words (owner PR14 §4.5) — the model must never produce
// them, in a full draft, an outline or a section.
const BANNED_WORD_RULE =
  'Never use the words "leverage", "unlock", "seamless" or "empower" (or variants).'

// The rule that keeps the model's own instructions out of the body (owner PR14
// §1.3): a leaked line like "Write a practical guide…" is what a failed draft
// used to publish.
const NO_META_RULE =
  'Output ONLY finished post content for a reader. Never restate these instructions, never write a note to the editor, never mention search counts or how many tutors are listed.'

function figureRuleFor(brief: BlogBrief): string {
  return brief.notes.trim()
    ? 'THE HARD RULE — NEVER INVENT STATISTICS. Use ONLY numbers, fees, percentages, dates, pass rates, counts and names that appear in the facts below. If you do not have a number, write "typically" or describe it in words. A made-up statistic on a blog is quoted back as fact — do not produce one. NEVER invent fees, statistics, counts or percentages.'
    : 'THE HARD RULE — you were given NO facts. Write with NO figures AT ALL: no numbers, no percentages, no fees, no counts, no pass rates, no dates. Describe every magnitude in words ("typically", "most", "a few", "affordable"). A single invented figure fails the draft. NEVER invent fees, statistics, counts or percentages.'
}

function brandBrief(brief: BlogBrief): string {
  const noNotes = !brief.notes.trim()
  const links =
    brief.landingLinks.length > 0
      ? brief.landingLinks.map((l) => `- ${l.label}: /${l.path}`).join('\n')
      : '(none available — do not invent internal links)'

  const figureRule = figureRuleFor(brief)

  const cta = ctaLine(brief)

  return [
    INTRO,
    factsFor(brief),
    checklistRules(brief),
    'Voice: plain, warm, specific to Pakistan. No corporate filler, no "in today\'s fast-paced world", no hype.',
    audienceRule(brief),
    'Structure:',
    `- ${BLOG_MIN_WORDS}-${BLOG_MAX_WORDS} words, and the length must come from COVERING MORE GROUND, never from padding. Generalities repeated at length are worse than a short post — for the reader and for Google.`,
    '- Write 5 to 7 DISTINCT ## H2 sections. Each section answers ONE specific question a Pakistani parent or tutor would actually type into Google (for example: "How much does an O Level Physics tutor cost in Lahore?", "How does TutorMint verify a tutor?", "What does the Verified badge mean?", "How do I hire a tutor step by step?"). Make each section concrete: how a flow actually works, what a badge actually means, what to do step by step.',
    '- Answer the reader\'s main question in the FIRST paragraph. Do not warm up.',
    '- Short paragraphs.',
    '- Include ONE comparison table using Markdown pipe syntax where it genuinely helps (costs, options, boards). Skip it if it does not.',
    '- Include a "## Frequently asked questions" section with 3-4 questions as ### sub-headings.',
    '- If the facts below are too thin to fill this length HONESTLY, write a shorter, accurate post rather than inventing material — do NOT pad with generalities to reach a word count.',
    cta,
    brief.today ? `Today's date is ${brief.today}; make timing references correct relative to it.` : '',
    LINK_MAP_TEXT,
    LINK_RULE,
    links,
    publishedPostsBlock(brief),
    REQUIRED_LINKS_RULE,
    OUTCOME_RULE,
    figureRule,
    BANNED_WORD_RULE,
    NO_META_RULE,
    brief.language === 'ur'
      ? 'Write in Roman Urdu (Urdu written in the Latin alphabet), the way Pakistanis text — not formal Nastaliq Urdu, and not English.'
      : 'Write in clear English.',
    SEO_RULE,
    'Reply as JSON only, exactly: {"body": "...markdown...", "seoTitle": "...", "seoDescription": "..."}',
  ].join('\n')
}

// ---------------------------------------------------- sectioned generation ---
//
// A 1200-word post in one call took longer than the 55s the serverless budget
// allows and timed out — the failure behind the 172-word garbage post (owner
// PR14 §1.5). It is now generated in BOUNDED steps: an outline (one short call),
// then each section (one short call each), orchestrated by the editor with a
// progress bar. No single request writes 1200 words, so none can time out.

export type OutlineResult =
  | { ok: true; sections: string[]; seoTitle: string; seoDescription: string }
  | { ok: false; reason: string }

export type SectionResult = { ok: true; markdown: string } | { ok: false; reason: string }

// `terse` is the SHORTER prompt used for the one retry after the model returns
// no text (§1.2). It drops the long platform-facts sheet so the request is much
// smaller — a bloated prompt is the likeliest reason a model spends its budget
// without emitting prose — while keeping the JSON shape and the no-meta rule.
function outlineSystem(brief: BlogBrief, terse = false): string {
  if (terse) {
    return [
      'Plan a TutorMint blog post outline. No prose.',
      audienceRule(brief),
      '- 5 to 7 short H2 section headings, each a specific question the reader would search. Make the LAST heading "Frequently asked questions".',
      factsFor(brief),
      SEO_RULE,
      NO_META_RULE,
      brief.language === 'ur' ? 'Headings in Roman Urdu (Latin script).' : 'Headings in clear English.',
      'Reply as JSON only: {"sections": ["...", "..."], "seoTitle": "...", "seoDescription": "..."}',
    ].join('\n')
  }
  return [
    'You plan a post for the TutorMint blog. TutorMint is a Pakistani platform where parents find verified tutors and tutors find tuitions. TutorMint takes no commission.',
    factsFor(brief),
    'Produce an OUTLINE only — no prose.',
    audienceRule(brief),
    '- 5 to 7 H2 section headings. Each answers ONE specific question the reader would type into Google (fees, how to choose, how verification works, step by step, and so on). Make the LAST heading "Frequently asked questions".',
    SEO_RULE,
    BANNED_WORD_RULE,
    NO_META_RULE,
    brief.language === 'ur' ? 'Headings in Roman Urdu (Latin script).' : 'Headings in clear English.',
    'Reply as JSON only, exactly: {"sections": ["...", "..."], "seoTitle": "...", "seoDescription": "..."}',
  ].join('\n')
}

function sectionSystem(brief: BlogBrief, sections: string[], index: number, terse = false): string {
  // The one shorter retry (§1.2): drop the facts sheet, the full-outline echo and
  // the internal-link block, and ask for a shorter section. The hard "invent no
  // statistics" rule and the no-meta rule STAY — the retry may be smaller but it
  // must not be less safe.
  if (terse) {
    const heading = sections[index]
    return [
      'You write ONE section for the TutorMint blog. Plain, warm, specific to Pakistan. No hype.',
      audienceRule(brief),
      factsFor(brief),
      `Write ONLY the section "## ${heading}"${heading.toLowerCase().includes('frequently asked') ? ' with 3-4 "### " question sub-headings and short answers' : ''}. About 120-180 words. Short paragraphs. Do not write any other heading.`,
      index === sections.length - 1
        ? ctaLine(brief)
        : 'Do NOT add a call to action.',
      OUTCOME_RULE,
      figureRuleFor(brief),
      NO_META_RULE,
      brief.language === 'ur' ? 'Write in Roman Urdu (Latin script).' : 'Write in clear English.',
      'Output the Markdown for THIS section only — no JSON, no preamble, no closing note.',
    ].join('\n')
  }
  return sectionSystemFull(brief, sections, index)
}

function sectionSystemFull(brief: BlogBrief, sections: string[], index: number): string {
  const heading = sections[index]
  const links =
    brief.landingLinks.length > 0
      ? brief.landingLinks.map((l) => `- ${l.label}: /${l.path}`).join('\n')
      : '(none available — do not invent internal links)'
  const last = index === sections.length - 1
  return [
    INTRO,
    factsFor(brief),
    checklistRules(brief),
    'Voice: plain, warm, specific to Pakistan. No corporate filler, no hype.',
    audienceRule(brief),
    `You are writing ONE section of a post titled "${brief.title}". The full outline is:`,
    sections.map((s, i) => `${i + 1}. ${s}`).join('\n'),
    `Write ONLY section ${index + 1}: "${heading}". Begin with the Markdown heading "## ${heading}"${heading.toLowerCase().includes('frequently asked') ? ' and give 3-4 questions as "### " sub-headings with short answers' : ''}. About 150-250 words (the whole post lands at ${BLOG_MIN_WORDS}-${BLOG_MAX_WORDS} words). Short paragraphs. Do not repeat other sections and do not write any other heading.`,
    last
      ? `This is the last section — ${ctaLine(brief)}`
      : 'Do NOT add a call to action; this is not the last section.',
    brief.today ? `Today's date is ${brief.today}; make any timing reference (an exam "weeks away", a season) correct relative to it.` : '',
    LINK_MAP_TEXT,
    'Internal links you MAY use where relevant (exact RELATIVE paths only; invent no others; the whole post should carry 3-5 across its sections):',
    links,
    publishedPostsBlock(brief),
    last ? REQUIRED_LINKS_RULE : '',
    OUTCOME_RULE,
    figureRuleFor(brief),
    BANNED_WORD_RULE,
    NO_META_RULE,
    brief.language === 'ur' ? 'Write in Roman Urdu (Latin script).' : 'Write in clear English.',
    'Output the Markdown for THIS section only — no JSON, no preamble, no closing note.',
  ].join('\n')
}

/** Step 1: the outline + SEO fields. One short call. */
export async function generateBlogOutline(brief: BlogBrief): Promise<OutlineResult> {
  if (!isConfigured()) return { ok: false, reason: 'ANTHROPIC_API_KEY is not set' }
  if (!brief.title.trim()) return { ok: false, reason: 'no title' }

  let result = await complete({
    system: outlineSystem(brief),
    prompt: factsBlock(brief),
    maxTokens: 900,
    timeoutMs: 30_000,
  })
  // §1.2 — if the model returned no text, retry ONCE with a shorter prompt
  // before giving up. Only for the no-text case; a timeout or a 4xx is a
  // different failure a shorter prompt would not fix.
  if (!result.ok && returnedNoText(result.reason)) {
    console.warn('[blogCopy] outline returned no text — retrying with a shorter prompt')
    result = await complete({
      system: outlineSystem(brief, true),
      prompt: factsBlock(brief),
      maxTokens: 900,
      timeoutMs: 30_000,
    })
  }
  if (!result.ok) {
    console.error('[blogCopy] outline failed:', result.reason)
    return { ok: false, reason: result.reason }
  }
  try {
    const raw = result.text
    const start = raw.indexOf('{')
    const end = raw.lastIndexOf('}')
    if (start === -1 || end <= start) throw new Error('no JSON object')
    const p = JSON.parse(raw.slice(start, end + 1)) as {
      sections?: unknown
      seoTitle?: unknown
      seoDescription?: unknown
    }
    const sections = Array.isArray(p.sections)
      ? p.sections.filter((x) => typeof x === 'string' && x.trim()).map((x) => String(x).trim())
      : []
    if (sections.length < 3) return { ok: false, reason: 'outline had too few sections' }
    const seoTitle =
      (typeof p.seoTitle === 'string' ? p.seoTitle.trim() : '').slice(0, 60) || brief.title.slice(0, 60)
    const seoDescription = fitSeoDescription(
      typeof p.seoDescription === 'string' && p.seoDescription.trim() ? p.seoDescription.trim() : brief.title,
    )
    return { ok: true, sections: sections.slice(0, 8), seoTitle, seoDescription }
  } catch (e) {
    console.error('[blogCopy] unparseable outline:', String(e))
    return { ok: false, reason: `unparseable outline: ${String(e).slice(0, 120)}` }
  }
}

/** Step 2..N: one section of the outline. One short call each. */
export async function generateBlogSection(
  brief: BlogBrief,
  sections: string[],
  index: number,
): Promise<SectionResult> {
  if (!isConfigured()) return { ok: false, reason: 'ANTHROPIC_API_KEY is not set' }
  if (!Array.isArray(sections) || index < 0 || index >= sections.length) {
    return { ok: false, reason: 'bad section index' }
  }
  let result = await complete({
    system: sectionSystem(brief, sections, index),
    prompt: factsBlock(brief),
    maxTokens: 1400,
    timeoutMs: 40_000,
  })
  // §1.2 — retry ONCE with a shorter section prompt when the model returns no
  // text, before failing. The retry keeps the invent-no-statistics rule.
  if (!result.ok && returnedNoText(result.reason)) {
    console.warn(`[blogCopy] section ${index} returned no text — retrying with a shorter prompt`)
    result = await complete({
      system: sectionSystem(brief, sections, index, true),
      prompt: factsBlock(brief),
      maxTokens: 1400,
      timeoutMs: 40_000,
    })
  }
  if (!result.ok) {
    console.error(`[blogCopy] section ${index} failed:`, result.reason)
    return { ok: false, reason: result.reason }
  }
  const md = result.text.trim()
  if (!md) return { ok: false, reason: 'section returned no text' }
  return { ok: true, markdown: md }
}

/** True when a completion failed specifically because the API returned a 200
 *  with no text block — the case a shorter retry can fix (§1.2). The prefix is
 *  the stable string lib/ai/anthropic.ts returns. */
function returnedNoText(reason: string): boolean {
  return reason.includes('returned no text')
}

function publishedPostsBlock(brief: BlogBrief): string {
  const posts = brief.publishedPosts ?? []
  if (posts.length === 0) return '(no published blog posts yet — do not link to a blog post)'
  return ['Published blog posts you may link (use the exact /blog/<slug> path):', ...posts.map((p) => `- ${p.title}: /blog/${p.slug}`)].join('\n')
}

function factsBlock(brief: BlogBrief): string {
  return [
    `Title: ${brief.title}`,
    `Topic: ${brief.clusterLabel}`,
    `Audience: ${brief.audience}`,
    brief.today ? `Today's date: ${brief.today}` : '',
    '',
    'Facts you may use (and nothing beyond them for any number):',
    brief.notes.trim() || '(none supplied)',
  ]
    .filter(Boolean)
    .join('\n')
}

/**
 * Write the post, and check its figures before handing it back.
 *
 * Falls back to composeBlogDraft on every failure path. On success the body's
 * untraced figures are returned alongside it -- generation is not blocked by
 * them (the manager may confirm one with a source), but the editor flags them
 * and the save-time gate enforces them.
 */
export async function generateBlogDraft(brief: BlogBrief): Promise<BlogDraft> {
  const fallback = composeBlogDraft(brief)

  if (!isConfigured()) {
    return { ...fallback, note: 'unconfigured', reason: 'ANTHROPIC_API_KEY is not set' }
  }
  if (!brief.title.trim()) return { ...fallback, note: 'no title' }

  const result = await complete({
    system: brandBrief(brief),
    prompt: factsBlock(brief),
    // 1800 words of Markdown plus a table and two SEO fields: generously above
    // the ceiling so a good long-form draft is never cut mid-sentence into an
    // unparseable reply.
    maxTokens: 5200,
    // A long-form draft takes far longer than a job advert. 55s stays under the
    // route's 60s platform budget, so our own timeout fires first with a clean
    // "timed out" and a composed fallback, rather than a platform 504.
    timeoutMs: 55_000,
  })

  if (!result.ok) {
    // The verbatim status + body from the API (never the key — that is only in
    // the request header, never the response). Threaded to the admin client and
    // the audit row so the real cause is visible, not a generic "failed".
    console.error('[blogCopy] generation failed:', result.reason)
    return { ...fallback, note: 'failed', reason: result.reason }
  }

  let parsed: { body?: unknown; seoTitle?: unknown; seoDescription?: unknown }
  try {
    const raw = result.text
    const start = raw.indexOf('{')
    const end = raw.lastIndexOf('}')
    if (start === -1 || end <= start) throw new Error('no JSON object in reply')
    parsed = JSON.parse(raw.slice(start, end + 1)) as typeof parsed
  } catch (e) {
    console.error('[blogCopy] unparseable reply:', String(e))
    return { ...fallback, note: 'failed' }
  }

  const body = typeof parsed.body === 'string' ? parsed.body.trim() : ''
  if (!body) return { ...fallback, note: 'failed' }

  const words = wordCount(body)
  // A wide tolerance: a 620-word draft is a fine start, and 2000 is still
  // usable. Only a truncated stub or a runaway is rejected back to the
  // composed draft.
  if (words < 400) {
    console.error(`[blogCopy] rejected: ${words} words, too short`)
    return { ...fallback, note: 'failed' }
  }

  const seoTitle =
    (typeof parsed.seoTitle === 'string' ? parsed.seoTitle.trim() : '').slice(0, 60) ||
    brief.title.slice(0, 60)
  const seoLead = typeof parsed.seoDescription === 'string' ? parsed.seoDescription.trim() : ''
  const seoDescription = fitSeoDescription(seoLead || brief.title)

  const untraced = unsupportedFigures(body, brief.notes, brief.title, [], brief.landingLinks)

  // Title-only generation (no notes) must be figure-free. If the model slipped a
  // figure in anyway, fall back to the composed draft — which carries no number
  // the notes do not, so the result always passes the figure gate.
  if (!brief.notes.trim() && untraced.length > 0) {
    console.error('[blogCopy] no-notes draft included figures, composing instead:', untraced.join(', '))
    return { ...fallback, note: 'figures', reason: `the draft included unbacked figures (${untraced.join(', ')})` }
  }

  // A draft under the warning line is handed back as-is (never padded), flagged
  // so the editor asks for more fact notes rather than the model inventing filler.
  return { body, seoTitle, seoDescription, source: 'claude', untraced, words, short: words < BLOG_WARN_WORDS }
}

// ---------------------------------------------------------- fix passages ----
//
// "Fix only these passages" (owner, 7 Oct 2026). Used twice:
//   - SELF-CORRECTION: after a draft is assembled, the checker's issues go back
//     to the writer, which rewrites only those passages (up to 2 rounds);
//   - "FIX WITH AI": one checklist item (or all of them) rewritten on request,
//     shown as before/after and applied only when the manager accepts.
// The model returns EDITS — the exact passage and its rewrite — never a whole
// new post, so nothing outside the flagged passages can change. An edit whose
// "before" is not found verbatim in the post is dropped rather than guessed.

export type FixProblem = {
  message: string
  kind?: string
  /** The exact passage the problem is about, when it has one. */
  match?: string
  field?: 'body' | 'seoTitle' | 'seoDescription'
}

export type PassageEdit = {
  /** Which problem (0-based) the edit answers. */
  problem: number
  field: 'body' | 'seoTitle' | 'seoDescription'
  before: string
  after: string
}

export type FixResult = { ok: true; edits: PassageEdit[] } | { ok: false; reason: string }

function fixSystem(brief: BlogBrief): string {
  const links =
    brief.landingLinks.length > 0
      ? brief.landingLinks.map((l) => `- ${l.label}: /${l.path}`).join('\n')
      : '(none available — do not invent internal links)'
  return [
    INTRO,
    factsFor(brief),
    checklistRules(brief),
    audienceRule(brief),
    LINK_MAP_TEXT,
    'Internal links you may use (exact relative paths only; invent no others):',
    links,
    publishedPostsBlock(brief),
    OUTCOME_RULE,
    figureRuleFor(brief),
    BANNED_WORD_RULE,
    'You FIX specific problems in a TutorMint blog post. For each numbered problem return ONE edit:',
    '- "before": the exact passage copied character-for-character from the post (one sentence, one paragraph or one link — as short as fixes the problem, including any Markdown in it);',
    '- "after": its rewrite. It fixes ONLY that problem, stays true to the facts, keeps the voice, and keeps the Markdown links that were in it unless the problem is about a link.',
    'Change nothing else. For a problem in the SEO title or meta description, use field "seoTitle" or "seoDescription", "before" = the whole current value, "after" = the whole new value within its character limit.',
    'For a whole-post problem (too few or too many links), choose one sentence and rewrite it with the link added or removed.',
    brief.language === 'ur' ? 'Write in Roman Urdu (Latin script).' : 'Write in clear English.',
    'Reply as JSON only, exactly: {"edits": [{"problem": 1, "field": "body", "before": "...", "after": "..."}]}',
  ].join('\n')
}

/**
 * Ask the writer to rewrite only the passages the checker flagged. Edits whose
 * "before" is not in the post (or the field) are dropped. Never throws.
 */
export async function fixBlogPassages(
  brief: BlogBrief,
  input: { body: string; seoTitle: string; seoDescription: string; problems: FixProblem[] },
): Promise<FixResult> {
  if (!isConfigured()) return { ok: false, reason: 'ANTHROPIC_API_KEY is not set' }
  const problems = input.problems.slice(0, 25)
  if (problems.length === 0) return { ok: true, edits: [] }

  const prompt = [
    'PROBLEMS:',
    ...problems.map((p, i) =>
      [`${i + 1}. ${p.message}`, p.field && p.field !== 'body' ? `   (in the ${p.field === 'seoTitle' ? 'SEO title' : 'meta description'})` : '', p.match && (!p.field || p.field === 'body') ? `   Passage: ${p.match}` : '']
        .filter(Boolean)
        .join('\n'),
    ),
    '',
    `SEO title: ${input.seoTitle}`,
    `Meta description: ${input.seoDescription}`,
    '',
    'POST:',
    input.body,
  ].join('\n')

  const result = await complete({ system: fixSystem(brief), prompt, maxTokens: 3000, timeoutMs: 50_000 })
  if (!result.ok) return { ok: false, reason: result.reason }

  let parsed: { edits?: unknown }
  try {
    const raw = result.text
    const start = raw.indexOf('{')
    const end = raw.lastIndexOf('}')
    if (start === -1 || end <= start) throw new Error('no JSON object')
    parsed = JSON.parse(raw.slice(start, end + 1)) as { edits?: unknown }
  } catch (e) {
    return { ok: false, reason: `unparseable reply: ${String(e).slice(0, 120)}` }
  }

  const edits: PassageEdit[] = []
  for (const e of Array.isArray(parsed.edits) ? parsed.edits : []) {
    const o = e as Record<string, unknown>
    const field = o.field === 'seoTitle' || o.field === 'seoDescription' ? o.field : 'body'
    const before = typeof o.before === 'string' ? o.before : ''
    const after = typeof o.after === 'string' ? o.after.trim() : ''
    const problem = Math.max(0, Math.min(problems.length - 1, Number(o.problem ?? 1) - 1))
    if (!after) continue
    if (field === 'body') {
      if (!before || !input.body.includes(before) || before === after) continue
      edits.push({ problem, field, before, after })
    } else {
      const current = field === 'seoTitle' ? input.seoTitle : input.seoDescription
      if (after === current) continue
      edits.push({ problem, field, before: current, after })
    }
  }
  return { ok: true, edits }
}

/** Apply accepted edits to a post: each body edit replaces its passage once. */
export { applyPassageEdits } from './passageEdits'
