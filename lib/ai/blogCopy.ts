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
import { PLATFORM_FACTS_TEXT } from './platformFacts'
import {
  BLOG_MAX_WORDS,
  BLOG_MIN_WORDS,
  composeBlogDraft,
  unsupportedFigures,
  withBrandTail,
  wordCount,
  type BlogBrief,
  type BlogDraft,
} from './blogBrief'

// PR16 §6.3 — how the internal-link list is described to the model, shared by the
// full-draft and sectioned prompts. It must place real links from the list only.
const LINK_RULE =
  'Internal links: place 3 to 5 relevant internal links in the body, using the EXACT paths from this list and no others. Never invent a link, and never link to a path not in this list:'

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
    ? 'THE HARD RULE — NEVER INVENT STATISTICS. Use ONLY numbers, fees, percentages, dates, pass rates, counts and names that appear in the facts below. If you do not have a number, write "typically" or describe it in words. A made-up statistic on a blog is quoted back as fact — do not produce one.'
    : 'THE HARD RULE — you were given NO facts. Write with NO figures AT ALL: no numbers, no percentages, no fees, no counts, no pass rates, no dates. Describe every magnitude in words ("typically", "most", "a few", "affordable"). A single invented figure fails the draft.'
}

function brandBrief(brief: BlogBrief): string {
  const noNotes = !brief.notes.trim()
  const links =
    brief.landingLinks.length > 0
      ? brief.landingLinks.map((l) => `- ${l.label}: /${l.path}`).join('\n')
      : '(none available — do not invent internal links)'

  const figureRule = figureRuleFor(brief)

  const cta =
    brief.audience === 'tutors'
      ? 'End with a short call to action inviting tutors to join TutorMint (no price).'
      : brief.audience === 'parents'
        ? 'End with a short call to action inviting parents to post a tuition on TutorMint (no price).'
        : 'End with a short call to action for both parents (post a tuition) and tutors (join), no price.'

  return [
    'You write for the TutorMint blog. TutorMint is a Pakistani platform where parents find verified tutors and tutors find tuitions. No fee, no commission, no middleman.',
    PLATFORM_FACTS_TEXT,
    'Voice: plain, warm, specific to Pakistan. No corporate filler, no "in today\'s fast-paced world", no hype.',
    'Structure:',
    `- ${BLOG_MIN_WORDS}-${BLOG_MAX_WORDS} words, and the length must come from COVERING MORE GROUND, never from padding. Generalities repeated at length are worse than a short post — for the reader and for Google.`,
    '- Write 5 to 7 DISTINCT ## H2 sections. Each section answers ONE specific question a Pakistani parent or tutor would actually type into Google (for example: "How much does an O Level Physics tutor cost in Lahore?", "How does TutorMint verify a tutor?", "What does the Verified badge mean?", "How do I hire a tutor step by step?"). Make each section concrete: how a flow actually works, what a badge actually means, what to do step by step.',
    '- Answer the reader\'s main question in the FIRST paragraph. Do not warm up.',
    '- Short paragraphs.',
    '- Include ONE comparison table using Markdown pipe syntax where it genuinely helps (costs, options, boards). Skip it if it does not.',
    '- Include a "## Frequently asked questions" section with 3-4 questions as ### sub-headings.',
    '- If the facts below are too thin to fill this length HONESTLY, write a shorter, accurate post rather than inventing material — do NOT pad with generalities to reach a word count.',
    cta,
    LINK_RULE,
    links,
    figureRule,
    BANNED_WORD_RULE,
    NO_META_RULE,
    brief.language === 'ur'
      ? 'Write in Roman Urdu (Urdu written in the Latin alphabet), the way Pakistanis text — not formal Nastaliq Urdu, and not English.'
      : 'Write in clear English.',
    'Also produce an SEO title (<= 60 characters) and a meta description (<= 155 characters) ending with "No fee, no commission, no middleman.".',
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

function outlineSystem(brief: BlogBrief): string {
  return [
    'You plan a post for the TutorMint blog. TutorMint is a Pakistani platform where parents find verified tutors and tutors find tuitions. No fee, no commission, no middleman.',
    PLATFORM_FACTS_TEXT,
    'Produce an OUTLINE only — no prose.',
    '- 5 to 7 H2 section headings. Each answers ONE specific question a Pakistani parent or tutor would type into Google (fees, how to choose, how verification works, step by step, and so on). Make the LAST heading "Frequently asked questions".',
    'Also produce an SEO title (<= 60 characters) and a meta description (<= 155 characters) ending with "No fee, no commission, no middleman.".',
    BANNED_WORD_RULE,
    NO_META_RULE,
    brief.language === 'ur' ? 'Headings in Roman Urdu (Latin script).' : 'Headings in clear English.',
    'Reply as JSON only, exactly: {"sections": ["...", "..."], "seoTitle": "...", "seoDescription": "..."}',
  ].join('\n')
}

function sectionSystem(brief: BlogBrief, sections: string[], index: number): string {
  const heading = sections[index]
  const links =
    brief.landingLinks.length > 0
      ? brief.landingLinks.map((l) => `- ${l.label}: /${l.path}`).join('\n')
      : '(none available — do not invent internal links)'
  const last = index === sections.length - 1
  return [
    'You write for the TutorMint blog. TutorMint is a Pakistani platform where parents find verified tutors and tutors find tuitions. No fee, no commission, no middleman.',
    PLATFORM_FACTS_TEXT,
    'Voice: plain, warm, specific to Pakistan. No corporate filler, no hype.',
    `You are writing ONE section of a post titled "${brief.title}". The full outline is:`,
    sections.map((s, i) => `${i + 1}. ${s}`).join('\n'),
    `Write ONLY section ${index + 1}: "${heading}". Begin with the Markdown heading "## ${heading}"${heading.toLowerCase().includes('frequently asked') ? ' and give 3-4 questions as "### " sub-headings with short answers' : ''}. About 200-300 words. Short paragraphs. Do not repeat other sections and do not write any other heading.`,
    last
      ? 'This is the last section — end with a short call to action (post a tuition / join TutorMint), no price.'
      : 'Do NOT add a call to action; this is not the last section.',
    'Internal links you MAY use where relevant (exact paths only; invent no others; the whole post should carry 3-5 across its sections):',
    links,
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

  const result = await complete({
    system: outlineSystem(brief),
    prompt: factsBlock(brief),
    maxTokens: 900,
    timeoutMs: 30_000,
  })
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
    const seoDescription = withBrandTail(
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
  const result = await complete({
    system: sectionSystem(brief, sections, index),
    prompt: factsBlock(brief),
    maxTokens: 1400,
    timeoutMs: 40_000,
  })
  if (!result.ok) {
    console.error(`[blogCopy] section ${index} failed:`, result.reason)
    return { ok: false, reason: result.reason }
  }
  const md = result.text.trim()
  if (!md) return { ok: false, reason: 'section returned no text' }
  return { ok: true, markdown: md }
}

function factsBlock(brief: BlogBrief): string {
  return [
    `Title: ${brief.title}`,
    `Topic: ${brief.clusterLabel}`,
    `Audience: ${brief.audience}`,
    '',
    'Facts you may use (and nothing beyond them for any number):',
    brief.notes.trim() || '(none supplied)',
  ].join('\n')
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
  const seoDescription = withBrandTail(seoLead || brief.title)

  const untraced = unsupportedFigures(body, brief.notes, brief.title, [], brief.landingLinks)

  // Title-only generation (no notes) must be figure-free. If the model slipped a
  // figure in anyway, fall back to the composed draft — which carries no number
  // the notes do not, so the result always passes the figure gate.
  if (!brief.notes.trim() && untraced.length > 0) {
    console.error('[blogCopy] no-notes draft included figures, composing instead:', untraced.join(', '))
    return { ...fallback, note: 'figures', reason: `the draft included unbacked figures (${untraced.join(', ')})` }
  }

  // A draft under the minimum is handed back as-is (never padded), flagged so
  // the editor asks for more fact notes rather than the model inventing filler.
  return { body, seoTitle, seoDescription, source: 'claude', untraced, words, short: words < BLOG_MIN_WORDS }
}
