'use client'

import { useState } from 'react'
import Link from 'next/link'
import InfiniteFooter from '@/components/InfiniteFooter'
import StatusChip from '@/components/admin/StatusChip'
import ParentDocumentReview from '@/components/admin/ParentDocumentReview'
import { useInfinite } from '@/lib/useInfinite'
import { formatDateTime } from '@/lib/datetime'
import type { QueueParentRow } from '@/lib/adminQueues'

export type QueueParent = QueueParentRow

const FILTERS = [
  { key: 'submitted', label: 'Awaiting review' },
  { key: 'all', label: 'All' },
  { key: 'approved', label: 'Verified' },
]

export default function ParentVerificationClient({
  parents,
  filter,
  initialCursor,
  total,
}: {
  parents: QueueParent[]
  filter: string
  initialCursor: string | null
  total: number
}) {
  const more = useInfinite<QueueParent>({
    endpoint: '/api/admin/queues/parents',
    params: { filter },
    initialCursor,
    storageKey: `tm:more:admin-parents:${filter}`,
  })
  const all = [...parents, ...more.items]
  const [open, setOpen] = useState<QueueParent | null>(null)

  return (
    <div className="space-y-4">
      <p className="text-xs text-gray-500">
        Each parent&apos;s CNIC and address are approved or rejected on their own. Approving both
        gives the parent the green Verified badge. Posting, messaging and demos need only a verified
        mobile, so nothing waits on this queue.
        Awaiting review lists the oldest submission first.
      </p>

      <nav className="flex gap-1.5 overflow-x-auto pb-1" aria-label="Filter">
        {FILTERS.map((f) => (
          <Link
            key={f.key}
            href={`/admin/parents?filter=${f.key}`}
            aria-current={filter === f.key ? 'page' : undefined}
            className={`min-h-[44px] whitespace-nowrap px-3.5 py-2 rounded-xl text-[11px] font-bold border flex items-center transition-colors ${
              filter === f.key
                ? 'bg-tm-black text-white border-tm-navy'
                : 'bg-white text-slate-700 border-gray-200 hover:bg-gray-50'
            }`}
          >
            {f.label}
          </Link>
        ))}
      </nav>

      {all.length === 0 ? (
        <p className="bg-white border border-gray-200 rounded-2xl p-6 text-center text-xs font-bold text-gray-500">
          Nothing in this queue.
        </p>
      ) : (
        <ul className="space-y-2">
          {all.map((p) => (
            <li key={p.id}>
              <button
                onClick={() => setOpen(p)}
                className="w-full text-left bg-white border border-gray-200 rounded-2xl p-3 sm:p-4 hover:border-tm-navy transition-colors flex items-center gap-3 min-h-[44px]"
              >
                <div className="min-w-0 flex-1">
                  <p className="text-xs font-black text-tm-navy truncate">{p.fullName}</p>
                  <p className="text-[11px] text-gray-500 truncate">
                    {p.city ?? '—'}
                    {p.submittedAt ? ` · submitted ${formatDateTime(p.submittedAt)}` : ''}
                  </p>
                  {p.waiting.length > 0 && (
                    <div className="mt-1 flex flex-wrap gap-1">
                      {p.waiting.map((w) => (
                        <span key={w} className="rounded-full bg-tm-tint-navy px-2 py-0.5 text-[10px] font-bold text-tm-navy">
                          {w} waiting
                        </span>
                      ))}
                    </div>
                  )}
                </div>
                <StatusChip status={p.verified ? 'approved' : p.state} />
              </button>
            </li>
          ))}
        </ul>
      )}

      {all.length > 0 && (
        <InfiniteFooter
          state={more.state}
          done={more.done}
          loadMore={more.loadMore}
          sentinel={more.sentinel}
          loadedCount={all.length}
          total={total}
          noun="parents"
        />
      )}

      {open && (
        <div
          className="fixed inset-0 z-50 bg-tm-black/50 flex items-end sm:items-center sm:justify-center"
          role="dialog"
          aria-modal="true"
          aria-label={`Review ${open.fullName}`}
          onClick={() => setOpen(null)}
        >
          <div
            className="bg-white w-full sm:max-w-lg max-h-[90vh] overflow-y-auto rounded-t-3xl sm:rounded-3xl p-5 space-y-4"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <h2 className="text-base font-black text-tm-navy truncate">{open.fullName}</h2>
                <p className="text-[11px] text-gray-500 truncate">{open.email}</p>
              </div>
              <button onClick={() => setOpen(null)} className="text-gray-500 text-xl min-h-[44px] px-2" aria-label="Close">
                ×
              </button>
            </div>

            <dl className="grid grid-cols-2 gap-2 text-[11px]">
              <Info label="Mobile" value={open.phoneVerified ? `${open.phone} ✓` : (open.phone ?? '—')} />
              <Info label="Submitted" value={open.submittedAt ? formatDateTime(open.submittedAt) : '—'} />
            </dl>

            <ParentDocumentReview
              key={open.id}
              canReview
              docs={{
                parentId: open.id,
                cnicFrontId: open.cnicFrontId,
                cnicBackId: open.cnicBackId,
                cnicNumber: open.cnicNumber,
                address: open.address,
                city: open.city,
                cnic: open.cnic,
                addressItem: open.addressItem,
                verified: open.verified,
                whatsapp: open.whatsapp,
              }}
            />

            <Link href={`/admin/users/${open.id}#documents`} className="inline-flex min-h-[40px] items-center text-xs font-bold text-tm-red hover:underline">
              Open member page
            </Link>
          </div>
        </div>
      )}
    </div>
  )
}

function Info({ label, value }: { label: string; value: string }) {
  return (
    <div className="bg-tm-bg border border-gray-100 rounded-xl p-2">
      <dt className="text-[10px] uppercase tracking-wider text-gray-500 font-bold">{label}</dt>
      <dd className="text-[11px] font-bold text-tm-navy capitalize truncate">{value}</dd>
    </div>
  )
}
