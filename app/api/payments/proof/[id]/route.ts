import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { getAdminActor, roleSatisfies, SCREEN_ACCESS } from '@/lib/adminAuth'

// Serve a manual-transfer receipt.
//
// The payment-proofs bucket is private and has no public policy, so this is
// the only way the bytes reach a browser. Two readers are allowed: the member
// who uploaded it, and an admin who may work the payments queue. A verifier or
// support admin gets 403 here for the same reason they get 403 on the screen
// -- a bank screenshot carries an account number and a name.
//
// Nothing about the path is taken from the request: it is read off the payment
// row identified by id, so a crafted path cannot walk the bucket.

export const runtime = 'nodejs'

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params

  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return new Response('Sign in required.', { status: 401 })

  const admin = createAdminClient()
  if (!admin) return new Response('Server not configured.', { status: 503 })

  const { data: payment } = await admin
    .from('payments')
    .select('id, user_id, screenshot_path')
    .eq('id', id)
    .maybeSingle()

  if (!payment?.screenshot_path) return new Response('Not found.', { status: 404 })

  if (payment.user_id !== user.id) {
    const actor = await getAdminActor()
    if (!actor || !roleSatisfies(actor.adminRole, SCREEN_ACCESS.payments)) {
      return new Response('Not allowed.', { status: 403 })
    }
  }

  const { data: file, error } = await admin.storage
    .from('payment-proofs')
    .download(payment.screenshot_path as string)

  if (error || !file) return new Response('Not found.', { status: 404 })

  return new Response(file.stream(), {
    headers: {
      'Content-Type': file.type || 'application/octet-stream',
      // Private, and never cached by a shared proxy.
      'Cache-Control': 'private, no-store',
      'Content-Disposition': 'inline',
    },
  })
}
