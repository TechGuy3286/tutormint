import 'server-only'

import { createAdminClient } from '@/lib/supabase/admin'
import type { FinanceAlertKind } from '@/lib/financeAlertsCore'

// Finance → Needs attention items that are not a credit, an order or a receipt
// (migration 200): a late PayPro callback after the cut-off, a bank email that
// could not be read or verified, a mailbox that is not bank-only, an unclear
// email match, the email reader failing. Written only through the service role;
// each (kind, ref) is recorded once. NEVER a message body, account number,
// email address or phone number — callers pass plain words only.

export type FinanceAlert = {
  id: string
  createdAt: string
  kind: FinanceAlertKind
  ref: string
  title: string
  detail: string | null
  amountPkr: number | null
  happenedAt: string | null
}

export async function recordFinanceAlert(a: {
  kind: FinanceAlertKind
  ref: string
  title: string
  detail?: string | null
  amountPkr?: number | null
  happenedAt?: string | null
}): Promise<void> {
  const admin = createAdminClient()
  if (!admin) return
  await admin.from('finance_alerts').upsert(
    {
      kind: a.kind,
      ref: a.ref.slice(0, 300),
      title: a.title.slice(0, 200),
      detail: a.detail ? a.detail.slice(0, 500) : null,
      amount_pkr: a.amountPkr ?? null,
      happened_at: a.happenedAt ?? null,
    },
    { onConflict: 'kind,ref', ignoreDuplicates: true },
  )
}

/** Open (unresolved) alerts, newest first. */
export async function loadOpenFinanceAlerts(limit = 200): Promise<FinanceAlert[]> {
  const admin = createAdminClient()
  if (!admin) return []
  const { data } = await admin
    .from('finance_alerts')
    .select('id, created_at, kind, ref, title, detail, amount_pkr, happened_at')
    .is('resolved_at', null)
    .order('created_at', { ascending: false })
    .limit(limit)
  return (data ?? []).map((r) => ({
    id: r.id as string,
    createdAt: r.created_at as string,
    kind: r.kind as FinanceAlertKind,
    ref: r.ref as string,
    title: r.title as string,
    detail: (r.detail as string | null) ?? null,
    amountPkr: r.amount_pkr == null ? null : Number(r.amount_pkr),
    happenedAt: (r.happened_at as string | null) ?? null,
  }))
}

/** Mark one alert dealt with (the Owner's "Done"). Never deleted. */
export async function resolveFinanceAlert(id: string, by: string): Promise<boolean> {
  const admin = createAdminClient()
  if (!admin) return false
  const { data } = await admin
    .from('finance_alerts')
    .update({ resolved_at: new Date().toISOString(), resolved_by: by })
    .eq('id', id)
    .is('resolved_at', null)
    .select('id')
  return (data ?? []).length > 0
}

/** Resolve every open alert of a kind + ref (e.g. the reader recovered). */
export async function resolveFinanceAlertsByRef(kind: FinanceAlertKind, ref: string): Promise<void> {
  const admin = createAdminClient()
  if (!admin) return
  await admin.from('finance_alerts').update({ resolved_at: new Date().toISOString() }).eq('kind', kind).eq('ref', ref).is('resolved_at', null)
}
