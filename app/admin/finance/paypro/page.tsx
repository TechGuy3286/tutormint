import Link from 'next/link'
import { requireAdminRole, SCREEN_ACCESS } from '@/lib/adminAuth'
import { loadPayproSettlement } from '@/lib/payproSettlement'
import { feeLabel, settlementCardLine, type SettlementLine } from '@/lib/payproSettlementCore'
import { pkr } from '@/lib/reconciliationCore'
import { formatDate } from '@/lib/datetime'

// Admin → Finance → PayPro settlement (owner, 27 Oct 2026). Same access as
// Finance (Owner; the Partner views). Every successful PayPro payment with its
// gross, PayPro's fee and the net PayPro should pay; the "PayPro payout"
// credits are allocated to them OLDEST FIRST (lib/payproSettlementCore).
// Read only; the member's name only, never a contact detail.

export const dynamic = 'force-dynamic'

const card = 'space-y-3 rounded-2xl border border-gray-200 bg-white p-4 sm:p-5'
const th = 'p-2 text-left text-[10px] font-bold uppercase tracking-wide text-gray-500'
const td = 'p-2 text-xs text-slate-700'

export default async function PayproSettlementPage() {
  await requireAdminRole(...SCREEN_ACCESS.finance)
  const r = await loadPayproSettlement()
  if (!r) return <p className="text-xs text-gray-500">The PayPro settlement could not be loaded right now. Please reload the page.</p>

  const totals = [
    { label: 'Net expected', value: pkr(r.netExpected), sub: `${r.count} payments · gross ${pkr(r.gross)} · fees ${pkr(r.fees)}` },
    { label: 'Received', value: pkr(r.received), sub: 'Credits recorded as a PayPro payout' },
    { label: 'Pending', value: pkr(r.pending), sub: r.oldestUnsettled ? `Oldest waiting since ${formatDate(r.oldestUnsettled)}` : 'Nothing waiting' },
  ]

  return (
    <div className="mx-auto max-w-5xl space-y-6" data-paypro-settlement="">
      <header className="space-y-1">
        <h1 className="text-lg font-black text-tm-navy">PayPro settlement</h1>
        <p className="text-xs text-gray-500">
          {settlementCardLine(r.pending)}. PayPro pays in batches, so each payout is set against the oldest unpaid payments first.{' '}
          <Link href="/admin/finance" className="font-bold text-tm-red underline">Back to Finance</Link>
        </p>
      </header>

      <div className="grid gap-3 sm:grid-cols-3">
        {totals.map((t) => (
          <div key={t.label} className="rounded-2xl border border-gray-200 bg-white p-4">
            <p className="text-[11px] font-bold uppercase tracking-wide text-gray-500">{t.label}</p>
            <p className="text-2xl font-black text-tm-navy">{t.value}</p>
            <p className="text-[11px] text-gray-600">{t.sub}</p>
          </div>
        ))}
      </div>

      {r.unallocated > 0 && (
        <p className="rounded-2xl border border-tm-gold/40 bg-tm-tint-gold p-3 text-xs font-bold text-tm-gold-ink">
          {pkr(r.unallocated)} of PayPro payouts is more than every payment expected. Check with PayPro.
        </p>
      )}
      {r.notFromPaypro.length > 0 && (
        <p className="rounded-2xl border border-tm-gold/40 bg-tm-tint-gold p-3 text-xs font-bold text-tm-gold-ink" data-not-paypro="">
          {r.notFromPaypro.length} credit{r.notFromPaypro.length === 1 ? ' is' : 's are'} recorded as a PayPro payout but the sender is not PayPro (
          {pkr(r.notFromPaypro.reduce((s, p) => s + p.amount, 0))}). They are not counted here — check them in Finance.
        </p>
      )}

      <section className={card}>
        <h2 className="text-sm font-black text-tm-navy">Not settled yet ({r.unsettled.length})</h2>
        {r.unsettled.length === 0 ? (
          <p className="text-xs text-gray-500">Every successful PayPro payment has been paid out.</p>
        ) : (
          <Table lines={r.unsettled} waiting />
        )}
      </section>

      <section className={card}>
        <h2 className="text-sm font-black text-tm-navy">Refunds ({r.refunds.length})</h2>
        <p className="text-[11px] text-gray-500">
          A refunded payment stays in the totals above: PayPro still pays it out to us, and we pay the member back ourselves.
        </p>
        {r.refunds.length === 0 ? (
          <p className="text-xs text-gray-500">No PayPro payment has been refunded.</p>
        ) : (
          <ul className="space-y-1 text-xs text-slate-700">
            {r.refunds.map((l) => (
              <li key={l.id}>
                {formatDate(l.paidAt)} · {l.member} · {pkr(l.gross)} · refunded {pkr(l.refundedPkr)}
              </li>
            ))}
            <li className="font-bold">Total paid back: {pkr(r.refundedTotal)}</li>
          </ul>
        )}
      </section>

      <section className={card}>
        <h2 className="text-sm font-black text-tm-navy">Every successful PayPro payment ({r.count})</h2>
        <Table lines={r.lines} />
      </section>
    </div>
  )
}

function Table({ lines, waiting }: { lines: SettlementLine[]; waiting?: boolean }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[640px]">
        <thead className="border-b border-gray-200">
          <tr>
            <th className={th}>Date</th>
            <th className={th}>Tutor</th>
            <th className={`${th} text-right`}>Gross</th>
            <th className={`${th} text-right`}>PayPro fee</th>
            <th className={`${th} text-right`}>Net expected</th>
            <th className={`${th} text-right`}>{waiting ? 'Pending' : 'Settled'}</th>
            {waiting && <th className={`${th} text-right`}>Waiting</th>}
          </tr>
        </thead>
        <tbody className="divide-y divide-gray-100">
          {lines.map((l) => (
            <tr key={l.id}>
              <td className={td}>{formatDate(l.paidAt)}</td>
              <td className={td}>{l.member}</td>
              <td className={`${td} text-right tabular-nums`}>{pkr(l.gross)}</td>
              <td className={`${td} text-right tabular-nums ${l.feeKind === 'check' ? 'font-bold text-tm-gold-ink' : ''}`}>{feeLabel(l)}</td>
              <td className={`${td} text-right tabular-nums`}>{pkr(l.net)}</td>
              <td className={`${td} text-right tabular-nums`}>{waiting ? pkr(l.pending) : pkr(l.settled)}</td>
              {waiting && <td className={`${td} text-right tabular-nums`}>{l.daysWaiting} day{l.daysWaiting === 1 ? '' : 's'}</td>}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
