import Link from 'next/link'
import { Clock } from 'lucide-react'

import TimeAgo from '@/components/TimeAgo'
import { clusterLabel, postPath, publicBlogUrl } from '@/lib/blog'
import type { BlogListItem } from '@/lib/blogFeed'

// One blog post, as a card. Isomorphic: the index server-renders the first
// window and the client infinite list appends more, both from this component.
// No 'use client' — the only interactive part is TimeAgo, which brings its own
// boundary.
//
// The cover falls back to a cluster-tinted panel rather than a broken image, so
// a post saved without a picture still reads as a card.

export default function PostCard({ post }: { post: BlogListItem }) {
  const href = postPath(post.slug)
  const cover = post.coverPath ? publicBlogUrl(post.coverPath) : null

  return (
    <article className="group overflow-hidden rounded-2xl border border-gray-200 bg-white transition-colors hover:border-tm-navy">
      <Link href={href} className="block">
        <div className="aspect-[16/9] w-full overflow-hidden bg-tm-tint-navy">
          {cover ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={cover}
              alt={post.coverAlt ?? ''}
              className="h-full w-full object-cover"
              loading="lazy"
            />
          ) : (
            <div className="flex h-full w-full items-center justify-center px-4 text-center">
              <span className="text-sm font-black text-tm-navy">{clusterLabel(post.cluster)}</span>
            </div>
          )}
        </div>
        <div className="space-y-1.5 p-4">
          <div className="flex items-center gap-2">
            <span className="rounded-full bg-tm-tint-navy px-2 py-0.5 text-[10px] font-bold text-tm-navy">
              {clusterLabel(post.cluster)}
            </span>
            {post.language === 'ur' && (
              <span className="rounded-full bg-tm-tint-green px-2 py-0.5 text-[10px] font-bold text-tm-green-deep">
                اردو
              </span>
            )}
          </div>
          <h3 className="line-clamp-2 text-sm font-black text-tm-navy group-hover:underline">
            {post.title}
          </h3>
          {post.excerpt && <p className="line-clamp-2 text-xs text-gray-600">{post.excerpt}</p>}
          <div className="flex items-center gap-3 pt-0.5 text-[11px] text-gray-500">
            <span className="inline-flex items-center gap-1">
              <Clock aria-hidden size={12} /> {post.readingTime} min read
            </span>
            {post.publishedAt && <TimeAgo iso={post.publishedAt} />}
          </div>
        </div>
      </Link>
    </article>
  )
}
