'use client'

import { useMemo } from 'react'

import PostCard from '@/components/blog/PostCard'
import InfiniteFooter from '@/components/InfiniteFooter'
import { useInfinite } from '@/lib/useInfinite'
import type { BlogListItem } from '@/lib/blogFeed'

// The client half of the /blog index: appends more post cards below the
// server-rendered first window. Same pattern as the browse and landing lists —
// the first page is server HTML (organic-search surface), this only appends.

export default function MorePosts({
  params,
  initialCursor,
  total,
}: {
  params: Record<string, string>
  initialCursor: string | null
  total: number
}) {
  const storageKey = useMemo(
    () => `tm:blog:${new URLSearchParams(params).toString()}`,
    [params],
  )
  const { items, state, done, loadMore, sentinel } = useInfinite<BlogListItem>({
    endpoint: '/api/blog/list',
    params,
    initialCursor,
    storageKey,
  })

  return (
    <>
      {items.length > 0 && (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {items.map((p) => (
            <PostCard key={p.id} post={p} />
          ))}
        </div>
      )}
      <InfiniteFooter
        state={state}
        done={done}
        loadMore={loadMore}
        sentinel={sentinel}
        loadedCount={items.length}
        total={total}
        noun="posts"
      />
    </>
  )
}
