import { notFound, redirect } from 'next/navigation'

import { getSessionUser } from '@/lib/auth'
import { createClient } from '@/lib/supabase/server'

// The old bank-transfer order page. Its job moved to the payment choice screen
// (owner, 11 Oct 2026 — /pay/choose), which shows the bank details, takes the
// receipt and shows "Payment under review". A link to an old order (an email, a
// notification, a bookmark) lands on that screen for the same package; an order
// that is not this member's is a 404, as before.

export const dynamic = 'force-dynamic'

export default async function ManualPayPage({ params }: { params: Promise<{ ref: string }> }) {
  const { ref } = await params
  const session = await getSessionUser()
  if (!session) redirect('/login')

  const supabase = await createClient()
  const { data: payment } = await supabase
    .from('payments')
    .select('plan_code')
    .eq('provider_ref', ref)
    .eq('user_id', session.user.id)
    .maybeSingle()
  if (!payment?.plan_code) notFound()

  redirect(`/pay/choose?plan=${encodeURIComponent(payment.plan_code as string)}`)
}
