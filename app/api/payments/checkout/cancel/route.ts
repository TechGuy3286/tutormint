import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { logActivity } from '@/lib/activityLog'
import { cancelCheckout } from '@/lib/paymentBanner'

// POST /api/payments/checkout/cancel { paymentId } — the member cancels a
// checkout they started (owner, 17 Oct 2026). The payment is MARKED closed
// (checkout_closed_at, reason cancelled_by_member); nothing is deleted and its
// status is unchanged. Only the member's own pending checkout with no receipt
// and no refund can be cancelled (lib/paymentBanner cancelCheckout).

export async function POST(request: Request) {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Please sign in first, then try again.' }, { status: 401 })

  const body = (await request.json().catch(() => null)) as { paymentId?: unknown } | null
  const paymentId = typeof body?.paymentId === 'string' ? body.paymentId.trim() : ''
  if (!/^[0-9a-f-]{36}$/i.test(paymentId)) {
    return NextResponse.json({ error: 'Something in that request was missing. Reload the page and try again.' }, { status: 400 })
  }

  const res = await cancelCheckout(user.id, paymentId)
  if (!res.ok) return NextResponse.json({ error: res.error }, { status: res.status })

  await logActivity({ userId: user.id, event: 'checkout_cancelled', targetType: 'payment', targetId: paymentId })
  return NextResponse.json({ success: true })
}
