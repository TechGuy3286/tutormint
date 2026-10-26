import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { renderStatusImage } from '@/lib/social/statusImage'

// GET /api/tutor/social/status?k=<version key> — the signed-in tutor's own
// "I'm a Verified Tutor" WhatsApp status image (owner, 26 Oct 2026). Only a
// tutor who passes the verified rule gets one (403 otherwise). Drawn live; kept
// in the browser only while k is the live version key.

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET(request: Request) {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return new Response('Sign in.', { status: 401 })
  const admin = createAdminClient()
  if (!admin) return new Response('Server not configured.', { status: 503 })
  const res = await renderStatusImage(admin, user.id, new URL(request.url).searchParams.get('k'))
  if (!res.ok) return new Response(res.error, { status: res.status })
  return res.response
}
