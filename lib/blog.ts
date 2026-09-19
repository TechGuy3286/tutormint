// lib/blog.ts
//
// The blog's shared vocabulary: clusters, statuses, the SEO ceilings, the
// publish gate and the audience CTA.
//
// PURE DATA, NO SERVER IMPORTS. The editor is a client component and imports
// the clusters and the publish gate from here, exactly as the admin sidebar
// imports lib/adminNav.ts. Anything that reaches the database (reads,
// mutations, the scheduled sweep) lives in lib/blogFeed.ts and
// lib/blogPublish.ts, which are server-only. Keep this file importable from the
// browser.

import { scaffoldViolations, promptLeakViolations } from '@/lib/ai/blogBrief'
import { contradictionViolations } from '@/lib/ai/platformFacts'

export type PostStatus = 'draft' | 'reviewed' | 'scheduled' | 'published' | 'unpublished'
export type PostAudience = 'parents' | 'tutors' | 'both'
export type PostLanguage = 'en' | 'ur'

/** The fixed content clusters (CLAUDE.md 9.3). A typo cannot invent one — the
 *  column has a CHECK, and the /blog index only filters on these. */
export const POST_CLUSTERS: { slug: string; label: string }[] = [
  { slug: 'cost-hiring', label: 'Cost & hiring' },
  { slug: 'boards-exams', label: 'Boards & exams' },
  { slug: 'subject-guides', label: 'Subject guides' },
  { slug: 'city-guides', label: 'City guides' },
  { slug: 'tutor-career', label: 'Tutor career' },
  { slug: 'safety-trust', label: 'Safety & trust' },
  { slug: 'urdu', label: 'Urdu' },
]

const CLUSTER_LABEL = new Map(POST_CLUSTERS.map((c) => [c.slug, c.label]))

export function clusterLabel(slug: string): string {
  return CLUSTER_LABEL.get(slug) ?? slug
}

export function isClusterSlug(slug: string): boolean {
  return CLUSTER_LABEL.has(slug)
}

export const AUDIENCES: { value: PostAudience; label: string }[] = [
  { value: 'both', label: 'Everyone' },
  { value: 'parents', label: 'Parents' },
  { value: 'tutors', label: 'Tutors' },
]

export const LANGUAGES: { value: PostLanguage; label: string }[] = [
  { value: 'en', label: 'English' },
  { value: 'ur', label: 'Urdu' },
]

/** The SEO field ceilings the editor counts against. */
export const SEO_TITLE_MAX = 60
export const SEO_DESCRIPTION_MAX = 155

export function statusLabel(status: PostStatus): string {
  switch (status) {
    case 'draft':
      return 'Draft'
    case 'reviewed':
      return 'Reviewed'
    case 'scheduled':
      return 'Scheduled'
    case 'published':
      return 'Published'
    case 'unpublished':
      return 'Unpublished'
    default:
      return status
  }
}

/** The public URL of a post. Slug is immutable once published. */
export function postPath(slug: string): string {
  return `/blog/${slug}`
}

/** The public storage URL of a cover image in the `blog` bucket. */
export function publicBlogUrl(path: string): string {
  const base = process.env.NEXT_PUBLIC_SUPABASE_URL ?? ''
  return `${base}/storage/v1/object/public/blog/${path}`
}

/** A post as the editor holds it, and as canPublish() reads it. */
export type PublishGateInput = {
  title: string
  slug: string
  body: string
  coverPath: string | null
  coverAlt: string | null
  editedByHuman: boolean
  reviewed: boolean
}

/**
 * The STATE checks only (PR35 §4): a human has saved an edit and ticked
 * Reviewed, and the fields a published page needs are present. These are
 * facts about the post record, not its prose — the body-level problems
 * (scaffold, leaked prompt, contradictions, links) come from
 * collectBlogProblems() in lib/ai/blogChecker, so the two are never duplicated.
 */
export function statePublishReasons(p: PublishGateInput): string[] {
  const reasons: string[] = []
  if (!p.editedByHuman) reasons.push('Save at least one edit first.')
  if (!p.reviewed) reasons.push('Tick “Reviewed” once a person has read it through.')
  if (!p.title.trim()) reasons.push('Give the post a title.')
  if (!p.slug.trim()) reasons.push('The post needs a slug.')
  if (!p.body.trim()) reasons.push('The body is empty.')
  // A cover is optional, but if one is set its alt text is not — it is what a
  // screen reader and a broken-image fallback read.
  if (p.coverPath && !(p.coverAlt ?? '').trim()) {
    reasons.push('Add alt text for the cover image.')
  }
  return reasons
}

/**
 * The publish gate, in one place because the button (client) and the route
 * (server) must agree on it exactly. Publish is allowed only when a human has
 * saved at least one edit AND ticked "reviewed", the post has the fields a
 * published page needs, AND its BODY is clean (no scaffold, leaked prompt, or
 * fact contradiction). Returns every unmet reason so the editor can show them.
 *
 * Link RULES (3–5 links, each once, /membership-plans, /faq, one blog post) and
 * link EXISTENCE are checked by collectBlogProblems() in the route and editor,
 * because they need the live set of published posts and landing pages that this
 * pure function does not have.
 */
export function canPublish(p: PublishGateInput): { ok: boolean; reasons: string[] } {
  const reasons: string[] = [...statePublishReasons(p)]
  // Never publish the AI scaffold. A composed draft ships with instruction
  // lines ("Edit it into shape before publishing", "Explain the steps in
  // order…") as a starting point; one went live once. Block publish while any
  // remain, and name the offending line so it is obvious what to delete.
  for (const line of scaffoldViolations(p.body)) {
    reasons.push(`Remove the draft scaffold line: “${line}”`)
  }
  // Never publish leaked model instructions or internal data (owner PR14 §1.3).
  for (const line of promptLeakViolations(p.body)) {
    reasons.push(`Remove this instruction/internal-data line: “${line}”`)
  }
  // PR16 §6.2 — a claim that contradicts the platform facts sheet blocks
  // publishing until it is corrected.
  for (const c of contradictionViolations(p.body)) {
    reasons.push(`This line contradicts how TutorMint works (${c.why}): “${c.line}”`)
  }
  return { ok: reasons.length === 0, reasons }
}

/**
 * The reader CTA at the foot of a post, chosen by the post's audience. No
 * price on either — a public page never signals a paywall (the conversion
 * rules). A post for "both" shows both.
 */
export type PostCta = { audience: 'parents' | 'tutors'; heading: string; body: string; href: string; label: string }

export function ctasFor(audience: PostAudience): PostCta[] {
  const parents: PostCta = {
    audience: 'parents',
    heading: 'Looking for a verified tutor?',
    body: 'Post what you need and let identity-checked tutors come to you. Free to post.',
    href: '/parent/dashboard/post-job',
    label: 'Post a tuition',
  }
  const tutors: PostCta = {
    audience: 'tutors',
    heading: 'Teach on TutorMint',
    body: 'Join free and appear to parents searching for your subject in your area.',
    href: '/register',
    label: 'Join TutorMint',
  }
  if (audience === 'parents') return [parents]
  if (audience === 'tutors') return [tutors]
  return [parents, tutors]
}
