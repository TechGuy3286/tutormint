import { notFound } from 'next/navigation'

import { requireAdminRole, roleSatisfies, SCREEN_ACCESS } from '@/lib/adminAuth'
import PostEditor from '@/components/admin/blog/PostEditor'
import { getAdminPost, publishedPostLinks } from '@/lib/blogFeed'
import { landingOptionsForEditor, toEditorPost } from '@/lib/blogEditor'

export const dynamic = 'force-dynamic'

export default async function EditPostPage({ params }: { params: Promise<{ id: string }> }) {
  const actor = await requireAdminRole(...SCREEN_ACCESS.blog)
  const { id } = await params

  const [row, landingOptions, publishedPosts] = await Promise.all([
    getAdminPost(id),
    landingOptionsForEditor(),
    publishedPostLinks(),
  ])
  if (!row) notFound()

  return (
    <PostEditor
      // Keyed by post id: editor state never carries between two posts (PR28 §2.2).
      key={id}
      initial={toEditorPost(row)}
      landingOptions={landingOptions}
      publishedPosts={publishedPosts}
      canPublishCap={roleSatisfies(actor.adminRole, SCREEN_ACCESS.blogPublish)}
      canGenerate={roleSatisfies(actor.adminRole, SCREEN_ACCESS.blogGenerate)}
    />
  )
}
