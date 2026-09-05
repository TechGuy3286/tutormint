import { NextResponse } from 'next/server'
import { randomUUID } from 'node:crypto'

import { checkAdminRole, SCREEN_ACCESS } from '@/lib/adminAuth'
import { createAdminClient } from '@/lib/supabase/admin'
import { isClusterSlug, publicBlogUrl } from '@/lib/blog'
import { parseBody, z } from '@/lib/validate'
import { composeCoverResponse, composeCoverAlt } from '@/lib/covers/render'
import type { CoverInput } from '@/lib/covers/select'

// Commit ONE chosen composed cover variant (the seed the manager picked among
// the three previews) to the public `blog` bucket, at 1200x630. A composed
// cover is a single wide image — there is no square social variant — so
// cover_square_path is cleared, exactly as an uploaded cover does.
//
// Alt text is DERIVED here from the same selection the picture was composed
// from ("Illustration: the Lahore skyline, a parent and child, an atom and a
// wallet."), so a generated cover is never missing the alt the publish gate
// requires. The manager can still edit it.

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const Body = z.object({
  title: z.string().trim().min(1, 'Give the post a title first.').max(200),
  cluster: z.string().refine(isClusterSlug, 'Choose a topic cluster.'),
  city: z.string().max(80).nullable().optional(),
  subject: z.string().max(120).nullable().optional(),
  audience: z.enum(['parents', 'tutors', 'both']).optional(),
  slug: z.string().max(200).nullable().optional(),
  seed: z.number().int().min(0).max(999).optional(),
})

export async function POST(request: Request) {
  const gate = await checkAdminRole(...SCREEN_ACCESS.blog)
  if (!gate.ok) return NextResponse.json({ error: gate.error }, { status: gate.status })

  const admin = createAdminClient()
  if (!admin) return NextResponse.json({ error: 'Server is not configured.' }, { status: 503 })

  const parsed = await parseBody(request, Body)
  if (!parsed.ok) return parsed.response
  const d = parsed.data

  const input: CoverInput = {
    title: d.title,
    cluster: d.cluster,
    city: d.city ?? null,
    subject: d.subject ?? null,
    audience: d.audience ?? 'both',
    slug: d.slug ?? null,
  }
  const seed = d.seed ?? 0

  const coverPath = `covers/gen-${randomUUID()}.png`

  try {
    const res = await composeCoverResponse(input, seed)
    const bytes = new Uint8Array(await res.arrayBuffer())
    const up = await admin.storage.from('blog').upload(coverPath, bytes, { contentType: 'image/png', upsert: false })
    if (up.error) return NextResponse.json({ error: up.error.message }, { status: 400 })
  } catch (e) {
    console.error('[blog cover] compose/upload failed:', String(e))
    return NextResponse.json({ error: 'Could not render the cover.' }, { status: 500 })
  }

  return NextResponse.json({
    success: true,
    coverPath,
    coverSquarePath: null,
    coverAlt: composeCoverAlt(input, seed),
    coverUrl: publicBlogUrl(coverPath),
  })
}
