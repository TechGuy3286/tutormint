import { requireAdminRole, roleSatisfies, SCREEN_ACCESS } from '@/lib/adminAuth'
import PostEditor from '@/components/admin/blog/PostEditor'
import { landingOptionsForEditor, emptyEditorPost } from '@/lib/blogEditor'
import { listEditorSuggestions } from '@/lib/contentQueue/feed'
import { isClusterSlug, type PostAudience, type PostLanguage } from '@/lib/blog'
import { slugify } from '@/lib/slugs'

export const dynamic = 'force-dynamic'

// New post. A "Start from a suggested title" panel lists the open content queue;
// picking one (or arriving from the queue's "Draft this" at ?suggestion=<id>)
// pre-fills title, slug, cluster, audience, language, city, subject and the
// evidence as fact notes, and links the post to the suggestion so the first
// save marks it 'drafted', publishing marks it 'done', and deleting reopens it.

export default async function NewPostPage({
  searchParams,
}: {
  searchParams: Promise<{ suggestion?: string }>
}) {
  const [actor, landingOptions, suggestions, { suggestion }] = await Promise.all([
    requireAdminRole(...SCREEN_ACCESS.blog),
    landingOptionsForEditor(),
    listEditorSuggestions(),
    searchParams,
  ])

  let initial = emptyEditorPost()
  let suggestionId: string | null = null

  if (suggestion) {
    const s = suggestions.find((x) => x.id === suggestion)
    if (s) {
      suggestionId = s.id
      initial = {
        ...initial,
        title: s.title,
        slug: slugify(s.title),
        cluster: s.cluster && isClusterSlug(s.cluster) ? s.cluster : initial.cluster,
        audience: s.audience as PostAudience,
        language: s.language as PostLanguage,
        city: s.city ?? '',
        subject: s.subject ?? '',
        sourceNotes: s.notes,
      }
    }
  }

  return (
    <PostEditor
      initial={initial}
      landingOptions={landingOptions}
      suggestions={suggestions}
      canPublishCap={roleSatisfies(actor.adminRole, SCREEN_ACCESS.blogPublish)}
      canGenerate={roleSatisfies(actor.adminRole, SCREEN_ACCESS.blogGenerate)}
      suggestionId={suggestionId}
    />
  )
}
