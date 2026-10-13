import 'server-only'
import { liveLandingPages } from '@/lib/landing'
import { indexableTutorsForPosts } from '@/lib/blogRelevance'
import type { EditorPost } from '@/components/admin/blog/PostEditor'
import type { LandingOption, PostAudience, PostLanguage, PostStatus } from '@/lib/blog'

// Server helpers the blog editor pages share: the related-landing options, the
// indexable tutor profiles a post may link, and the row → editor-state conversion.

/**
 * The live landing pages, with the city and subject each is about so the editor
 * can rank them by match with the post (lib/blog rankLandingOptions) — ordered
 * here by how many listings a page has, never alphabetically (owner, 6 Oct 2026).
 */
export async function landingOptionsForEditor(): Promise<LandingOption[]> {
  const pages = await liveLandingPages()
  return pages
    .map((p) => ({
      path: `${p.kind}/${p.citySlug}/${p.subjectSlug}`,
      label: `${p.subjectName} · ${p.city} (${p.kind === 'tutors' ? 'tutors' : 'tuitions'})`,
      city: p.city,
      subject: p.subjectName,
      kind: p.kind,
      count: p.count,
      level: p.levelName ?? null,
      subjectOnly: p.subjectOnly ?? null,
    }))
    .sort((a, b) => b.count - a.count || a.label.localeCompare(b.label))
}

export type TutorProfileOption = {
  slug: string
  name: string
  /** The tutor's city and what they teach — a post may name a tutor only when
   *  these match its subject, level and city (lib/blogRelevanceCore). */
  city?: string | null
  subjects?: { level?: string | null; subject?: string | null }[]
}

/**
 * The tutor profiles a post may link (owner, 6 Oct 2026): ONLY indexable ones —
 * the same set the sitemap lists (listed_tutor_slugs(): in the directory, fee
 * paid, CNIC + photo + selfie approved, not a fixture). A link to any other
 * profile is flagged by the checker. Names come from tutor_directory, which the
 * anon key may read.
 */
export async function tutorProfileOptionsForEditor(): Promise<TutorProfileOption[]> {
  const tutors = await indexableTutorsForPosts().catch(() => [])
  return tutors
    .map((t) => ({ slug: t.slug, name: t.name, city: t.city ?? null, subjects: t.subjects }))
    .sort((a, b) => a.name.localeCompare(b.name))
}

export function toEditorPost(row: Record<string, unknown>): EditorPost {
  return {
    id: row.id as string,
    title: (row.title as string) ?? '',
    slug: (row.slug as string) ?? '',
    slugLocked: !!row.slug_locked,
    cluster: (row.cluster as string) ?? 'cost-hiring',
    audience: (row.audience as PostAudience) ?? 'both',
    language: (row.language as PostLanguage) ?? 'en',
    body: (row.body as string) ?? '',
    coverPath: (row.cover_path as string) ?? null,
    coverSquarePath: (row.cover_square_path as string) ?? null,
    coverAlt: (row.cover_alt as string) ?? null,
    coverPrompt: (row.cover_prompt as string) ?? null,
    seoTitle: (row.seo_title as string) ?? '',
    seoDescription: (row.seo_description as string) ?? '',
    related: (row.related_landing_pages as string[]) ?? [],
    city: (row.city as string) ?? '',
    subject: (row.subject as string) ?? '',
    reviewed: !!row.reviewed,
    editedByHuman: !!row.edited_by_human,
    status: (row.status as PostStatus) ?? 'draft',
    publishAt: (row.publish_at as string) ?? null,
    sourceNotes: (row.source_notes as string) ?? '',
    confirmedFigures:
      (row.confirmed_figures as { figure: string; source: string }[] | null) ?? [],
    reviewBy: (row.review_by as string | null) ?? null,
    approvedAt: (row.approved_at as string | null) ?? null,
    numbersChecked: !!row.numbers_checked,
    selfCheck: (row.self_check as EditorPost['selfCheck']) ?? null,
  }
}

export function emptyEditorPost(): EditorPost {
  return {
    id: null,
    title: '',
    slug: '',
    slugLocked: false,
    cluster: 'cost-hiring',
    audience: 'both',
    language: 'en',
    body: '',
    coverPath: null,
    coverSquarePath: null,
    coverAlt: null,
    coverPrompt: null,
    seoTitle: '',
    seoDescription: '',
    related: [],
    city: '',
    subject: '',
    reviewed: false,
    editedByHuman: false,
    status: 'draft',
    publishAt: null,
    sourceNotes: '',
    confirmedFigures: [],
    reviewBy: null,
    approvedAt: null,
    numbersChecked: false,
    selfCheck: null,
  }
}
