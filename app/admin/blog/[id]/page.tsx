import { notFound } from 'next/navigation'

import { requireAdminRole, SCREEN_ACCESS, roleMayWrite } from '@/lib/adminAuth'
import PostEditor from '@/components/admin/blog/PostEditor'
import { editorLiveData } from '@/lib/blogGenerate'
import { getAdminPost, publishedPostLinks } from '@/lib/blogFeed'
import { landingOptionsForEditor, tutorProfileOptionsForEditor, toEditorPost } from '@/lib/blogEditor'

export const dynamic = 'force-dynamic'

export default async function EditPostPage({ params }: { params: Promise<{ id: string }> }) {
  const actor = await requireAdminRole(...SCREEN_ACCESS.blog)
  const { id } = await params

  const [row, landingOptions, publishedPosts, tutorProfiles] = await Promise.all([
    getAdminPost(id),
    landingOptionsForEditor(),
    publishedPostLinks(),
    tutorProfileOptionsForEditor(),
  ])
  if (!row) notFound()
  const live = await editorLiveData((row.slug as string) ?? null)

  return (
    <PostEditor
      // Keyed by post id: editor state never carries between two posts (PR28 §2.2).
      key={id}
      initial={toEditorPost(row)}
      landingOptions={landingOptions}
      publishedPosts={publishedPosts}
      tutorProfiles={tutorProfiles}
      live={live}
      canPublishCap={roleMayWrite(actor.adminRole, SCREEN_ACCESS.blogPublish)}
      canApproveCap={roleMayWrite(actor.adminRole, SCREEN_ACCESS.blogApprove)}
      canGenerate={roleMayWrite(actor.adminRole, SCREEN_ACCESS.blogGenerate)}
    />
  )
}
