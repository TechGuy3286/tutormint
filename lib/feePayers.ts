// lib/feePayers.ts
//
// "Paid this month" and the "Recent payers" list (owner, 7 Oct 2026) — the I/O
// half. Reads the fee payments through the service role; the rules are in
// lib/feePayersCore.ts.

import 'server-only'

import { createAdminClient } from '@/lib/supabase/admin'
import { formatName } from '@/lib/formatName'
import { tutorDocStatusesFromProfile } from '@/lib/tutorDocStatus'
import { countFeePayers, countsAsFeePayment, docOverall, type DocOverall, type FeePaymentRow } from '@/lib/feePayersCore'

type PaymentRecord = {
  user_id: string | null
  status: string
  plan_code: string | null
  reviewed_at: string | null
  updated_at: string | null
  refunded_amount_pkr: number | null
  refunded_at: string | null
  provider_ref: string | null
}

async function feePayments(limit = 5000): Promise<(FeePaymentRow & { ref: string | null })[]> {
  const admin = createAdminClient()
  if (!admin) return []
  const { data } = await admin
    .from('payments')
    .select('user_id, status, plan_code, reviewed_at, updated_at, refunded_amount_pkr, refunded_at, provider_ref')
    .eq('plan_code', 'verified')
    .eq('status', 'approved')
    .not('user_id', 'is', null)
    .order('reviewed_at', { ascending: false, nullsFirst: false })
    .limit(limit)
  return ((data ?? []) as PaymentRecord[]).map((p) => ({
    userId: p.user_id,
    status: p.status,
    planCode: p.plan_code,
    approvedAt: p.reviewed_at ?? p.updated_at,
    refundedAmountPkr: p.refunded_amount_pkr,
    refundedAt: p.refunded_at,
    ref: p.provider_ref,
  }))
}

export async function feePayerCounts(now = Date.now()): Promise<{ month: number; week: number }> {
  return countFeePayers(await feePayments(), now)
}

export type RecentPayer = {
  userId: string
  name: string
  paidAt: string
  ref: string | null
  docs: DocOverall
}

/** Newest first, one row per tutor (their latest fee payment). */
export async function recentFeePayers(limit = 100): Promise<RecentPayer[]> {
  const admin = createAdminClient()
  if (!admin) return []
  const rows = (await feePayments()).filter(countsAsFeePayment)
  rows.sort((a, b) => (b.approvedAt ?? '').localeCompare(a.approvedAt ?? ''))
  const seen = new Set<string>()
  const latest = rows.filter((r) => {
    if (seen.has(r.userId as string)) return false
    seen.add(r.userId as string)
    return true
  }).slice(0, limit)
  const ids = latest.map((r) => r.userId as string)
  if (ids.length === 0) return []

  const [{ data: profiles }, { data: selfies }] = await Promise.all([
    admin
      .from('profiles')
      .select('id, full_name, cnic_verified_at, verification_state, verification_rejection_reason, cnic_number, cnic_image_path, profile_pic_status, profile_pic_reason, selfie_status, selfie_reason, avatar_url')
      .in('id', ids),
    admin.from('user_documents').select('user_id').eq('kind', 'selfie').in('user_id', ids),
  ])
  const hasSelfie = new Set((selfies ?? []).map((r) => r.user_id as string))
  const byId = new Map((profiles ?? []).map((p) => [p.id as string, p]))

  return latest.map((r) => {
    const p = byId.get(r.userId as string)
    return {
      userId: r.userId as string,
      name: formatName((p?.full_name as string | null) ?? null) || '—',
      paidAt: r.approvedAt as string,
      ref: r.ref,
      docs: p ? docOverall(tutorDocStatusesFromProfile(p, hasSelfie.has(r.userId as string))) : 'waiting',
    }
  })
}
