import { NextResponse } from 'next/server'
import { randomUUID } from 'node:crypto'

import { checkAdminRole, SCREEN_ACCESS } from '@/lib/adminAuth'
import { createAdminClient } from '@/lib/supabase/admin'
import { clusterLabel, isClusterSlug, publicBlogUrl } from '@/lib/blog'
import { parseBody, z } from '@/lib/validate'

import { renderCover } from '../cover-image/render'

// Generate a cover from the post's title + cluster, at BOTH sizes, and store
// them in the public `blog` bucket. cover_path holds the 1200x630 (post + OG);
// cover_square_path holds the 1080x1080 social variant. The manager may still
// replace either with an upload (../cover), which sets cover_path only.
//
// Alt text is DERIVED here so a generated cover is never missing it -- the
// publish gate requires alt whenever a cover is set, and a generated picture of
// the title can describe itself. An uploaded cover still needs alt by hand,
// because we cannot know what the manager's photo shows.

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const Body = z.object({
  title: z.string().trim().min(1, 'Give the post a title first.').max(200),
  cluster: z.string().refine(isClusterSlug, 'Choose a topic cluster.'),
})

async function pngBytes(res: Response): Promise<Uint8Array> {
  return new Uint8Array(await res.arrayBuffer())
}

export async function POST(request: Request) {
  const gate = await checkAdminRole(...SCREEN_ACCESS.blog)
  if (!gate.ok) return NextResponse.json({ error: gate.error }, { status: gate.status })

  const admin = createAdminClient()
  if (!admin) return NextResponse.json({ error: 'Server is not configured.' }, { status: 503 })

  const parsed = await parseBody(request, Body)
  if (!parsed.ok) return parsed.response
  const { title, cluster } = parsed.data
  const label = clusterLabel(cluster)

  const stamp = randomUUID()
  const widePath = `covers/gen-${stamp}-wide.png`
  const squarePath = `covers/gen-${stamp}-square.png`

  try {
    const wide = await pngBytes(renderCover({ title, clusterLabel: label, size: 'wide' }))
    const square = await pngBytes(renderCover({ title, clusterLabel: label, size: 'square' }))

    const up1 = await admin.storage.from('blog').upload(widePath, wide, { contentType: 'image/png', upsert: false })
    if (up1.error) return NextResponse.json({ error: up1.error.message }, { status: 400 })
    const up2 = await admin.storage.from('blog').upload(squarePath, square, { contentType: 'image/png', upsert: false })
    if (up2.error) return NextResponse.json({ error: up2.error.message }, { status: 400 })
  } catch (e) {
    console.error('[blog cover] render/upload failed:', String(e))
    return NextResponse.json({ error: 'Could not render the cover.' }, { status: 500 })
  }

  const coverAlt = `${title} — TutorMint ${label} guide`

  return NextResponse.json({
    success: true,
    coverPath: widePath,
    coverSquarePath: squarePath,
    coverAlt,
    coverUrl: publicBlogUrl(widePath),
    coverSquareUrl: publicBlogUrl(squarePath),
  })
}
