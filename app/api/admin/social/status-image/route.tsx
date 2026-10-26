import { getAdminActor, roleSatisfies, SCREEN_ACCESS } from '@/lib/adminAuth'
import { createAdminClient } from '@/lib/supabase/admin'
import { renderStatusImage } from '@/lib/social/statusImage'

// GET /api/admin/social/status-image?memberId=&k= — the tutor's "I'm a Verified
// Tutor" WhatsApp status image for staff to send (owner, 26 Oct 2026). Same
// image as the tutor's own; only for a verified tutor (403 otherwise).
// Not checkAdminRole: an image, so a plain status beats an HTML error page.

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export async function GET(request: Request) {
  const actor = await getAdminActor()
  if (!actor) return new Response('Sign in.', { status: 401 })
  if (!roleSatisfies(actor.adminRole, SCREEN_ACCESS.statusImage)) return new Response('Not allowed.', { status: 403 })
  const url = new URL(request.url)
  const memberId = url.searchParams.get('memberId') ?? ''
  if (!UUID.test(memberId)) return new Response('Unknown member.', { status: 400 })
  const admin = createAdminClient()
  if (!admin) return new Response('Server not configured.', { status: 503 })
  const res = await renderStatusImage(admin, memberId, url.searchParams.get('k'))
  if (!res.ok) return new Response(res.error, { status: res.status })
  return res.response
}
