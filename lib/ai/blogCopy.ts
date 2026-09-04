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

export { composeBlogDraft, unsupportedFigures } from './blogBrief'
export type { BlogBrief, BlogDraft } from './blogBrief'

/** The model, from the one place it is defined. Reported to the audit log. */
export const BLOG_MODEL = MODEL

function brandBrief(brief: BlogBrief): string {
  const links =
    brief.landingLinks.length > 0
      ? brief.landingLinks.map((l) => `- ${l.label}: /${l.path}`).join('\n')
      : '(none available — do not invent internal links)'

  const cta =
    brief.audience === 'tutors'
      ? 'End with a short call to action inviting tutors to join TutorMint (no price).'
      : brief.audience === 'parents'
        ? 'End with a short call to action inviting parents to post a tuition on TutorMint (no price).'
        : 'End with a short call to action for both parents (post a tuition) and tutors (join), no price.'

  return [
    'You write for the TutorMint blog. TutorMint is a Pakistani platform where parents find verified tutors and tutors find tuitions. No fee, no commission, no middleman.',
    'Voice: plain, warm, specific to Pakistan. No corporate filler, no "in today\'s fast-paced world", no hype.',
    'Structure:',
    `- ${BLOG_MIN_WORDS}-${BLOG_MAX_WORDS} words.`,
    '- Answer the reader\'s question in the FIRST paragraph. Do not warm up.',
    '- Use ## H2 section headings (Markdown). Short paragraphs.',
    '- Include ONE comparison table using Markdown pipe syntax where it genuinely helps (costs, options, boards). Skip it if it does not.',
    '- Include a "## Frequently asked questions" section with 3-4 questions as ### sub-headings.',
    cta,
    'Internal links: you MAY link to these landing pages where relevant, using their exact paths. Do not invent any other internal link:',
    links,
    'THE HARD RULE — NEVER INVENT STATISTICS. Use ONLY numbers, fees, percentages, dates, pass rates, counts and names that appear in the facts below. If you do not have a number, write "typically" or describe it in words. A made-up statistic on a blog is quoted back as fact — do not produce one.',
    brief.language === 'ur'
      ? 'Write in Roman Urdu (Urdu written in the Latin alphabet), the way Pakistanis text — not formal Nastaliq Urdu, and not English.'
      : 'Write in clear English.',
    'Also produce an SEO title (<= 60 characters) and a meta description (<= 155 characters) ending with "No fee, no commission, no middleman.".',
    'Reply as JSON only, exactly: {"body": "...markdown...", "seoTitle": "...", "seoDescription": "..."}',
  ].join('\n')
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
    // 1600 words of Markdown plus two SEO fields: generously above the ceiling
    // so a good draft is never cut mid-sentence into an unparseable reply.
    maxTokens: 4000,
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

  return { body, seoTitle, seoDescription, source: 'claude', untraced }
}
