import 'server-only'

import { landingOptionsForEditor, tutorProfileOptionsForEditor } from '@/lib/blogEditor'
import { publishedPostLinks } from '@/lib/blogFeed'
import { factsSheetText, type PlatformFacts } from '@/lib/ai/factsSheet'
import { loadLinkIndexing, loadPlatformFacts } from '@/lib/ai/factsSheetServer'
import type { BlogBrief } from '@/lib/ai/blogBrief'
import type { CheckerContext } from '@/lib/ai/blogChecker'
import { indexableLandingItems, indexableTutorsForPosts } from '@/lib/blogRelevance'
import { matchingTutorSlugs, postTopic, relevantItems } from '@/lib/blogRelevanceCore'
import { citySegment } from '@/lib/slugs'

// The ONE place a blog brief is assembled from the live site (owner, 6 Oct
// 2026). The admin "Generate draft" route and the internal test harness both
// call this, so what the model is allowed to link cannot drift between them.
//
// The model gets the LIVE set of things it may link to: the city × subject
// landing pages (ranked by listings), the indexable tutor profiles (the same
// set the sitemap lists), the indexable "Tuition jobs in <City>" pages, the key
// pages that carry an intent (browse, post a tuition, the optional FAQ — never
// pricing), and recently published posts. And it gets the LIVE facts sheet
// (owner, 7 Oct 2026), built from the plan rows at request time.
// Capped so the prompt stays bounded.

export type BriefInput = Pick<BlogBrief, 'title' | 'clusterLabel' | 'audience' | 'language' | 'notes'> & {
  /** The post's City and Subject fields — the links offered must match them. */
  city?: string | null
  subject?: string | null
}

type PostRef = { city?: string | null; subject?: string | null; title?: string | null }

/**
 * What a post may link, by the ONE relevance rule (owner, 13 Oct 2026): the
 * landing pages about its subject, level or city; the tutors who teach its
 * subject at its level (in its city); and the city tuition-jobs pages — the
 * post's own city only, when it has one.
 */
export async function relevantForPost(post: PostRef, cityJobPaths: string[]) {
  const topic = postTopic(post)
  const [items, tutors] = await Promise.all([
    indexableLandingItems().catch(() => []),
    indexableTutorsForPosts().catch(() => []),
  ])
  const landing = relevantItems(items, topic, { limit: 12 })
  const slugs = new Set(matchingTutorSlugs(topic, tutors))
  const own = topic.city ? `/tuition-jobs/${citySegment(post.city ?? '')}` : null
  const cityJobs = own ? cityJobPaths.filter((p) => p === own) : cityJobPaths
  return {
    landing,
    relatedLandingPaths: landing.map((l) => `/${l.path}`),
    tutors: tutors.filter((t) => slugs.has(t.slug)).map((t) => ({ slug: t.slug, name: t.name })),
    // A post about one city links that city's page; with none of its own, any.
    cityJobPaths: cityJobs.length > 0 ? cityJobs : cityJobPaths,
  }
}

function cityName(path: string): string {
  return (path.split('/').pop() ?? '')
    .split('-')
    .filter(Boolean)
    .map((w) => w[0].toUpperCase() + w.slice(1))
    .join(' ')
}

export async function buildBlogBrief(input: BriefInput): Promise<BlogBrief> {
  const [posts, facts, indexing] = await Promise.all([publishedPostLinks(), loadPlatformFacts(), loadLinkIndexing()])
  // ONLY what matches the post's subject, level and city (owner, 13 Oct 2026):
  // the writer is never offered a Grade 7 English page for a Primary Islamiat
  // post, nor a tutor who does not teach the post's subject.
  const rel = await relevantForPost({ city: input.city, subject: input.subject, title: input.title }, indexing.cityJobPaths)
  const linkOptions = [
    ...rel.landing.map((l) => ({ label: `${l.name} · ${l.city} (${l.kind === 'tutors' ? 'tutors' : 'tuitions'})`, path: l.path })),
    ...rel.cityJobPaths.slice(0, 12).map((p) => ({ label: `Tuition jobs in ${cityName(p)}`, path: p.slice(1) })),
    ...rel.tutors.slice(0, 6).map((t) => ({ label: `Tutor profile: ${t.name}`, path: `tutor/${t.slug}` })),
    { label: 'Questions and answers (FAQ, optional)', path: 'faq' },
    { label: 'Find tutors', path: 'browse/tutors' },
    { label: 'Open tuitions (for tutors finding work)', path: 'browse/tuitions' },
    { label: 'Create a tutor profile (the closing call to action for tutors)', path: 'apply' },
    ...posts.slice(0, 12).map((p) => ({ label: `Blog: ${p.title}`, path: `blog/${p.slug}` })),
  ]
  return {
    ...input,
    landingLinks: linkOptions,
    // PR35 §3 — today's date (for timing lines) and the published posts by name.
    today: new Date().toISOString().slice(0, 10),
    publishedPosts: posts.slice(0, 12),
    factsText: factsSheetText(facts),
    namedTutors: rel.tutors.slice(0, 6),
  }
}

/** Everything the checker and the fixer need, from the same live sets. */
export type LiveCheckerData = {
  ctx: Required<Pick<CheckerContext, 'publishedPostSlugs' | 'landingPaths' | 'tutorSlugs' | 'facts' | 'noindexLinks' | 'cityJobPaths'>> &
    Pick<CheckerContext, 'relatedLandingPaths' | 'matchingTutorSlugs' | 'tutorNames'>
  blogTitles: Record<string, string>
  tutorNames: Record<string, string>
  facts: PlatformFacts
}

/** The checker/fixer context for a body, from the same live sets. */
export async function checkerContextForBody(excludeSlug?: string | null, post?: PostRef): Promise<LiveCheckerData['ctx']> {
  return (await liveCheckerData(excludeSlug, post)).ctx
}

/**
 * `post` — the post being checked. When given, the context also carries what is
 * RELATED to it, so the checker flags a tutor or a landing page that is not
 * about the post's subject, level or city.
 */
export async function liveCheckerData(excludeSlug?: string | null, post?: PostRef): Promise<LiveCheckerData> {
  const [landing, posts, tutors, facts, indexing] = await Promise.all([
    landingOptionsForEditor(),
    publishedPostLinks(),
    tutorProfileOptionsForEditor(),
    loadPlatformFacts(),
    loadLinkIndexing(),
  ])
  const others = posts.filter((p) => p.slug !== excludeSlug)
  const rel = post ? await relevantForPost(post, indexing.cityJobPaths) : null
  return {
    ctx: {
      ...(rel
        ? {
            relatedLandingPaths: rel.relatedLandingPaths,
            matchingTutorSlugs: rel.tutors.map((t) => t.slug),
            tutorNames: Object.fromEntries(tutors.map((t) => [t.slug, t.name])),
          }
        : {}),
      publishedPostSlugs: others.map((p) => p.slug),
      landingPaths: landing.map((l) => `/${l.path}`),
      tutorSlugs: tutors.map((t) => t.slug),
      facts,
      noindexLinks: indexing.noindexLinks,
      cityJobPaths: indexing.cityJobPaths,
    },
    blogTitles: Object.fromEntries(others.map((p) => [p.slug, p.title])),
    tutorNames: Object.fromEntries(tutors.map((t) => [t.slug, t.name])),
    facts,
  }
}

/** The live checker data the blog editor needs as props (plain data). */
export type EditorLiveData = {
  facts: PlatformFacts
  factsText: string
  noindexLinks: Record<string, string>
  cityJobPaths: string[]
  blogTitles: Record<string, string>
  tutorNames: Record<string, string>
}

export async function editorLiveData(excludeSlug?: string | null): Promise<EditorLiveData> {
  const d = await liveCheckerData(excludeSlug)
  return {
    facts: d.facts,
    factsText: factsSheetText(d.facts),
    noindexLinks: d.ctx.noindexLinks,
    cityJobPaths: d.ctx.cityJobPaths,
    blogTitles: d.blogTitles,
    tutorNames: d.tutorNames,
  }
}
