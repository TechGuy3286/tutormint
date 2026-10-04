import { Wallet } from 'lucide-react'

import type { PaymentHistoryRow } from '@/lib/paymentsHistory'
import { formatDate } from '@/lib/datetime'

// The dashboard "Payments & refunds" section (PR106-H4 §4.12). A plain list of
// each payment and any refund — no wallet balance is held. Server component.
export default function PaymentsRefunds({ rows }: { rows: PaymentHistoryRow[] }) {
  if (rows.length === 0) return null
  return (
    <section id="payments" className="scroll-mt-3 space-y-2 rounded-2xl border border-gray-200 bg-white p-4">
      <h2 className="flex items-center gap-1.5 text-sm font-black text-tm-navy">
        <Wallet aria-hidden size={16} /> Payments &amp; refunds
      </h2>
      <ul className="divide-y divide-gray-100">
        {rows.map((r) => (
          <li key={r.id} className="py-2">
            <div className="flex items-baseline justify-between gap-2">
              <span className="text-xs font-bold text-tm-navy">{r.what}</span>
              <span className="text-xs font-black text-tm-navy">Rs {r.amountPkr.toLocaleString('en-PK')}</span>
            </div>
            <p className="text-[11px] text-gray-500">{formatDate(r.date)}</p>
            {r.refundedAmountPkr && r.refundedAmountPkr > 0 ? (
              <p className="mt-0.5 text-[11px] font-semibold text-tm-green-deep">
                Refund sent: Rs {r.refundedAmountPkr.toLocaleString('en-PK')}
                {r.refundMethod ? ` to your ${r.refundMethod}` : ''}
                {r.refundedAt ? ` — ${formatDate(r.refundedAt)}` : ''}
              </p>
            ) : null}
          </li>
        ))}
      </ul>
    </section>
  )
}
