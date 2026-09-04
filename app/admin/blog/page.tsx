import Link from 'next/link'
import { Plus } from 'lucide-react'

import { requireAdminRole, roleSatisfies, SCREEN_ACCESS } from '@/lib/adminAuth'
import BlogAdminList from '@/components/admin/blog/BlogAdminList'
import { listAdminPosts } from '@/lib/blogFeed'

// /admin/blog — every post, drafts included. Manager or support (support
// drafts, manager publishes). The list itself re-checks in its API route.

export const dynamic = 'force-dynamic'

export default async function AdminBlogPage() {
  const actor = await requireAdminRole(...SCREEN_ACCESS.blog)
  const { items, nextCursor } = await listAdminPosts({ limit: 20 })
  const canPublish = roleSatisfies(actor.adminRole, SCREEN_ACCESS.blogPublish)

  return (
    <div className="space-y-4">
      <header className="flex flex-wrap items-center justify-between gap-2">
        <div className="space-y-1">
          <h1 className="text-lg font-black text-tm-navy">Blog</h1>
          <p className="text-xs text-gray-500">
            {canPublish
              ? 'Write, review and publish guides for parents and tutors.'
              : 'Write and save drafts. A manager reviews and publishes them.'}
          </p>
        </div>
        <Link
          href="/admin/blog/new"
          className="inline-flex min-h-[44px] items-center gap-1.5 rounded-xl bg-tm-navy px-4 text-xs font-bold text-white hover:bg-tm-navy-hover"
        >
          <Plus aria-hidden size={14} /> New post
        </Link>
      </header>

      <BlogAdminList initialItems={items} initialCursor={nextCursor} />
    </div>
  )
}
