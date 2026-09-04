import { requireAdminRole, roleSatisfies, SCREEN_ACCESS } from '@/lib/adminAuth'
import PostEditor from '@/components/admin/blog/PostEditor'
import { landingOptionsForEditor, emptyEditorPost } from '@/lib/blogEditor'

export const dynamic = 'force-dynamic'

export default async function NewPostPage() {
  const actor = await requireAdminRole(...SCREEN_ACCESS.blog)
  const landingOptions = await landingOptionsForEditor()

  return (
    <PostEditor
      initial={emptyEditorPost()}
      landingOptions={landingOptions}
      canPublishCap={roleSatisfies(actor.adminRole, SCREEN_ACCESS.blogPublish)}
      canGenerate={roleSatisfies(actor.adminRole, SCREEN_ACCESS.blogGenerate)}
    />
  )
}
