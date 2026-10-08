import 'server-only'
import { pageAll } from '@/lib/pageAll'
import { liveLandingPages } from '@/lib/landing'
import { createPublicClient } from '@/lib/supabase/public'
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
    }))
    .sort((a, b) => b.count - a.count || a.label.localeCompare(b.label))
}

export type TutorProfileOption = { slug: string; name: string }

/**
 * The tutor profiles a post may link (owner, 6 Oct 2026): ONLY indexable ones —
 * the same set the sitemap lists (listed_tutor_slugs(): in the directory, fee
 * paid, CNIC + photo + selfie approved, not a fixture). A link to any other
 * profile is flagged by the checker. Names come from tutor_directory, which the
 * anon key may read.
 */
export async function tutorProfileOptionsForEditor(): Promise<TutorProfileOption[]> {
  const db = createPublicClient()
  const rows = await pageAll((from, to) => db.rpc('listed_tutor_slugs').order('slug').range(from, to))
  const slugs = ((rows ?? []) as { slug: string }[]).map((r) => r.slug).filter(Boolean)
  if (slugs.length === 0) return []
  const { data: names } = await db.from('tutor_directory').select('slug, full_name').in('slug', slugs)
  const nameBySlug = new Map((names ?? []).map((r) => [r.slug as string, (r.full_name as string) ?? '']))
  return slugs
    .map((slug) => ({ slug, name: nameBySlug.get(slug) || slug }))
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
