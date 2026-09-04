import { requireAdminRole, roleSatisfies, SCREEN_ACCESS } from '@/lib/adminAuth'
import PostEditor from '@/components/admin/blog/PostEditor'
import { landingOptionsForEditor, emptyEditorPost } from '@/lib/blogEditor'
import { getSuggestion } from '@/lib/contentQueue/feed'
import { isClusterSlug, type PostAudience, type PostLanguage } from '@/lib/blog'

export const dynamic = 'force-dynamic'

// New post. When opened from the content queue (?suggestion=<id>) the editor is
// pre-filled — title, cluster, audience, language, and the evidence as the fact
// notes — so part 2 writes the draft. The suggestion id is threaded through so
// that saving the post marks the suggestion 'drafted' and it leaves the queue.

export default async function NewPostPage({
  searchParams,
}: {
  searchParams: Promise<{ suggestion?: string }>
}) {
  const [actor, landingOptions, { suggestion }] = await Promise.all([
    requireAdminRole(...SCREEN_ACCESS.blog),
    landingOptionsForEditor(),
    searchParams,
  ])

  let initial = emptyEditorPost()
  let suggestionId: string | null = null

  if (suggestion) {
    const s = await getSuggestion(suggestion)
    // Only a live content suggestion pre-fills; a recruitment card is not a post.
    if (s && s.card === 'content' && (s.status === 'suggested' || s.status === 'snoozed')) {
      suggestionId = s.id
      initial = {
        ...initial,
        title: s.title,
        cluster: s.cluster && isClusterSlug(s.cluster) ? s.cluster : initial.cluster,
        audience: s.audience as PostAudience,
        language: s.language as PostLanguage,
        sourceNotes: s.notes,
      }
    }
  }

  return (
    <PostEditor
      initial={initial}
      landingOptions={landingOptions}
      canPublishCap={roleSatisfies(actor.adminRole, SCREEN_ACCESS.blogPublish)}
      canGenerate={roleSatisfies(actor.adminRole, SCREEN_ACCESS.blogGenerate)}
      suggestionId={suggestionId}
    />
  )
}
