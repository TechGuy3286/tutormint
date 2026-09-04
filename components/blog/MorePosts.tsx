'use client'

import { useMemo } from 'react'

import PostCard from '@/components/blog/PostCard'
import { useInfinite } from '@/lib/useInfinite'
import type { BlogListItem } from '@/lib/blogFeed'

// The client half of the /blog index: appends more post cards below the
// server-rendered first window. Same pattern as the browse and landing lists —
// the first page is server HTML (organic-search surface), this only appends.
//
// It renders only the load-more tail, never an end-of-list message: the page
// already shows the first window, and this component's own item list starts
// empty, so a "no posts" line here would contradict a visible post.

export default function MorePosts({
  params,
  initialCursor,
}: {
  params: Record<string, string>
  initialCursor: string | null
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

      <div ref={sentinel} aria-hidden className="h-px" />

      {!done && (
        <div className="flex justify-center py-2">
          <button
            type="button"
            onClick={loadMore}
            disabled={state === 'loading'}
            className="inline-flex min-h-[44px] items-center rounded-xl border border-gray-200 bg-white px-5 text-xs font-bold text-tm-navy disabled:opacity-60"
          >
            {state === 'loading' ? 'Loading…' : 'Load more posts'}
          </button>
        </div>
      )}
      {state === 'error' && (
        <p className="pb-2 text-center text-xs font-semibold text-tm-red">
          Could not load more. Try again.
        </p>
      )}
    </>
  )
}
