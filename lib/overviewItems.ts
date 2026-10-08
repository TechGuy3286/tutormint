// lib/overviewItems.ts
//
// Admin → Overview, counts that match their lists (owner, 8 Oct 2026, item 5)
// — the I/O half. ONE loader per item returns the item's rows; the Overview
// shows that list's length (revenue: its sum) and /admin/overview/<key> shows
// the same rows. The rules and titles live in lib/overviewItemsCore.ts.
//
// Every caller checks the item's SCREEN_ACCESS key first (OVERVIEW_ITEMS[key]
// .screen) — the same key the Overview filters its cards and rows by.

import 'server-only'

import { cache } from 'react'
import type { SupabaseClient } from '@supabase/supabase-js'

import { createAdminClient } from '@/lib/supabase/admin'
import { approvalNeeded } from '@/lib/approvalQueue'
import { loadUnpaidSignups, loadFeaturedWhatsapp } from '@/lib/staffOutreach'
import { isTestName, PAYMENT_STEP_LABEL, stuckBreakdown } from '@/lib/staffOutreachCore'
import { PAUSE_AFTER_DAYS } from '@/lib/tuitionStatus'
import { settleByDate } from '@/lib/settlementCore'
import type { PayproRow } from '@/lib/reconciliationCore'
import { loadFinancePayments } from '@/lib/finance'
import { countedInMonth, monthRangeLabel, pkMonth } from '@/lib/financeCore'
import { countsAsFeePayment, pkMonthStartMs } from '@/lib/feePayersCore'
import { formatName } from '@/lib/formatName'
import { formatDate, formatDateTime } from '@/lib/datetime'
import { FEE_LABEL } from '@/lib/display'
import {
  OVERVIEW_ITEMS,
  funnelSets,
  isWaitingPayment,
  nounFor,
  type FunnelTutor,
  type OverviewItemKey,
} from '@/lib/overviewItemsCore'

export type OverviewRow = {
  id: string
  title: string
  detail?: string | null
  href?: string | null
  /** Rupees, only on the revenue list (owner + Partner). */
  amount?: number
}

export type OverviewList = {
  key: OverviewItemKey
  rows: OverviewRow[]
  /** What the filter is, in words, for the header: "paid this month (1–31 Oct 2026)". */
  filter: string
  /** Revenue only: the sum the card shows. */
  amount?: number
  /** A one-line extra for the card / row (e.g. "2 in the last 7 days"). */
  extra?: string | null
  /** The screen where staff act on these rows. */
  workHref?: string | null
}

const PK_DATE = (iso: string) => formatDate(iso)

/** Read every row past PostgREST's 1,000-row cap. */
async function pageAll<T>(fetchPage: (from: number, to: number) => PromiseLike<{ data: T[] | null }>): Promise<T[]> {
  const out: T[] = []
  for (let from = 0; from < 100_000; from += 1000) {
    const { data } = await fetchPage(from, from + 999)
    const rows = data ?? []
    out.push(...rows)
    if (rows.length < 1000) break
  }
  return out
}

const unpaid = cache(async () => loadUnpaidSignups(new Date()))
const featured = cache(async () => loadFeaturedWhatsapp(new Date()))

// ---------------------------------------------------------------- funnel
type CohortTutor = FunnelTutor & { name: string; createdAt: string }

const funnelCohort = cache(async (days: 7 | 30): Promise<CohortTutor[]> => {
  const admin = createAdminClient()
  if (!admin) return []
  const since = new Date(Date.now() - days * 86_400_000).toISOString()
  const profs = await pageAll((a, b) =>
    admin
      .from('profiles')
      .select('id, full_name, created_at, phone_verified_at, is_suspended, is_banned, is_seed, is_team_account, admin_role')
      .eq('role', 'tutor')
      .gte('created_at', since)
      .order('created_at', { ascending: false })
      .range(a, b),
  )
  const real = profs.filter(
    (p) => !p.is_suspended && !p.is_banned && !p.is_seed && !p.is_team_account && !p.admin_role && !isTestName(p.full_name as string | null),
  )
  const ids = real.map((p) => p.id as string)
  const tps: { id: string; onboarded_at: string | null; verified_fee_paid_at: string | null }[] = []
  for (let i = 0; i < ids.length; i += 200) {
    const { data } = await admin.from('tutor_profiles').select('id, onboarded_at, verified_fee_paid_at').in('id', ids.slice(i, i + 200))
    tps.push(...((data ?? []) as typeof tps))
  }
  const tp = new Map(tps.map((t) => [t.id, t]))
  return real.map((p) => ({
    id: p.id as string,
    name: formatName(p.full_name as string | null) || '—',
    createdAt: p.created_at as string,
    mobileVerified: !!p.phone_verified_at,
    onboarded: !!tp.get(p.id as string)?.onboarded_at,
    paid: !!tp.get(p.id as string)?.verified_fee_paid_at,
  }))
})

function tutorRows(list: CohortTutor[]): OverviewRow[] {
  return list.map((t) => ({ id: t.id, title: t.name, detail: `Joined ${PK_DATE(t.createdAt)}`, href: `/admin/users/${t.id}` }))
}

async function profilesByRole(admin: SupabaseClient, roles: string[]): Promise<OverviewRow[]> {
  const rows = await pageAll((a, b) =>
    admin.from('profiles').select('id, full_name, created_at').in('role', roles).order('created_at', { ascending: false }).range(a, b),
  )
  return rows.map((p) => ({
    id: p.id as string,
    title: formatName(p.full_name as string | null) || '—',
    detail: `Joined ${PK_DATE(p.created_at as string)}`,
    href: `/admin/users/${p.id}`,
  }))
}

// ---------------------------------------------------------------- loaders
export async function loadOverviewList(key: OverviewItemKey, opts: { days?: 7 | 30; now?: Date } = {}): Promise<OverviewList> {
  const now = opts.now ?? new Date()
  const days = opts.days ?? 7
  const admin = createAdminClient()
  const empty = (filter: string): OverviewList => ({ key, rows: [], filter })
  if (!admin) return empty('')

  switch (key) {
    case 'revenue': {
      const month = pkMonth(now.toISOString())
      const rows = countedInMonth(await loadFinancePayments(), month).sort((a, b) => b.approvedAt.localeCompare(a.approvedAt))
      const amount = Math.round(rows.reduce((s, p) => s + p.amountPkr, 0) * 100) / 100
      return {
        key,
        rows: rows.map((p) => ({
          id: p.id,
          title: p.ref ?? p.id,
          detail: `${formatDateTime(p.approvedAt)} · ${p.planCode === 'verified' ? FEE_LABEL : (p.planCode ?? 'plan')} · ${p.method}`,
          amount: p.amountPkr,
        })),
        amount,
        filter: `approved this month (${monthRangeLabel(month)}), not refunded, account not deleted`,
        workHref: '/admin/finance',
      }
    }

    case 'paid-this-month': {
      const nowMs = now.getTime()
      const monthStart = pkMonthStartMs(nowMs)
      const weekStart = nowMs - 7 * 86_400_000
      const { data } = await admin
        .from('payments')
        .select('user_id, status, plan_code, reviewed_at, updated_at, refunded_amount_pkr, refunded_at, provider_ref')
        .eq('plan_code', 'verified')
        .eq('status', 'approved')
        .not('user_id', 'is', null)
        .order('reviewed_at', { ascending: false, nullsFirst: false })
        .limit(20000)
      const latest = new Map<string, { at: string; ref: string | null }>()
      for (const p of data ?? []) {
        const row = {
          userId: p.user_id as string | null,
          status: p.status as string,
          planCode: p.plan_code as string | null,
          approvedAt: (p.reviewed_at as string | null) ?? (p.updated_at as string | null),
          refundedAmountPkr: p.refunded_amount_pkr as number | null,
          refundedAt: p.refunded_at as string | null,
        }
        if (!countsAsFeePayment(row)) continue
        const t = Date.parse(row.approvedAt as string)
        if (t < monthStart || t > nowMs) continue
        const cur = latest.get(row.userId as string)
        if (!cur || cur.at < (row.approvedAt as string)) latest.set(row.userId as string, { at: row.approvedAt as string, ref: (p.provider_ref as string | null) ?? null })
      }
      const ids = [...latest.keys()]
      const { data: profs } = ids.length ? await admin.from('profiles').select('id, full_name').in('id', ids) : { data: [] }
      const names = new Map((profs ?? []).map((p) => [p.id as string, formatName(p.full_name as string | null) || '—']))
      const rows = [...latest.entries()]
        .sort((a, b) => b[1].at.localeCompare(a[1].at))
        .map(([id, v]) => ({ id, title: names.get(id) ?? '—', detail: `Paid ${formatDateTime(v.at)}${v.ref ? ` · ${v.ref}` : ''}`, href: `/admin/users/${id}` }))
      const week = [...latest.values()].filter((v) => Date.parse(v.at) >= weekStart).length
      return {
        key,
        rows,
        filter: `paid the ${FEE_LABEL} this month (${monthRangeLabel(pkMonth(now.toISOString()))})`,
        extra: `${week} in the last 7 days`,
        workHref: '/admin/payments/payers',
      }
    }

    case 'tutors':
      return { key, rows: await profilesByRole(admin, ['tutor']), filter: 'registered as tutors', workHref: '/admin/users?role=tutor' }

    case 'parents':
      return {
        key,
        rows: await profilesByRole(admin, ['parent', 'academy']),
        filter: 'registered as parents or institutions',
        workHref: '/admin/users?role=parent',
      }

    case 'open-tuitions': {
      const jobs = await pageAll((a, b) =>
        admin.from('jobs').select('id, ref_id, title, city, created_at').eq('status', 'open').order('created_at', { ascending: false }).range(a, b),
      )
      return {
        key,
        rows: jobs.map((j) => ({
          id: j.id as string,
          title: `${(j.ref_id as string | null) ?? ''} ${(j.title as string | null) ?? ''}`.trim() || 'Tuition',
          detail: `${(j.city as string | null) ?? '—'} · posted ${PK_DATE(j.created_at as string)}`,
          href: `/admin/jobs/${j.id}`,
        })),
        filter: 'open on the board now',
        workHref: '/admin/jobs?status=open',
      }
    }

    case 'todo-docs': {
      const rows = await approvalNeeded()
      return {
        key,
        rows: rows.map((r) => ({
          id: r.id,
          title: r.name,
          detail: `Waiting: ${r.waiting.join(', ')}${r.paid ? ' · fee paid' : ''}`,
          href: `/admin/tutors/${r.id}`,
        })),
        filter: 'with a document waiting for a decision',
        workHref: '/admin/users?filter=approval',
      }
    }

    case 'todo-uncontacted': {
      const rows = (await unpaid()).filter((r) => !r.lastContact)
      return {
        key,
        rows: rows.map((r) => ({ id: r.id, title: r.name, detail: `Joined ${PK_DATE(r.joinedAt)} · stopped at ${r.stoppedAt ?? 'payment'}`, href: `/admin/users/${r.id}` })),
        filter: 'who joined in the last 30 days, have not paid, and nobody has contacted yet',
        workHref: '/admin/users/unpaid-signups?filter=uncontacted',
      }
    }

    case 'todo-stuck': {
      const all = await unpaid()
      const rows = all.filter((r) => r.stoppedAt && r.stoppedAt !== PAYMENT_STEP_LABEL)
      return {
        key,
        rows: rows.map((r) => ({ id: r.id, title: r.name, detail: `Stopped at ${r.stoppedAt} · joined ${PK_DATE(r.joinedAt)}`, href: `/admin/users/${r.id}` })),
        filter: 'who joined in the last 30 days and stopped before the payment step',
        extra: stuckBreakdown(all.map((r) => r.stoppedAt)).detail,
        workHref: '/admin/users/unpaid-signups?filter=onboarding',
      }
    }

    case 'todo-payments': {
      const since = new Date(now.getTime() - 24 * 60 * 60 * 1000).toISOString()
      const { data } = await admin
        .from('payments')
        .select('id, provider_ref, plan_code, provider, status, created_at')
        .eq('status', 'pending')
        .gte('created_at', since)
        .order('created_at', { ascending: false })
        .limit(5000)
      const rows = (data ?? []).filter((p) => isWaitingPayment({ status: p.status as string, createdAt: p.created_at as string }, now.getTime()))
      return {
        key,
        // No amounts: staff see the status, never rupees (item 3).
        rows: rows.map((p) => ({
          id: p.id as string,
          title: (p.provider_ref as string | null) ?? (p.id as string),
          detail: `Started ${formatDateTime(p.created_at as string)} · ${p.plan_code === 'verified' ? FEE_LABEL : (p.plan_code ?? 'plan')} · ${p.provider === 'manual' ? 'transfer' : p.provider}`,
          href: `/admin/payments?filter=pending&q=${encodeURIComponent((p.provider_ref as string | null) ?? '')}`,
        })),
        filter: 'started in the last 24 hours and still waiting after 1 hour',
        workHref: '/admin/payments?filter=pending',
      }
    }

    case 'todo-due': {
      const { data: imp } = await admin
        .from('reconciliation_imports')
        .select('id')
        .eq('gateway', 'paypro')
        .order('created_at', { ascending: false })
        .limit(1)
      const id = (imp ?? [])[0]?.id as string | undefined
      let due: ReturnType<typeof settleByDate>['due'] = []
      if (id) {
        const { data } = await admin
          .from('reconciliation_rows')
          .select('order_number, transaction_status, payment_via, order_amount, merchant_share, date_paid, settle_date, settle_status')
          .eq('import_id', id)
          .limit(20000)
        const n = (v: unknown) => (v === null || v === undefined || v === '' ? null : Number(v))
        const rows: PayproRow[] = ((data ?? []) as Record<string, unknown>[]).map((r) => ({
          orderNumber: String(r.order_number ?? ''),
          transactionStatus: (r.transaction_status as string | null) ?? null,
          paymentVia: (r.payment_via as string | null) ?? null,
          orderAmount: n(r.order_amount),
          merchantShare: n(r.merchant_share),
          datePaid: (r.date_paid as string | null) ?? null,
          settleDate: (r.settle_date as string | null) ?? null,
          settleStatus: (r.settle_status as string | null) ?? null,
        }))
        // Only meaningful once the file carries settle dates at all.
        if (rows.some((r) => r.settleDate)) due = settleByDate(rows, [], now.toISOString()).due
      }
      return {
        key,
        rows: due.map((d) => ({
          id: d.orderNumber,
          title: d.orderNumber,
          detail: `Paid ${d.datePaid ? formatDate(d.datePaid) : '—'}${d.ageDays !== null ? ` · ${d.ageDays} day${d.ageDays === 1 ? '' : 's'} ago` : ''}${d.overdue ? ' · overdue' : ''}`,
          href: '/admin/finance/settlement',
        })),
        filter: 'paid at PayPro, not yet settled to our bank (latest PayPro file)',
        workHref: '/admin/finance/settlement',
      }
    }

    case 'todo-flagged': {
      const [{ data: flags }, { data: reports }] = await Promise.all([
        admin.from('abuse_flags').select('id, source, matched, created_at').eq('status', 'open').order('created_at', { ascending: false }).limit(5000),
        admin.from('reports').select('id, target_type, reason, created_at').eq('status', 'open').order('created_at', { ascending: false }).limit(5000),
      ])
      const rows: OverviewRow[] = [
        ...(flags ?? []).map((f) => ({
          id: `flag-${f.id}`,
          title: `Flagged ${(f.source as string | null) ?? 'message'}`,
          detail: `${formatDateTime(f.created_at as string)}${f.matched ? ` · matched “${String(f.matched).slice(0, 40)}”` : ''}`,
          href: '/admin/flags',
        })),
        ...(reports ?? []).map((r) => ({
          id: `report-${r.id}`,
          title: `Report about a ${(r.target_type as string | null) ?? 'member'}`,
          detail: `${formatDateTime(r.created_at as string)}${r.reason ? ` · ${String(r.reason).slice(0, 60)}` : ''}`,
          href: '/admin/reports',
        })),
      ]
      return {
        key,
        rows,
        filter: 'open flagged messages and open reports',
        extra: `${(flags ?? []).length} flagged · ${(reports ?? []).length} reports`,
        workHref: (flags ?? []).length > 0 ? '/admin/flags' : '/admin/reports',
      }
    }

    case 'todo-pausing': {
      // A tuition pauses 15 days after coalesce(resumed_at, created_at); "in the
      // next 2 days" = that base falls in (now − 15d, now − 13d]. Instants, never
      // ISO strings ("+00:00" and "Z" do not sort alike).
      const fromMs = now.getTime() - PAUSE_AFTER_DAYS * 86_400_000
      const toMs = now.getTime() - (PAUSE_AFTER_DAYS - 2) * 86_400_000
      const jobs = await pageAll((a, b) =>
        admin
          .from('jobs')
          .select('id, ref_id, title, city, created_at, resumed_at')
          .eq('status', 'open')
          .lte('created_at', new Date(toMs).toISOString())
          .order('created_at', { ascending: true })
          .range(a, b),
      )
      const rows = jobs.filter((j) => {
        const base = Date.parse((j.resumed_at as string | null) ?? (j.created_at as string))
        return base > fromMs && base <= toMs
      })
      return {
        key,
        rows: rows.map((j) => {
          const base = Date.parse((j.resumed_at as string | null) ?? (j.created_at as string))
          return {
            id: j.id as string,
            title: `${(j.ref_id as string | null) ?? ''} ${(j.title as string | null) ?? ''}`.trim() || 'Tuition',
            detail: `${(j.city as string | null) ?? '—'} · pauses ${formatDate(new Date(base + PAUSE_AFTER_DAYS * 86_400_000).toISOString())}`,
            href: `/admin/jobs/${j.id}`,
          }
        }),
        filter: 'open and pausing automatically in the next 2 days',
        workHref: '/admin/jobs?status=open',
      }
    }

    case 'todo-featured': {
      const f = await featured()
      const rows = f.rows.filter((r) => r.matches.length > 0)
      return {
        key,
        rows: rows.map((r) => ({
          id: r.tutorId,
          title: r.name,
          detail: `${r.matches.length} new matching tuition${r.matches.length === 1 ? '' : 's'}`,
          href: '/admin/users/featured-whatsapp',
        })),
        filter: 'on Featured with new matching tuitions not yet sent',
        workHref: '/admin/users/featured-whatsapp',
      }
    }

    default: {
      const sets = funnelSets(await funnelCohort(days))
      const pick: Record<string, CohortTutor[]> = {
        'funnel-signed-up': sets.signedUp,
        'funnel-mobile': sets.mobile,
        'funnel-onboarded': sets.onboarded,
        'funnel-paid': sets.paid,
        'lost-mobile': sets.lostMobile,
        'lost-onboarding': sets.lostOnboarding,
        'lost-payment': sets.lostPayment,
      }
      const words: Record<string, string> = {
        'funnel-signed-up': 'signed up',
        'funnel-mobile': 'signed up and verified their mobile',
        'funnel-onboarded': 'verified their mobile and finished onboarding',
        'funnel-paid': `finished onboarding and paid the ${FEE_LABEL}`,
        'lost-mobile': 'signed up but did not verify their mobile',
        'lost-onboarding': 'verified their mobile but did not finish onboarding',
        'lost-payment': 'finished onboarding but did not pay',
      }
      return {
        key,
        rows: tutorRows(pick[key] ?? []),
        filter: `who ${words[key] ?? ''} — joined in the last ${days} days (paused, test and staff accounts left out)`,
        workHref: '/admin/users/unpaid-signups',
      }
    }
  }
}

/** "6 tutors paid this month (1–31 Oct 2026)" — the list header. */
export function listHeader(list: OverviewList): string {
  const meta = OVERVIEW_ITEMS[list.key]
  const n = list.rows.length
  return `${n} ${nounFor(meta, n)} ${list.filter}`
}
