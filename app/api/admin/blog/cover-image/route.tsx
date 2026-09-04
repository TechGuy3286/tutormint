import { getAdminActor, roleSatisfies, SCREEN_ACCESS } from '@/lib/adminAuth'
import { clusterLabel, isClusterSlug } from '@/lib/blog'

import { COVER_SIZES, renderCover } from './render'

// Live preview of a generated cover, at one size. Renders on the fly and stores
// nothing -- the editor points an <img> at it while the manager picks a look.
// The committing path (upload to the bucket) is ../generate-cover.
//
// Not checkAdminRole: this returns an image, and an HTML error page inside an
// <img> is worse than a plain status.

export const runtime = 'nodejs'

export async function GET(request: Request) {
  const actor = await getAdminActor()
  if (!actor || !roleSatisfies(actor.adminRole, SCREEN_ACCESS.blog)) {
    return new Response('Not allowed.', { status: 403 })
  }

  const url = new URL(request.url)
  const title = (url.searchParams.get('title') ?? '').slice(0, 200) || 'Untitled post'
  const clusterSlug = url.searchParams.get('cluster') ?? 'cost-hiring'
  const size = url.searchParams.get('size') === 'square' ? 'square' : 'wide'

  if (!isClusterSlug(clusterSlug)) return new Response('Unknown cluster.', { status: 400 })
  if (!COVER_SIZES[size]) return new Response('Unknown size.', { status: 400 })

  return renderCover({ title, clusterLabel: clusterLabel(clusterSlug), size })
}
