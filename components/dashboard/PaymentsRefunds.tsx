import { Wallet } from 'lucide-react'

import type { PaymentHistoryRow } from '@/lib/paymentsHistory'
import { formatDate } from '@/lib/datetime'

// The dashboard "Payments" section (PR106-H4 §4.12; relabelled from "Payments &
// refunds" — owner, 6 Oct 2026). A plain list of each payment — no wallet
// balance is held. A refunded payment carries one small "Refunded" tag and
// nothing else about the refund: the member never sees refund wording beyond
// that tag; the full refund record (amount, method, date) stays on Admin →
// Payments, where "Mark as refunded" lives. Server component.
export default function PaymentsRefunds({ rows }: { rows: PaymentHistoryRow[] }) {
  if (rows.length === 0) return null
  return (
    <section id="payments" className="scroll-mt-3 space-y-2 rounded-2xl border border-gray-200 bg-white p-4">
      <h2 className="flex items-center gap-1.5 text-sm font-black text-tm-navy">
        <Wallet aria-hidden size={16} /> Payments
      </h2>
      <ul className="divide-y divide-gray-100">
        {rows.map((r) => (
          <li key={r.id} className="py-2">
            <div className="flex items-baseline justify-between gap-2">
              <span className="flex min-w-0 flex-wrap items-center gap-1.5 text-xs font-bold text-tm-navy">
                {r.what}
                {r.refundLabel && (
                  <span className="rounded-full bg-tm-tint-green px-2 py-0.5 text-[10px] font-bold text-tm-green-deep">
                    {r.refundLabel}
                  </span>
                )}
              </span>
              <span className="shrink-0 text-xs font-black text-tm-navy">Rs {r.amountPkr.toLocaleString('en-PK')}</span>
            </div>
            <p className="text-[11px] text-gray-500">{formatDate(r.date)}</p>
          </li>
        ))}
      </ul>
    </section>
  )
}
