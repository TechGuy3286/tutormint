import { NextResponse } from 'next/server'
import { listPublishedPosts } from '@/lib/blogFeed'
import { isClusterSlug } from '@/lib/blog'

// The infinite-scroll endpoint for /blog. Public, published posts only. Shape
// is Page<BlogListItem> = { items, cursor } — what useInfinite expects.

export const dynamic = 'force-dynamic'

export async function GET(request: Request) {
  const url = new URL(request.url)
  const clusterRaw = url.searchParams.get('cluster')
  const cluster = clusterRaw && isClusterSlug(clusterRaw) ? clusterRaw : null
  const cursor = url.searchParams.get('cursor')

  const { items, nextCursor } = await listPublishedPosts({ cluster, limit: 9, cursor })
  return NextResponse.json({ items, cursor: nextCursor })
}
