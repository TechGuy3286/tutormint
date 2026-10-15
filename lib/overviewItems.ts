// lib/overviewItems.ts
//
// Admin → Overview, counts that match their lists (owner, 8 Oct 2026, item 5)
// — the I/O half. ONE loader per item returns the item's rows; the Overview
// shows that list's length (revenue: its sum) and /admin/overview/<key> shows
// the same rows. The rules and titles live in lib/overviewItemsCore.ts.
//
// Every caller checks the item's SCREEN_ACCESS key first (OVERVIEW_ITEMS[key]
// .screen) — the same key the Overview filters its cards and rows by.

import { signedUpIn, signupCounts } from '@/lib/staffOutreachCore'
import { SIGNUPS_TODAY_HREF, payproFileNote, waitingOrderLine, type FileNote } from '@/lib/overviewItemsCore'
import { pkr } from '@/lib/reconciliationCore'
import { missingSentence } from '@/lib/onboarding/missingItems'
import { loadUnmetBoard } from '@/lib/unmetSearches'
import { testAccountIds } from '@/lib/testAccounts'
import { pageAll } from '@/lib/pageAll'
import 'server-only'

import { cache } from 'react'
import type { SupabaseClient } from '@supabase/supabase-js'

import { createAdminClient } from '@/lib/supabase/admin'
import { approvalNeeded } from '@/lib/approvalQueue'
import { loadUnpaidSignups, loadFeaturedWhatsapp } from '@/lib/staffOutreach'
import { isTestName, PAYMENT_STEP_LABEL, stuckBreakdown, firstNameOf } from '@/lib/staffOutreachCore'
import { continueLink, loadFollowUpStates, loadStuckTemplate } from '@/lib/followUps'
import { followUpLine, followUpText, followUpWaLink, splitFollowUpTabs, STUCK_TEMPLATE_KEY, type FollowUpSource } from '@/lib/followUpCore'
import { pauseDueAtMs } from '@/lib/tuitionStatus'
import { settleByDate } from '@/lib/settlementCore'
import type { PayproRow } from '@/lib/reconciliationCore'
import { loadFinancePayments } from '@/lib/finance'
import { countedInMonth, monthRangeLabel, pkMonth } from '@/lib/financeCore'
import { docOverall, pkMonthStartMs, type DocOverall } from '@/lib/feePayersCore'
import { tutorDocStatusesFromProfile } from '@/lib/tutorDocStatus'
import { formatName } from '@/lib/formatName'
import { formatDate, formatDateTime } from '@/lib/datetime'
import { FEE_LABEL } from '@/lib/display'
import {
  OVERVIEW_ITEMS,
  feePayersSince,
  feePayersInRange,
  payerPeriodRange,
  PAYER_PERIODS,
  type PayerPeriod,
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
  /** A short status word beside the row (e.g. "Documents waiting"). */
  badge?: string
  /** Extra links on the row (e.g. "Review documents"). */
  actions?: { label: string; href: string }[]
  /** The member this row is about — the list page shows a member card for it
   *  (lib/overviewCards). Rows about tuitions, payments or searches have none. */
  memberId?: string
  /** Where staff review this member's documents (document lists only). */
  reviewHref?: string
  /** One-tap follow-up (Stuck in onboarding / Follow-up sent, 9 Oct 2026). */
  followUp?: {
    source: FollowUpSource
    templateKey: string | null
    waHref: string | null
    telHref: string | null
    tab: 'stuck' | 'sent'
    /** "Follow-up sent 2 days ago by Aqsa". */
    line: string | null
    /** "Followed up once" — back on the Stuck tab after 7 days. */
    tag: string | null
  }
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
  /** A dated line under the title, with a link (the PayPro file's age). */
  note?: FileNote | null
}

const PK_DATE = (iso: string) => formatDate(iso)


const unpaid = cache(async () => loadUnpaidSignups(new Date()))
const featured = cache(async () => loadFeaturedWhatsapp(new Date()))

/**
 * Stuck in onboarding, split into its two tabs by the shared follow-up record
 * (owner, 9 Oct 2026). The Overview number is the Stuck tab's length; each
 * card carries the prefilled WhatsApp link built from the stored template.
 */
const stuckTabs = cache(async () => {
  const now = new Date()
  const all = await unpaid()
  const stuckRows = all.filter((r) => r.stoppedAt && r.stoppedAt !== PAYMENT_STEP_LABEL)
  const [states, template] = await Promise.all([loadFollowUpStates(stuckRows.map((r) => r.id), now), loadStuckTemplate()])
  const link = continueLink()
  const toRow = (r: (typeof stuckRows)[number], tab: 'stuck' | 'sent'): OverviewRow => {
    const st = states.get(r.id)
    const text = template ? followUpText(template.body, { name: firstNameOf(r.name), step: r.stoppedAt, link, missing: r.missing }) : null
    return {
      id: r.id,
      title: r.name,
      // The same missing-items list the tutor sees (owner, 13 Oct 2026).
      detail: `Stopped at ${r.stoppedAt} · joined ${PK_DATE(r.joinedAt)}${r.missing.length ? ` · Still to do: ${missingSentence(r.missing, 6)}` : ''}`,
      href: `/admin/users/${r.id}`,
      memberId: r.id,
      followUp: {
        source: 'stuck',
        templateKey: template?.key ?? STUCK_TEMPLATE_KEY,
        waHref: r.msisdn && text ? followUpWaLink(r.msisdn, text) : null,
        telHref: r.msisdn ? `tel:+${r.msisdn}` : null,
        tab,
        line: st ? followUpLine(st, now.getTime()) : null,
        tag: st?.tag ?? null,
      },
    }
  }
  const split = splitFollowUpTabs(stuckRows, states)
  return {
    all,
    stuck: split.stuck.map((r) => toRow(r, 'stuck')),
    sent: split.sent.map((r) => toRow(r, 'sent')),
  }
})

/** Both tab counts, for the tabs on the list page. */
export async function stuckTabCounts(): Promise<{ stuck: number; sent: number }> {
  const t = await stuckTabs()
  return { stuck: t.stuck.length, sent: t.sent.length }
}

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
  return list.map((t) => ({ id: t.id, title: t.name, detail: `Joined ${PK_DATE(t.createdAt)}`, href: `/admin/users/${t.id}`, memberId: t.id }))
}

async function profilesByRole(admin: SupabaseClient, roles: string[]): Promise<OverviewRow[]> {
  // Test-named accounts (owner, 8 Oct 2026) are left out of every Overview count.
  const rows = await pageAll((a, b) =>
    admin
      .from('profiles')
      .select('id, full_name, created_at')
      .in('role', roles)
      .eq('is_test_name', false)
      .order('created_at', { ascending: false })
      .order('id')
      .range(a, b),
  )
  return rows.map((p) => ({
    id: p.id as string,
    title: formatName(p.full_name as string | null) || '—',
    detail: `Joined ${PK_DATE(p.created_at as string)}`,
    href: `/admin/users/${p.id}`,
    memberId: p.id as string,
  }))
}

// ---------------------------------------------------------------- loaders
export async function loadOverviewList(
  key: OverviewItemKey,
  opts: { days?: 7 | 30; now?: Date; period?: PayerPeriod } = {},
): Promise<OverviewList> {
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

    case 'paid-today': {
      const nowMs = now.getTime()
      const data = await pageAll((from, to) =>
        admin
          .from('payments')
          .select('id, user_id, reviewed_at, updated_at, refunded_amount_pkr, refunded_at, provider_ref')
          .eq('plan_code', 'verified')
          .eq('status', 'approved')
          .not('user_id', 'is', null)
          .order('reviewed_at', { ascending: false, nullsFirst: false })
          .order('id')
          .range(from, to),
      )
      const fee = (data ?? []).map((p) => ({
        userId: p.user_id as string | null,
        approvedAt: (p.reviewed_at as string | null) ?? (p.updated_at as string | null),
        refundedAmountPkr: p.refunded_amount_pkr as number | null,
        refundedAt: p.refunded_at as string | null,
        ref: (p.provider_ref as string | null) ?? null,
      }))
      const { month, week } = feePayersSince(fee, nowMs, pkMonthStartMs(nowMs))
      // The period switch (owner, 15 Oct 2026; it replaced Payments → Recent
      // payers). The card counts today; the list may show another period,
      // with the same rule (feePayersInRange).
      const period: PayerPeriod = opts.period ?? 'today'
      const range = payerPeriodRange(period, nowMs)
      const today = feePayersInRange(fee, range.start, range.end)
      const periodWords = PAYER_PERIODS.find((x) => x.key === period)?.label.toLowerCase() ?? 'today'
      const ids = today.map((r) => r.userId as string)
      const [{ data: profs }, { data: selfies }] = ids.length
        ? await Promise.all([
            admin
              .from('profiles')
              .select('id, full_name, cnic_verified_at, verification_state, verification_rejection_reason, cnic_number, cnic_image_path, profile_pic_status, profile_pic_reason, selfie_status, selfie_reason, avatar_url')
              .in('id', ids),
            admin.from('user_documents').select('user_id').eq('kind', 'selfie').in('user_id', ids),
          ])
        : [{ data: [] as Record<string, unknown>[] }, { data: [] as Record<string, unknown>[] }]
      const hasSelfie = new Set((selfies ?? []).map((r) => r.user_id as string))
      const byId = new Map((profs ?? []).map((p) => [p.id as string, p]))
      const DOC_WORD: Record<DocOverall, string> = { approved: 'Documents approved', waiting: 'Documents waiting', rejected: 'Documents rejected' }
      return {
        key,
        rows: today.map((r) => {
          const p = byId.get(r.userId as string)
          const docs: DocOverall = p ? docOverall(tutorDocStatusesFromProfile(p, hasSelfie.has(r.userId as string))) : 'waiting'
          return {
            id: r.userId as string,
            title: formatName((p?.full_name as string | null) ?? null) || '—',
            detail: `Paid ${formatDateTime(r.at)}${r.ref ? ` · ${r.ref}` : ''}`,
            href: `/admin/users/${r.userId}`,
            badge: DOC_WORD[docs],
            actions: [{ label: 'Review documents', href: `/admin/tutors/${r.userId}` }],
            memberId: r.userId as string,
            reviewHref: `/admin/tutors/${r.userId}`,
          }
        }),
        filter:
          period === 'today'
            ? `paid the ${FEE_LABEL} today (since 00:00 Pakistan time)`
            : `paid the ${FEE_LABEL} — ${periodWords} (Pakistan time), not refunded, account not deleted`,
        extra: `${month} this month · ${week} in the last 7 days`,
      }
    }

    case 'signups-today': {
      // The SAME rows and the SAME rule as Unpaid signups → Today
      // (loadUnpaidSignups + signedUpIn): tutors who created their account today
      // (Pakistan time) and have not paid the Verification Fee; staff, test,
      // paused and banned accounts are already left out of that list.
      const nowMs = now.getTime()
      const all = await unpaid()
      const counts = signupCounts(all, nowMs)
      const rows = all.filter((r) => signedUpIn(r.joinedAt, 'today', nowMs))
      return {
        key,
        rows: rows.map((r) => ({ id: r.id, title: r.name, detail: `Joined ${formatDateTime(r.joinedAt)} · stopped at ${r.stoppedAt ?? 'payment'}`, href: `/admin/users/${r.id}`, memberId: r.id })),
        filter: `who signed up today (since 00:00 Pakistan time) and have not paid the ${FEE_LABEL}`,
        extra: `${counts.yesterday} yesterday · ${counts.week} in the last 7 days`,
        workHref: SIGNUPS_TODAY_HREF,
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
      // Tuitions posted by test-named accounts are not counted (owner, 8 Oct 2026).
      const testIds = new Set(await testAccountIds())
      const jobs = (
        await pageAll((a, b) =>
          admin.from('jobs').select('id, ref_id, title, city, created_at, parent_id').eq('status', 'open').order('created_at', { ascending: false }).order('id').range(a, b),
        )
      ).filter((j) => !testIds.has(j.parent_id as string))
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
          detail: `${r.kind === 'parent' ? 'Parent · ' : ''}Waiting: ${r.waiting.join(', ')}${r.paid ? ' · fee paid' : ''}`,
          href: r.href,
          memberId: r.id,
          reviewHref: r.href,
        })),
        filter: 'with a document waiting for a decision',
        workHref: '/admin/users?filter=approval',
      }
    }

    case 'todo-uncontacted': {
      const rows = (await unpaid()).filter((r) => !r.lastContact)
      return {
        key,
        rows: rows.map((r) => ({ id: r.id, title: r.name, detail: `Joined ${PK_DATE(r.joinedAt)} · stopped at ${r.stoppedAt ?? 'payment'}`, href: `/admin/users/${r.id}`, memberId: r.id })),
        filter: 'who joined in the last 30 days, have not paid, and nobody has contacted yet',
        workHref: '/admin/follow-ups?filter=uncontacted',
      }
    }

    case 'todo-stuck': {
      const t = await stuckTabs()
      return {
        key,
        rows: t.stuck,
        filter: 'who joined in the last 30 days and stopped before the payment step',
        extra: stuckBreakdown(t.all.map((r) => r.stoppedAt)).detail,
        workHref: '/admin/follow-ups?filter=onboarding',
      }
    }

    case 'todo-stuck-sent': {
      const t = await stuckTabs()
      return {
        key,
        rows: t.sent,
        filter: 'stuck in onboarding, followed up in the last 7 days',
        workHref: '/admin/follow-ups?filter=followed',
      }
    }

    case 'todo-payments': {
      const since = new Date(now.getTime() - 24 * 60 * 60 * 1000).toISOString()
      const data = await pageAll((from, to) =>
        admin
          .from('payments')
          .select('id, provider_ref, plan_code, provider, status, created_at')
          .eq('status', 'pending')
          .gte('created_at', since)
          .order('created_at', { ascending: false })
          .order('id')
          .range(from, to),
      )
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
        .select('id, created_at')
        .eq('gateway', 'paypro')
        .order('created_at', { ascending: false })
        .limit(1)
      const id = (imp ?? [])[0]?.id as string | undefined
      const uploadedAt = ((imp ?? [])[0]?.created_at as string | undefined) ?? null
      let due: ReturnType<typeof settleByDate>['due'] = []
      if (id) {
        const data = await pageAll((from, to) =>
          admin
            .from('reconciliation_rows')
            .select('id, order_number, transaction_status, payment_via, order_amount, merchant_share, date_paid, settle_date, settle_status')
            .eq('import_id', id)
            .order('id')
            .range(from, to),
        )
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
          // "Rs 193 · paid 8 Oct 2026 · 5 days" (owner, 13 Oct 2026). This list is
          // owner + Partner only (the finance screen), so the amount may show.
          detail: waitingOrderLine({
            amountText: d.merchantShare !== null && d.merchantShare !== undefined ? pkr(d.merchantShare) : null,
            paidText: d.datePaid ? formatDate(d.datePaid) : null,
            ageDays: d.ageDays,
            overdue: d.overdue,
          }),
          href: '/admin/finance?tab=settlement',
        })),
        filter: 'paid by customers, not yet paid out to our bank by PayPro',
        workHref: '/admin/finance?tab=settlement',
        note: payproFileNote(uploadedAt, uploadedAt ? `${formatDateTime(uploadedAt)} (Pakistan time)` : null, now.getTime()),
      }
    }

    case 'todo-flagged': {
      const [flags, reports] = await Promise.all([
        pageAll((from, to) => admin.from('abuse_flags').select('id, source, matched, created_at').eq('status', 'open').order('created_at', { ascending: false }).order('id').range(from, to)),
        pageAll((from, to) => admin.from('reports').select('id, target_type, reason, created_at').eq('status', 'open').order('created_at', { ascending: false }).order('id').range(from, to)),
      ])
      const rows: OverviewRow[] = [
        ...(flags ?? []).map((f) => ({
          id: `flag-${f.id}`,
          title: `Flagged ${(f.source as string | null) ?? 'message'}`,
          detail: `${formatDateTime(f.created_at as string)}${f.matched ? ` · matched “${String(f.matched).slice(0, 40)}”` : ''}`,
          href: '/admin/reports?tab=flags',
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
        workHref: (flags ?? []).length > 0 ? '/admin/reports?tab=flags' : '/admin/reports',
      }
    }

    case 'todo-unmet': {
      // The To review cards of Overview → Unmet searches (owner, 11 Oct 2026):
      // searches of the last 7 days that found nothing, identical ones merged,
      // staff / test-account / test-text searches left out, and searches already
      // marked done left out. The SAME loader as the screen, so this number is
      // its To review tab.
      const board = await loadUnmetBoard(now)
      const list = board.toReview
      const tally = (pick: (g: (typeof list)[number]) => string | null) => {
        const m = new Map<string, number>()
        for (const g of list) {
          const v = pick(g)
          if (v) m.set(v, (m.get(v) ?? 0) + g.count)
        }
        return [...m.entries()].sort((a, b) => b[1] - a[1]).slice(0, 3).map(([v, n]) => `${v} (${n})`).join(', ')
      }
      const topCities = tally((g) => g.city)
      const topSubjects = tally((g) => g.subject ?? g.school)
      return {
        key,
        rows: list.map((g, i) => ({
          id: `unmet-${i}`,
          title: `“${g.query}”`,
          detail: [
            `${g.count} time${g.count === 1 ? '' : 's'}`,
            g.city ? `City ${g.city}` : null,
            g.level ? `Level ${g.level}` : null,
            g.subject ? `Subject ${g.subject}` : null,
            g.school ? `School ${g.school}` : null,
            g.surfaces.join(' + '),
            g.roles.join(', '),
          ].filter(Boolean).join(' · '),
          href: `/browse/${g.surfaces.includes('tuitions') && !g.surfaces.includes('tutors') ? 'tuitions' : 'tutors'}?q=${encodeURIComponent(g.query)}`,
        })),
        filter: 'searches that found nothing in the last 7 days',
        extra: [topCities ? `Top cities: ${topCities}` : null, topSubjects ? `Top subjects: ${topSubjects}` : null, `${board.excluded} left out (staff or test)`].filter(Boolean).join(' · ') || null,
        workHref: '/admin/overview/todo-unmet',
      }
    }

    case 'todo-pausing': {
      // A tuition pauses at pauseDueAtMs(coalesce(resumed_at, created_at)) — the
      // one clock. "In the next 2 days" = that instant falls in (now, now + 2d].
      const soonMs = now.getTime() + 2 * 86_400_000
      const jobs = await pageAll((a, b) =>
        admin
          .from('jobs')
          .select('id, ref_id, title, city, created_at, resumed_at')
          .eq('status', 'open')
          .order('created_at', { ascending: true })
          .range(a, b),
      )
      const rows = jobs.filter((j) => {
        const due = pauseDueAtMs((j.resumed_at as string | null) ?? (j.created_at as string))
        return due > now.getTime() && due <= soonMs
      })
      return {
        key,
        rows: rows.map((j) => {
          const due = pauseDueAtMs((j.resumed_at as string | null) ?? (j.created_at as string))
          return {
            id: j.id as string,
            title: `${(j.ref_id as string | null) ?? ''} ${(j.title as string | null) ?? ''}`.trim() || 'Tuition',
            detail: `${(j.city as string | null) ?? '—'} · pauses ${formatDate(new Date(due).toISOString())}`,
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
          memberId: r.tutorId,
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
        workHref: '/admin/follow-ups',
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
