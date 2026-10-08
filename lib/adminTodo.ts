// lib/adminTodo.ts
//
// Admin Overview (owner, 8 Oct 2026): "Today's to-do" and "Signup to payment".
//
// TODAY'S TO-DO — one row per job with a count and a one-tap link, hidden at 0.
// Each row carries the SCREEN_ACCESS key of the screen it opens, and the page
// shows only rows the viewer's role can open. Every count is the same query the
// screen it links to uses, so the number and the list never disagree.
//
// SIGNUP TO PAYMENT — tutors who signed up in the last 7 or 30 days (paused and
// test accounts left out), and how many of them verified their mobile, finished
// onboarding and paid the Spam Free Platform Fee, with the % lost per step.

import 'server-only'

import { createAdminClient } from '@/lib/supabase/admin'
import { approvalNeededCount } from '@/lib/approvalQueue'
import { loadUnpaidSignups, loadFeaturedWhatsapp } from '@/lib/staffOutreach'
import { isTestName, stuckBreakdown, funnelSteps, type FunnelStep } from '@/lib/staffOutreachCore'
import { PAUSE_AFTER_DAYS } from '@/lib/tuitionStatus'
import { settleByDate } from '@/lib/settlementCore'
import type { PayproRow } from '@/lib/reconciliationCore'
import type { AdminScreen } from '@/lib/adminNav'

export type { FunnelStep }

export type TodoRow = { key: string; label: string; count: number; detail?: string; href: string; screen: AdminScreen }

const num = (v: unknown): number | null => (v === null || v === undefined || v === '' ? null : Number(v))

export async function loadTodo(now = new Date()): Promise<TodoRow[]> {
  const admin = createAdminClient()
  if (!admin) return []
  const hourAgo = new Date(now.getTime() - 60 * 60 * 1000).toISOString()
  // A tuition pauses 15 days after coalesce(resumed_at, created_at); "in the
  // next 2 days" = that base falls between 15 and 13 days ago.
  const pauseFrom = new Date(now.getTime() - PAUSE_AFTER_DAYS * 86_400_000).toISOString()
  const pauseTo = new Date(now.getTime() - (PAUSE_AFTER_DAYS - 2) * 86_400_000).toISOString()

  const [docs, unpaid, payments, reports, flags, openJobs, featured, latestImport] = await Promise.all([
    approvalNeededCount(),
    loadUnpaidSignups(now),
    admin.from('payments').select('id', { count: 'exact', head: true }).eq('status', 'pending').lt('created_at', hourAgo),
    admin.from('reports').select('id', { count: 'exact', head: true }).eq('status', 'open'),
    admin.from('abuse_flags').select('id', { count: 'exact', head: true }).eq('status', 'open'),
    admin.from('jobs').select('id, created_at, resumed_at').eq('status', 'open').lte('created_at', pauseTo).limit(5000),
    loadFeaturedWhatsapp(now),
    admin.from('reconciliation_imports').select('id').eq('gateway', 'paypro').order('created_at', { ascending: false }).limit(1),
  ])

  const pausing = (openJobs.data ?? []).filter((j) => {
    const base = (j.resumed_at as string | null) ?? (j.created_at as string)
    return base > pauseFrom && base <= pauseTo
  }).length

  let duePaypro = 0
  const imp = (latestImport.data ?? [])[0] as { id: string } | undefined
  if (imp) {
    const { data } = await admin
      .from('reconciliation_rows')
      .select('order_number, transaction_status, payment_via, order_amount, merchant_share, date_paid, settle_date, settle_status')
      .eq('import_id', imp.id)
      .limit(20000)
    const rows: PayproRow[] = ((data ?? []) as Record<string, unknown>[]).map((r) => ({
      orderNumber: String(r.order_number ?? ''),
      transactionStatus: (r.transaction_status as string | null) ?? null,
      paymentVia: (r.payment_via as string | null) ?? null,
      orderAmount: num(r.order_amount),
      merchantShare: num(r.merchant_share),
      datePaid: (r.date_paid as string | null) ?? null,
      settleDate: (r.settle_date as string | null) ?? null,
      settleStatus: (r.settle_status as string | null) ?? null,
    }))
    // Only meaningful once the file carries settle dates at all.
    if (rows.some((r) => r.settleDate)) duePaypro = settleByDate(rows, [], now.toISOString()).due.length
  }

  const stuck = stuckBreakdown(unpaid.map((r) => r.stoppedAt))
  const uncontacted = unpaid.filter((r) => !r.lastContact).length
  const featuredCount = featured.rows.filter((r) => r.matches.length > 0).length
  const flagged = (reports.count ?? 0) + (flags.count ?? 0)

  const rows: TodoRow[] = [
    { key: 'docs', label: 'Documents to approve', count: docs, href: '/admin/users?filter=approval', screen: 'tutors' },
    { key: 'uncontacted', label: 'Unpaid signups not yet contacted', count: uncontacted, href: '/admin/users/unpaid-signups?filter=uncontacted', screen: 'unpaidSignups' },
    { key: 'stuck', label: 'Stuck in onboarding', count: stuck.total, detail: stuck.detail, href: '/admin/users/unpaid-signups?filter=onboarding', screen: 'unpaidSignups' },
    { key: 'payments', label: 'Payments waiting over 1 hour', count: payments.count ?? 0, href: '/admin/payments?filter=pending', screen: 'payments' },
    { key: 'due', label: 'Due from PayPro', count: duePaypro, href: '/admin/payments/settings/gateways', screen: 'paymentGateways' },
    {
      key: 'flagged',
      label: 'Flagged messages and reports',
      count: flagged,
      detail: `${flags.count ?? 0} flagged · ${reports.count ?? 0} reports`,
      href: (flags.count ?? 0) > 0 ? '/admin/flags' : '/admin/reports',
      screen: 'reports',
    },
    { key: 'pausing', label: 'Tuitions auto-pausing in the next 2 days', count: pausing, href: '/admin/jobs?status=open', screen: 'jobs' },
    { key: 'featured', label: 'Featured tutors with new matches', count: featuredCount, href: '/admin/users/featured-whatsapp', screen: 'featuredWhatsapp' },
  ]
  return rows.filter((r) => r.count > 0)
}

// ------------------------------------------------------- signup to payment

export async function loadFunnel(days: 7 | 30, now = new Date()): Promise<FunnelStep[]> {
  const admin = createAdminClient()
  const labels = ['Signed up', 'Mobile verified', 'Onboarding done', 'Paid']
  if (!admin) return funnelSteps([0, 0, 0, 0], labels)
  const since = new Date(now.getTime() - days * 86_400_000).toISOString()
  const { data: profs } = await admin
    .from('profiles')
    .select('id, full_name, phone_verified_at, is_suspended, is_banned, is_seed, is_team_account')
    .eq('role', 'tutor')
    .gte('created_at', since)
    .limit(5000)
  const real = (profs ?? []).filter(
    (p) => !p.is_suspended && !p.is_banned && !p.is_seed && !p.is_team_account && !isTestName(p.full_name as string | null),
  )
  const ids = real.map((p) => p.id as string)
  const { data: tps } = ids.length
    ? await admin.from('tutor_profiles').select('id, onboarded_at, verified_fee_paid_at').in('id', ids)
    : { data: [] as { id: string; onboarded_at: string | null; verified_fee_paid_at: string | null }[] }
  const tp = new Map((tps ?? []).map((t) => [t.id as string, t]))
  const mobile = real.filter((p) => !!p.phone_verified_at)
  const onboarded = mobile.filter((p) => !!tp.get(p.id as string)?.onboarded_at)
  const paid = onboarded.filter((p) => !!tp.get(p.id as string)?.verified_fee_paid_at)
  return funnelSteps([real.length, mobile.length, onboarded.length, paid.length], labels)
}
