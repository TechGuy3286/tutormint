import { getAdminActor, roleSatisfies, SCREEN_ACCESS } from '@/lib/adminAuth'
import { isClusterSlug } from '@/lib/blog'
import { composeCoverResponse } from '@/lib/covers/render'
import type { CoverInput } from '@/lib/covers/select'

// Live preview of ONE composed cover variant, at a given seed. Renders on the
// fly and stores nothing — the editor points three <img> at it (seeds 0..2)
// while the manager picks a look, and "Shuffle" advances the seeds by three.
// The committing path (upload to the bucket) is ../generate-cover.
//
// Not checkAdminRole: this returns an image, and an HTML error page inside an
// <img> is worse than a plain status.

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

function num(v: string | null, fallback: number): number {
  const n = Number(v)
  return Number.isFinite(n) ? n : fallback
}

export async function GET(request: Request) {
  const actor = await getAdminActor()
  if (!actor || !roleSatisfies(actor.adminRole, SCREEN_ACCESS.blog)) {
    return new Response('Not allowed.', { status: 403 })
  }

  const url = new URL(request.url)
  const cluster = url.searchParams.get('cluster') ?? 'cost-hiring'
  if (!isClusterSlug(cluster)) return new Response('Unknown cluster.', { status: 400 })

  const input: CoverInput = {
    title: (url.searchParams.get('title') ?? '').slice(0, 200) || 'Untitled post',
    cluster,
    city: url.searchParams.get('city'),
    subject: url.searchParams.get('subject'),
    audience: ((): CoverInput['audience'] => {
      const a = url.searchParams.get('audience')
      return a === 'parents' || a === 'tutors' ? a : 'both'
    })(),
    slug: url.searchParams.get('slug'),
  }
  const seed = num(url.searchParams.get('seed'), 0)

  return composeCoverResponse(input, seed)
}
