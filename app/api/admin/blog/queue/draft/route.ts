import { NextResponse } from 'next/server'

import { checkAdminRole, SCREEN_ACCESS } from '@/lib/adminAuth'
import { parseBody, z } from '@/lib/validate'
import { rateLimit, tooManyRequests } from '@/lib/rateLimit'
import { isConfigured } from '@/lib/ai/anthropic'
import { draftFromSuggestion } from '@/lib/blogQueueDraft'

// POST /api/admin/blog/queue/draft { id } — Content queue → "Draft this post"
// (owner, 28 Oct 2026). Owner and Managers (and Admin): SCREEN_ACCESS.blogQueueDraft.
// Claude writes the whole post in one request and it is saved as a DRAFT in
// Blog — never published. Rate-limited on the blog generation bucket; logged
// without content (lib/blogQueueDraft).

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
// Outline + sections in parallel + up to two self-check rounds.
export const maxDuration = 300

const Body = z.object({ id: z.string().min(1).max(64) })

export async function POST(request: Request) {
  const gate = await checkAdminRole(...SCREEN_ACCESS.blogQueueDraft)
  if (!gate.ok) return NextResponse.json({ error: gate.error }, { status: gate.status })
  const parsed = await parseBody(request, Body)
  if (!parsed.ok) return parsed.response
  if (!isConfigured()) return NextResponse.json({ error: 'Claude is not set up (ANTHROPIC_API_KEY is missing).' }, { status: 503 })
  const limit = await rateLimit('ai_blog', gate.actor.id)
  if (!limit.allowed) return tooManyRequests(limit.retryAfterSeconds, 'drafts')
  const res = await draftFromSuggestion(parsed.data.id, gate.actor)
  if (!res.ok) return NextResponse.json({ error: res.error }, { status: res.status })
  return NextResponse.json({ success: true, ...res })
}
