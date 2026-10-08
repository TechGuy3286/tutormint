import Link from 'next/link'
import { BadgeCheck } from 'lucide-react'
import type { ApprovalRow } from '@/lib/approvalQueue'

// The "Approval needed" list (PR106-H1 §3). Fee-paid first, then oldest. Each
// row shows what is waiting as chips and "Paid" when the fee is in; tapping opens
// that tutor's identity review.
export default function ApprovalList({ rows }: { rows: ApprovalRow[] }) {
  if (rows.length === 0) {
    return (
      <p className="rounded-2xl border border-gray-200 bg-white p-6 text-center text-xs text-gray-500">
        Nothing is waiting for review right now.
      </p>
    )
  }
  return (
    <ul className="space-y-2">
      {rows.map((r) => (
        <li key={r.id}>
          <Link
            href={r.href}
            className="flex items-center justify-between gap-3 rounded-2xl border border-gray-200 bg-white p-4 hover:border-tm-navy"
          >
            <div className="min-w-0">
              <p className="truncate text-sm font-bold text-tm-navy">
                {r.name}
                {r.kind === 'parent' && <span className="ml-1.5 text-[11px] font-semibold text-gray-500">· Parent</span>}
              </p>
              <div className="mt-1 flex flex-wrap gap-1.5">
                {r.waiting.map((w) => (
                  <span key={w} className="rounded-full bg-tm-tint-navy px-2 py-0.5 text-[11px] font-bold text-tm-navy">
                    {w}
                  </span>
                ))}
              </div>
            </div>
            {r.paid && (
              <span className="inline-flex shrink-0 items-center gap-1 rounded-full bg-tm-tint-green px-2.5 py-1 text-[11px] font-bold text-tm-green-deep">
                <BadgeCheck aria-hidden size={13} /> Paid
              </span>
            )}
          </Link>
        </li>
      ))}
    </ul>
  )
}
