'use client'
import { Receipt, Undo2, X } from 'lucide-react'

import { useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import InfiniteFooter from '@/components/InfiniteFooter'
import StatusChip from '@/components/admin/StatusChip'
import { adminFetch } from '@/components/admin/adminFetch'
import { formatDate, formatDateTime } from '@/lib/datetime'
import { useInfinite } from '@/lib/useInfinite'
import type { QueuePaymentRow, QueueSubscriptionRow } from '@/lib/adminQueues'

// The payments screen: a queue of transfers to decide on, and the ledger of
// what is currently active.
//
// Mobile-first. The subscription ledger is genuinely tabular, so on small
// screens it becomes a stack of cards rather than a table with a horizontal
// scrollbar; from sm up it is a table inside its own overflow container so the
// page body never scrolls sideways.

export type QueuePayment = QueuePaymentRow
export type SubscriptionRow = QueueSubscriptionRow

const FILTERS = [
  { key: 'pending', label: 'Pending' },
  { key: 'approved', label: 'Approved' },
  { key: 'rejected', label: 'Rejected' },
  { key: 'all', label: 'All' },
]

export default function PaymentQueue({
  payments,
  subscriptions,
  filter,
  paymentsCursor,
  paymentsTotal,
  subscriptionsCursor,
  subscriptionsTotal,
}: {
  payments: QueuePayment[]
  subscriptions: SubscriptionRow[]
  filter: string
  paymentsCursor: string | null
  paymentsTotal: number
  subscriptionsCursor: string | null
  subscriptionsTotal: number
}) {
  const router = useRouter()
  // Two lists on one screen, two cursors. They page independently: reading
  // further down the ledger has nothing to do with the queue above it.
  const morePayments = useInfinite<QueuePayment>({
    endpoint: '/api/admin/queues/payments',
    params: { filter },
    initialCursor: paymentsCursor,
    storageKey: `tm:more:admin-payments:${filter}`,
  })
  const moreSubs = useInfinite<SubscriptionRow>({
    endpoint: '/api/admin/queues/subscriptions',
    params: {},
    initialCursor: subscriptionsCursor,
    storageKey: 'tm:more:admin-subscriptions',
  })
  const allPayments = [...payments, ...morePayments.items]
  const allSubs = [...subscriptions, ...moreSubs.items]
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [rejecting, setRejecting] = useState<string | null>(null)
  const [reason, setReason] = useState('')

  const decide = async (paymentId: string, action: 'approve' | 'reject') => {
    setBusy(paymentId)
    setError(null)
    try {
      const { ok, data: json } = await adminFetch<{ [k: string]: unknown; error?: string }>(
        '/api/admin/payments/decide',
        {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ paymentId, action, reason }),
        },
      )
      if (!ok) throw new Error(json.error ?? 'That did not work.')
      setRejecting(null)
      setReason('')
      router.refresh()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'That did not work.')
    } finally {
      setBusy(null)
    }
  }

  return (
    <div className="space-y-5">
      <nav className="flex flex-wrap gap-2" aria-label="Payment status">
        {FILTERS.map((f) => (
          <Link
            key={f.key}
            href={`/admin/payments?filter=${f.key}`}
            className={`inline-flex min-h-[44px] items-center rounded-xl px-4 text-xs font-bold ${
              filter === f.key
                ? 'bg-tm-black text-white'
                : 'border border-gray-200 bg-white text-slate-700'
            }`}
          >
            {f.label}
          </Link>
        ))}
      </nav>

      {error && (
        <p className="rounded-xl border border-tm-red/30 bg-tm-tint-red p-3 text-xs font-bold text-tm-red">
          {error}
        </p>
      )}

      {/* ------------------------------------------------------- queue --- */}
      <section className="space-y-3">
        <h2 className="text-sm font-black text-tm-navy">
          Payments {paymentsTotal > 0 ? `(${paymentsTotal})` : ''}
        </h2>

        {allPayments.length === 0 ? (
          <p className="rounded-2xl border border-gray-200 bg-white p-6 text-center text-xs text-gray-500">
            Nothing here.
          </p>
        ) : (
          <ul className="space-y-3">
            {allPayments.map((p) => (
              <li key={p.id} className="space-y-3 rounded-2xl border border-gray-200 bg-white p-4">
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-black text-tm-navy">{p.name}</p>
                    <p className="truncate text-[11px] text-gray-500">{p.email}</p>
                  </div>
                  <StatusChip status={p.status} />
                </div>

                <dl className="grid grid-cols-2 gap-2 text-[11px]">
                  <Cell label="Plan" value={p.planName} />
                  <Cell label="Amount" value={`Rs. ${p.amountPkr.toLocaleString('en-PK')}`} />
                  <Cell
                    label="Channel"
                    value={p.provider === 'manual' ? (p.method ?? 'transfer') : p.provider}
                  />
                  <Cell label="Submitted" value={formatDateTime(p.createdAt)} />
                  <Cell label="Our reference" value={p.ourReference ?? '—'} mono />
                  <Cell label="Their transaction" value={p.payerReference ?? '—'} mono />
                  {/* Which ad produced a payment. This is the whole reason
                      UTM is captured -- clicks are cheap to count and tell you
                      nothing about which campaign is worth its budget. */}
                  <Cell label="Came from" value={p.cameFrom ?? 'Direct'} />
                </dl>

                {p.rejectionReason && (
                  <p className="rounded-xl bg-tm-tint-red p-2 text-[11px] text-tm-red">
                    Rejected: {p.rejectionReason}
                  </p>
                )}

                {p.hasScreenshot && (
                  <a
                    href={`/api/payments/proof/${p.id}`}
                    target="_blank"
                    rel="noreferrer"
                    className="gap-1.5 inline-flex min-h-[44px] items-center rounded-xl border border-gray-200 px-4 text-xs font-bold text-slate-700"
                  >
                    <Receipt aria-hidden size={14} />
                    Open receipt
                  </a>
                )}

                {p.status === 'pending' &&
                  (rejecting === p.id ? (
                    <div className="space-y-2">
                      <input
                        value={reason}
                        onChange={(e) => setReason(e.target.value)}
                        placeholder="Why? The member sees this."
                        aria-label="Rejection reason"
                        className="min-h-[44px] w-full rounded-xl border border-gray-200 px-3 text-xs font-semibold"
                      />
                      <div className="grid grid-cols-2 gap-2">
                        <button
                          type="button"
                          disabled={reason.trim().length < 5 || busy === p.id}
                          onClick={() => decide(p.id, 'reject')}
                          className="inline-flex items-center gap-1.5 min-h-[44px] rounded-xl bg-tm-red px-4 text-xs font-bold text-white disabled:bg-gray-300"
                        >
                          <X aria-hidden size={13} />
                          Confirm reject
                        </button>
                        <button
                          type="button"
                          onClick={() => {
                            setRejecting(null)
                            setReason('')
                          }}
                          className="inline-flex items-center justify-center gap-1.5 min-h-[44px] rounded-xl border border-gray-200 px-4 text-xs font-bold text-slate-700"
                        >
                          <Undo2 aria-hidden size={13} />
                          Cancel
                        </button>
                      </div>
                    </div>
                  ) : (
                    <div className="grid grid-cols-2 gap-2">
                      <button
                        type="button"
                        disabled={busy === p.id}
                        onClick={() => decide(p.id, 'approve')}
                        className="min-h-[44px] rounded-xl bg-tm-green-deep px-4 text-xs font-bold text-white disabled:opacity-60"
                      >
                        {busy === p.id ? 'Working…' : 'Approve & activate'}
                      </button>
                      <button
                        type="button"
                        onClick={() => setRejecting(p.id)}
                        className="inline-flex items-center justify-center gap-1.5 min-h-[44px] rounded-xl border border-gray-200 px-4 text-xs font-bold text-slate-700"
                      >
                        <X aria-hidden size={13} />
                        Reject
                      </button>
                    </div>
                  ))}
              </li>
            ))}
          </ul>
        )}

        {allPayments.length > 0 && (
          <InfiniteFooter
            state={morePayments.state}
            done={morePayments.done}
            loadMore={morePayments.loadMore}
            sentinel={morePayments.sentinel}
            loadedCount={allPayments.length}
            total={paymentsTotal}
            noun="payments"
          />
        )}
      </section>

      {/* ------------------------------------------------- subscriptions --- */}
      <section className="space-y-3">
        <h2 className="text-sm font-black text-tm-navy">Subscriptions</h2>

        {allSubs.length === 0 ? (
          <p className="rounded-2xl border border-gray-200 bg-white p-6 text-center text-xs text-gray-500">
            No subscriptions yet.
          </p>
        ) : (
          <>
            {/* Cards under sm — a six-column table at 360px is unreadable. */}
            <ul className="space-y-2 sm:hidden">
              {allSubs.map((s) => (
                <li key={s.id} className="space-y-1 rounded-2xl border border-gray-200 bg-white p-3">
                  <div className="flex items-baseline justify-between gap-2">
                    <p className="truncate text-xs font-black text-tm-navy">{s.name}</p>
                    <StatusChip status={s.status} />
                  </div>
                  <p className="truncate text-[11px] text-gray-500">{s.email}</p>
                  <p className="text-[11px] font-semibold text-tm-navy">
                    {s.planName} · {s.source}
                  </p>
                  <p className="text-[11px] text-gray-500">{expiryWords(s)}</p>
                </li>
              ))}
            </ul>

            <div className="hidden overflow-x-auto rounded-2xl border border-gray-200 bg-white sm:block">
              <table className="w-full min-w-[640px] text-left text-xs">
                <thead className="border-b border-gray-200 text-[10px] uppercase tracking-wide text-gray-500">
                  <tr>
                    <th className="p-3 font-bold">Member</th>
                    <th className="p-3 font-bold">Plan</th>
                    <th className="p-3 font-bold">Status</th>
                    <th className="p-3 font-bold">Expires</th>
                    <th className="p-3 font-bold">Source</th>
                  </tr>
                </thead>
                <tbody>
                  {allSubs.map((s) => (
                    <tr key={s.id} className="border-b border-gray-100 last:border-0">
                      <td className="p-3">
                        <span className="block font-bold text-tm-navy">{s.name}</span>
                        <span className="block text-[11px] text-gray-500">{s.email}</span>
                      </td>
                      <td className="p-3 font-semibold">{s.planName}</td>
                      <td className="p-3">
                        <StatusChip status={s.status} />
                      </td>
                      <td className="p-3 text-gray-500">{expiryWords(s)}</td>
                      <td className="p-3 text-gray-500">{s.source}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}

        {allSubs.length > 0 && (
          <InfiniteFooter
            state={moreSubs.state}
            done={moreSubs.done}
            loadMore={moreSubs.loadMore}
            sentinel={moreSubs.sentinel}
            loadedCount={allSubs.length}
            total={subscriptionsTotal}
            noun="subscriptions"
          />
        )}
      </section>
    </div>
  )
}

function expiryWords(s: SubscriptionRow): string {
  if (!s.expiresAt) return 'No end date'
  const d = new Date(s.expiresAt)
  const days = Math.ceil((d.getTime() - Date.now()) / 86_400_000)
  const date = formatDate(d)
  if (s.status !== 'active') return date
  return days <= 0 ? `${date} (lapsed)` : `${date} (${days}d)`
}

function Cell({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="min-w-0">
      <dt className="text-[10px] font-bold uppercase tracking-wide text-gray-500">{label}</dt>
      <dd className={`truncate font-semibold text-tm-navy ${mono ? 'font-mono text-[10px]' : ''}`}>
        {value}
      </dd>
    </div>
  )
}
