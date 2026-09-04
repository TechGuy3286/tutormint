import 'server-only'
import { liveLandingPages } from '@/lib/landing'
import type { EditorPost } from '@/components/admin/blog/PostEditor'
import type { PostAudience, PostLanguage, PostStatus } from '@/lib/blog'

// Server helpers the blog editor pages share: the related-landing options and
// the row → editor-state conversion.

export async function landingOptionsForEditor(): Promise<{ path: string; label: string }[]> {
  const pages = await liveLandingPages()
  return pages
    .map((p) => ({
      path: `${p.kind}/${p.citySlug}/${p.subjectSlug}`,
      label: `${p.subjectName} · ${p.city} (${p.kind === 'tutors' ? 'tutors' : 'tuitions'})`,
    }))
    .sort((a, b) => a.label.localeCompare(b.label))
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
    coverAlt: (row.cover_alt as string) ?? null,
    seoTitle: (row.seo_title as string) ?? '',
    seoDescription: (row.seo_description as string) ?? '',
    related: (row.related_landing_pages as string[]) ?? [],
    reviewed: !!row.reviewed,
    editedByHuman: !!row.edited_by_human,
    status: (row.status as PostStatus) ?? 'draft',
    publishAt: (row.publish_at as string) ?? null,
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
    coverAlt: null,
    seoTitle: '',
    seoDescription: '',
    related: [],
    reviewed: false,
    editedByHuman: false,
    status: 'draft',
    publishAt: null,
  }
}
