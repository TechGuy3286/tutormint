import { createAdminClient } from '@/lib/supabase/admin'

// The tutor's own unpaid, unexpired PayPro invoice, for the dashboard
// "Complete your payment" prompt (PR106-G4a §5). It MIRRORS the reuse rule in
// startPayproCheckout (lib/payments/paypro.ts): a pending PayPro order younger
// than 24h that still carries a Click2Pay link is one the member can still pay —
// anything older or linkless is stale and is replaced on the next checkout, so
// it is not surfaced here. Returns null when there is nothing to resume.
//
// READ-ONLY. Writes nothing (it does not block or recreate orders — that is
// startPayproCheckout's job). Uses the service-role client, scoped to the one
// user id, exactly as the checkout read does.

const DAY_MS = 24 * 60 * 60 * 1000

export type PendingInvoice = { url: string; reference: string; planCode: string }

export async function pendingPayproInvoice(userId: string): Promise<PendingInvoice | null> {
  const admin = createAdminClient()
  if (!admin) return null
  const { data } = await admin
    .from('payments')
    .select('provider_ref, created_at, raw, plan_code')
    .eq('user_id', userId)
    .eq('provider', 'paypro')
    .eq('status', 'pending')
    .order('created_at', { ascending: false })
    .limit(10)
  for (const p of data ?? []) {
    const ageMs = Date.now() - new Date(p.created_at as string).getTime()
    const click2pay = (p.raw as { paypro?: { click2pay?: string } } | null)?.paypro?.click2pay ?? ''
    if (ageMs < DAY_MS && click2pay) {
      return { url: click2pay, reference: p.provider_ref as string, planCode: p.plan_code as string }
    }
  }
  return null
}
