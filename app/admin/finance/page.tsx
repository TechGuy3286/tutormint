import Link from 'next/link'
import { Download, Scale } from 'lucide-react'

import { requireAdminRole, SCREEN_ACCESS } from '@/lib/adminAuth'
import { loadFinance } from '@/lib/finance'
import { monthRangeLabel, type FinancePayment } from '@/lib/financeCore'
import { pkr } from '@/lib/reconciliationCore'
import { formatDate, formatDateTime, pkDayKey } from '@/lib/datetime'
import { TILE_TONE } from '@/lib/tileTones'

// Admin → Finance (owner, 8 Oct 2026, item 4). OWNER ONLY, plus the view-only
// Partner: SCREEN_ACCESS.finance is `[]`, so every other role is redirected
// away here and refused 403 by the export route.
//
// Totals count approved payments still attached to an account and never
// refunded; refunds and deleted-account payments are listed separately below
// and never mixed into a total (lib/financeCore). Dated by approval, in
// Pakistan time. No member contact detail is read for this page.

export const dynamic = 'force-dynamic'

const ISO_DAY = /^\d{4}-\d{2}-\d{2}$/

function monthName(ym: string): string {
  const [y, m] = ym.split('-').map(Number)
  return new Date(Date.UTC(y, m - 1, 1)).toLocaleString('en-GB', { month: 'long', year: 'numeric', timeZone: 'UTC' })
}

const card = 'space-y-3 rounded-2xl border border-gray-200 bg-white p-4 sm:p-5'
const th = 'p-2 text-left text-[10px] font-bold uppercase tracking-wide text-gray-500'
const td = 'p-2 text-xs text-slate-700'

export default async function FinancePage({ searchParams }: { searchParams: Promise<{ from?: string; to?: string }> }) {
  await requireAdminRole(...SCREEN_ACCESS.finance)
  const sp = await searchParams
  const today = pkDayKey(new Date())
  let from = sp.from && ISO_DAY.test(sp.from) ? sp.from : `${today.slice(0, 7)}-01`
  let to = sp.to && ISO_DAY.test(sp.to) ? sp.to : today
  if (from > to) [from, to] = [to, from]

  const f = await loadFinance()

  const totals = [
    { key: 'all', label: 'All time', sum: f.totals.allTime, sub: 'Every counted payment', tone: TILE_TONE.green },
    { key: 'month', label: 'This month', sum: f.totals.thisMonth, sub: monthRangeLabel(f.thisMonth), tone: TILE_TONE.teal },
    { key: 'last', label: 'Last month', sum: f.totals.lastMonth, sub: monthRangeLabel(f.lastMonth), tone: TILE_TONE.navy },
    { key: 'year', label: 'This year', sum: f.totals.thisYear, sub: `1 Jan – today, ${f.thisYear}`, tone: TILE_TONE.violet },
  ]

  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div className="space-y-1">
          <h1 className="text-lg font-black text-tm-navy">Finance</h1>
          <p className="max-w-2xl text-xs text-gray-500">
            Approved payments, dated by approval in Pakistan time. Totals leave out refunded payments and payments from deleted
            accounts — both are listed on their own below.
          </p>
        </div>
        <Link
          href="/admin/finance/settlement"
          className="inline-flex min-h-[44px] items-center gap-1.5 rounded-xl border border-gray-200 bg-white px-4 text-xs font-bold text-slate-700 hover:border-tm-navy"
        >
          <Scale aria-hidden size={14} />
          Settlement check
        </Link>
      </header>

      {/* ------------------------------------------------------- totals */}
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {totals.map((t) => (
          <div key={t.key} className={`rounded-2xl border border-black/5 p-4 [color-scheme:light] ${t.tone.card}`}>
            <p className={`text-[11px] font-bold uppercase tracking-wide ${t.tone.ink}`}>{t.label}</p>
            <p className={`text-2xl font-black ${t.tone.ink}`}>{pkr(t.sum.amount)}</p>
            <p className={`text-[11px] ${t.tone.ink}`}>
              {t.sum.count} payment{t.sum.count === 1 ? '' : 's'} · {t.sub}
            </p>
          </div>
        ))}
      </div>

      {/* ------------------------------------------------ month by month */}
      <section className={card}>
        <div>
          <h2 className="text-sm font-black text-tm-navy">Month by month</h2>
          <p className="text-[11px] text-gray-500">
            Collected counts the same payments as the totals. The bank columns follow the money: every approved PayPro payment
            moved through PayPro (refunded and deleted-account ones too), as in the settlement check. A transfer a member made
            straight to our bank counts as expected and received.
          </p>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[620px]">
            <thead className="border-b border-gray-200">
              <tr>
                <th className={th}>Month</th>
                <th className={`${th} text-right`}>Collected</th>
                <th className={`${th} text-right`}>PayPro deductions</th>
                <th className={`${th} text-right`}>Expected in bank</th>
                <th className={`${th} text-right`}>Received in bank</th>
                <th className={`${th} text-right`}>Due from PayPro</th>
              </tr>
            </thead>
            <tbody>
              {f.months.map((m) => (
                <tr key={m.month} className="border-b border-gray-100 last:border-0">
                  <td className={`${td} font-bold text-tm-navy`}>{monthName(m.month)}</td>
                  <td className={`${td} text-right`}>{pkr(m.collected)}</td>
                  <td className={`${td} text-right`}>{pkr(m.payproDeductions)}</td>
                  <td className={`${td} text-right`}>{pkr(m.expectedInBank)}</td>
                  <td className={`${td} text-right`}>{pkr(m.receivedInBank)}</td>
                  <td className={`${td} text-right font-bold ${m.dueFromPaypro > 0 ? 'text-tm-red' : 'text-tm-green-deep'}`}>
                    {pkr(m.dueFromPaypro)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      {/* ---------------------------------------------- by type / method */}
      <div className="grid gap-4 lg:grid-cols-2">
        <SumTable title="By type" rows={f.byType} />
        <SumTable title="By method" rows={f.byMethod} />
      </div>

      {/* --------------------------------------- refunds / deleted accounts */}
      <div className="grid gap-4 lg:grid-cols-2">
        <PaymentList
          title="Refunded payments"
          empty="No refunds recorded."
          rows={f.refunded}
          extra={(p) => `refunded ${pkr(p.refundedAmountPkr)}${p.refundedAt ? ` on ${formatDate(p.refundedAt)}` : ''}`}
        />
        <PaymentList
          title="Payments from deleted accounts"
          empty="None."
          rows={f.deleted}
          extra={(p) => p.note ?? 'account deleted'}
        />
      </div>

      {/* --------------------------------------------------- download */}
      <section className={card}>
        <h2 className="text-sm font-black text-tm-navy">Download</h2>
        <p className="text-[11px] text-gray-500">
          Every approved payment in the range (Pakistan time): date, TM reference, type, method, amount and whether it is
          counted, refunded or from a deleted account. No member names, mobiles or emails.
        </p>
        <form method="GET" action="/api/admin/finance/export" className="flex flex-wrap items-end gap-2">
          <label className="space-y-1">
            <span className="block text-[11px] font-bold text-gray-600">From</span>
            <input type="date" name="from" defaultValue={from} className="min-h-[44px] rounded-xl border border-gray-200 px-3 text-sm" />
          </label>
          <label className="space-y-1">
            <span className="block text-[11px] font-bold text-gray-600">To</span>
            <input type="date" name="to" defaultValue={to} className="min-h-[44px] rounded-xl border border-gray-200 px-3 text-sm" />
          </label>
          <button
            type="submit"
            className="inline-flex min-h-[44px] items-center gap-1.5 rounded-xl bg-tm-navy px-4 text-xs font-bold text-white hover:bg-tm-navy-hover"
          >
            <Download aria-hidden size={14} />
            Download .xlsx
          </button>
        </form>
      </section>
    </div>
  )
}

function SumTable({ title, rows }: { title: string; rows: { label: string; count: number; amount: number }[] }) {
  const total = rows.reduce((s, r) => s + r.amount, 0)
  return (
    <section className={card}>
      <h2 className="text-sm font-black text-tm-navy">{title}</h2>
      <table className="w-full">
        <thead className="border-b border-gray-200">
          <tr>
            <th className={th}>{title === 'By type' ? 'Type' : 'Method'}</th>
            <th className={`${th} text-right`}>Payments</th>
            <th className={`${th} text-right`}>Amount</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.label} className="border-b border-gray-100 last:border-0">
              <td className={`${td} font-semibold`}>{r.label}</td>
              <td className={`${td} text-right`}>{r.count}</td>
              <td className={`${td} text-right`}>{pkr(r.amount)}</td>
            </tr>
          ))}
          <tr>
            <td className={`${td} font-black text-tm-navy`}>Total</td>
            <td className={`${td} text-right font-black text-tm-navy`}>{rows.reduce((s, r) => s + r.count, 0)}</td>
            <td className={`${td} text-right font-black text-tm-navy`}>{pkr(total)}</td>
          </tr>
        </tbody>
      </table>
    </section>
  )
}

function PaymentList({
  title,
  empty,
  rows,
  extra,
}: {
  title: string
  empty: string
  rows: FinancePayment[]
  extra: (p: FinancePayment) => string
}) {
  return (
    <section className={card}>
      <h2 className="text-sm font-black text-tm-navy">
        {title} ({rows.length})
      </h2>
      {rows.length === 0 ? (
        <p className="text-[11px] text-gray-500">{empty}</p>
      ) : (
        <ul className="divide-y divide-gray-100">
          {rows.map((p) => (
            <li key={p.id} className="py-2 text-xs text-slate-700">
              <span className="block font-mono text-[11px] text-tm-navy">{p.ref ?? p.id}</span>
              <span className="block">
                {formatDateTime(p.approvedAt)} · {pkr(p.amountPkr)} · {p.method} · {extra(p)}
              </span>
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}
