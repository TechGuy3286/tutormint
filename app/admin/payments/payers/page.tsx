import Link from 'next/link'

import { requireAdminRole, SCREEN_ACCESS } from '@/lib/adminAuth'
import { recentFeePayers } from '@/lib/feePayers'
import { formatDateTime } from '@/lib/datetime'
import type { DocOverall } from '@/lib/feePayersCore'

// "Recent payers" (owner, 7 Oct 2026): opened from the Overview "Paid this month"
// tile. Tutors whose Rs 199 Spam Free Platform Fee was approved, newest first —
// one row per tutor (their latest fee payment). Refunded payments and deleted
// accounts are left out. Same access as the Overview revenue tile.

export const dynamic = 'force-dynamic'

const DOC_LABEL: Record<DocOverall, { text: string; cls: string }> = {
  approved: { text: 'Approved', cls: 'bg-tm-tint-green text-tm-green-deep' },
  waiting: { text: 'Waiting', cls: 'bg-tm-tint-gold text-tm-gold-ink' },
  rejected: { text: 'Rejected', cls: 'bg-tm-tint-red text-tm-red' },
}

export default async function RecentPayersPage() {
  await requireAdminRole(...SCREEN_ACCESS.payments)
  const payers = await recentFeePayers(100)

  return (
    <div className="mx-auto max-w-3xl space-y-4">
      <header className="space-y-1">
        <h1 className="text-lg font-black text-tm-navy">Recent payers</h1>
        <p className="text-xs text-gray-500">
          Tutors who paid the Rs 199 Spam Free Platform Fee, newest first. Refunded payments and deleted accounts are not shown.
        </p>
      </header>

      {payers.length === 0 ? (
        <p className="rounded-2xl border border-gray-200 bg-white p-4 text-xs text-gray-500">No fee payments yet.</p>
      ) : (
        <ul className="divide-y divide-gray-100 rounded-2xl border border-gray-200 bg-white">
          {payers.map((p) => {
            const doc = DOC_LABEL[p.docs]
            return (
              <li key={p.userId} className="flex flex-wrap items-center justify-between gap-2 px-4 py-3">
                <div className="min-w-0">
                  <Link href={`/admin/users/${p.userId}`} className="text-sm font-bold text-tm-navy hover:text-tm-red hover:underline">
                    {p.name}
                  </Link>
                  <p className="text-[11px] text-gray-600">
                    Paid {formatDateTime(p.paidAt)}
                    {p.ref ? <span className="break-all"> · {p.ref}</span> : null}
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  <span className={`rounded-full px-2.5 py-0.5 text-[11px] font-bold ${doc.cls}`}>Documents: {doc.text}</span>
                  <Link
                    href={`/admin/tutors/${p.userId}`}
                    className="inline-flex min-h-[40px] items-center rounded-xl border border-gray-200 px-3 text-[11px] font-bold text-tm-navy hover:border-tm-navy"
                  >
                    Review documents
                  </Link>
                </div>
              </li>
            )
          })}
        </ul>
      )}
    </div>
  )
}
