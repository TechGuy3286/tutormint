import 'server-only'

import { landingOptionsForEditor, tutorProfileOptionsForEditor } from '@/lib/blogEditor'
import { publishedPostLinks } from '@/lib/blogFeed'
import type { BlogBrief } from '@/lib/ai/blogBrief'

// The ONE place a blog brief is assembled from the live site (owner, 6 Oct
// 2026). The admin "Generate draft" route and the internal test harness both
// call this, so what the model is allowed to link cannot drift between them.
//
// The model gets the LIVE set of things it may link to: the city × subject
// landing pages (ranked by listings), the indexable tutor profiles (the same
// set the sitemap lists), the key pages that carry an intent (browse, post a
// tuition, the optional FAQ — never pricing), and recently published posts.
// Every path exists, so the links it places resolve; the save gate re-checks.
// Capped so the prompt stays bounded.

export type BriefInput = Pick<BlogBrief, 'title' | 'clusterLabel' | 'audience' | 'language' | 'notes'>

export async function buildBlogBrief(input: BriefInput): Promise<BlogBrief> {
  const [landing, posts, tutors] = await Promise.all([
    landingOptionsForEditor(),
    publishedPostLinks(),
    tutorProfileOptionsForEditor(),
  ])
  const linkOptions = [
    ...landing.slice(0, 40).map((l) => ({ label: l.label, path: l.path })),
    ...tutors.slice(0, 12).map((t) => ({ label: `Tutor profile: ${t.name}`, path: `tutor/${t.slug}` })),
    { label: 'Questions and answers (FAQ, optional)', path: 'faq' },
    { label: 'Find tutors', path: 'browse/tutors' },
    { label: 'Open tuitions (for tutors finding work)', path: 'browse/tuitions' },
    ...posts.slice(0, 12).map((p) => ({ label: `Blog: ${p.title}`, path: `blog/${p.slug}` })),
  ]
  return {
    ...input,
    landingLinks: linkOptions,
    // PR35 §3 — today's date (for timing lines) and the published posts by name.
    today: new Date().toISOString().slice(0, 10),
    publishedPosts: posts.slice(0, 12),
  }
}

/** The checker/fixer context for a body, from the same live sets. */
export async function checkerContextForBody(excludeSlug?: string | null) {
  const [landing, posts, tutors] = await Promise.all([
    landingOptionsForEditor(),
    publishedPostLinks(),
    tutorProfileOptionsForEditor(),
  ])
  return {
    publishedPostSlugs: posts.filter((p) => p.slug !== excludeSlug).map((p) => p.slug),
    landingPaths: landing.map((l) => `/${l.path}`),
    tutorSlugs: tutors.map((t) => t.slug),
  }
}
