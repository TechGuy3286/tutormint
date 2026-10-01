import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { checkoutVisibleFor } from '@/lib/payments/paypro'
import { manualInstructions } from '@/lib/payments/manual'

// Serve the bank-transfer QR image (PR98 §4).
//
// The QR lives in the private payment-proofs bucket; this is the only way its
// bytes reach a browser. Shown only to accounts inside the checkout gate (the
// same set that sees the bank transfer option), so it is not an open asset. The
// storage path is read from the setting, never from the request, so a crafted
// path cannot walk the bucket.

export const runtime = 'nodejs'

export async function GET() {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return new Response('Sign in required.', { status: 401 })

  const { data: profile } = await supabase
    .from('profiles')
    .select('admin_role, is_seed, email')
    .eq('id', user.id)
    .maybeSingle()
  if (!profile || !checkoutVisibleFor(profile)) return new Response('Not allowed.', { status: 403 })

  const instructions = await manualInstructions()
  if (!instructions.qrPath) return new Response('Not found.', { status: 404 })

  const admin = createAdminClient()
  if (!admin) return new Response('Server not configured.', { status: 503 })

  const { data: file, error } = await admin.storage.from('payment-proofs').download(instructions.qrPath)
  if (error || !file) return new Response('Not found.', { status: 404 })

  return new Response(file.stream(), {
    headers: {
      'Content-Type': file.type || 'image/png',
      'Cache-Control': 'private, no-store',
      'Content-Disposition': 'inline',
    },
  })
}
