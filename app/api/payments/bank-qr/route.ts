import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { manualInstructions } from '@/lib/payments/manual'

// Serve the bank-transfer QR image (PR98 §4).
//
// The QR lives in the private payment-proofs bucket; this is the only way its
// bytes reach a browser. Any signed-in member may fetch it — bank transfer is
// the one way to pay (PR-12 removed the old PAYPRO_TEST_EMAILS gate). The
// storage path is read from the setting, never from the request, so a crafted
// path cannot walk the bucket.

export const runtime = 'nodejs'

export async function GET() {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return new Response('Sign in required.', { status: 401 })

  const { data: profile } = await supabase.from('profiles').select('id').eq('id', user.id).maybeSingle()
  if (!profile) return new Response('Please complete your profile first.', { status: 403 })

  const instructions = await manualInstructions()
  if (!instructions.qrPath) return new Response('The bank QR code is not available right now. Use the account details on the payment page instead.', { status: 404 })

  const admin = createAdminClient()
  if (!admin) return new Response('Server not configured.', { status: 503 })

  const { data: file, error } = await admin.storage.from('payment-proofs').download(instructions.qrPath)
  if (error || !file) return new Response('The bank QR code is not available right now. Use the account details on the payment page instead.', { status: 404 })

  return new Response(file.stream(), {
    headers: {
      'Content-Type': file.type || 'image/png',
      'Cache-Control': 'private, no-store',
      'Content-Disposition': 'inline',
    },
  })
}
