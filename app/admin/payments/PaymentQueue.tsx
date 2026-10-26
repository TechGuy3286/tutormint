'use client'

import { shownEmail } from '@/lib/actorLabelCore'
import { useState } from 'react'
import { Receipt } from 'lucide-react'

import Link from 'next/link'
import InfiniteFooter from '@/components/InfiniteFooter'
import QueueSearch from '@/components/admin/QueueSearch'
import StatusChip from '@/components/admin/StatusChip'
import PaymentDecide from './PaymentDecide'
import DocumentViewer from '@/components/admin/DocumentViewer'
import { OwnerOnlyNote } from '@/components/admin/ReadOnly'
import { channelLabel } from '@/lib/payments/receiptCore'
import { PAYMENT_FILTERS, WAITING_LABEL, paymentsHeading } from '@/lib/paymentFiltersCore'
import RefundControl from './RefundControl'
import { refundLabel } from '@/lib/payments/refundCore'
import { formatDate, formatDateTime } from '@/lib/datetime'
import { useInfinite } from '@/lib/useInfinite'
import { dedupeById } from '@/lib/dedupe'
import type { PaymentQueueCounts, QueuePaymentRow, QueueSubscriptionRow } from '@/lib/adminQueues'

// The payments screen: the manual-transfer queue (awaiting approval) and the
// ledger of what is currently active.
//
// A bank/wallet transfer waits for a person to approve it (PR98 §4) — it is
// 'pending' with a payer reference until an owner/admin approves it here, which
// runs the audited activatePayment. Card payments confirm automatically, so
// they are shown read-only. A 'pending' row with NO payer reference never
// completed (the member started a transfer and did not submit it) and is shown
// as "Incomplete", not a waiting item.
//
// Mobile-first. The subscription ledger is genuinely tabular, so on small
// screens it becomes a stack of cards rather than a table with a horizontal
// scrollbar; from sm up it is a table inside its own overflow container so the
// page body never scrolls sideways.

export type QueuePayment = QueuePaymentRow
export type SubscriptionRow = QueueSubscriptionRow

// Two filters only (owner, 21 Oct 2026): Paid / Completed and Unpaid /
// Incomplete. Rules and words: lib/paymentFiltersCore. Whether a bank receipt
// waits for the Owner is decided on the server (waitingReview) by the same
// rule as the sidebar badge and the member's own screen.
function awaitingApproval(p: QueuePayment): boolean {
  return p.waitingReview
}

function filterHref(key: string, search: string, showHidden: boolean): string {
  const qs = new URLSearchParams({ filter: key })
  if (search) qs.set('q', search)
  if (showHidden) qs.set('hidden', '1')
  return `/admin/payments?${qs.toString()}`
}

export default function PaymentQueue({
  payments,
  subscriptions,
  filter,
  counts,
  showHidden,
  search,
  canApprove,
  canRefund,
  paymentsCursor,
  paymentsTotal,
  subscriptionsCursor,
  subscriptionsTotal,
}: {
  payments: QueuePayment[]
  subscriptions: SubscriptionRow[]
  filter: string
  counts: PaymentQueueCounts
  showHidden: boolean
  search: string
  canApprove: boolean
  /** Marking refunded is owner only (owner, 8 Oct 2026). */
  canRefund: boolean
  paymentsCursor: string | null
  paymentsTotal: number
  subscriptionsCursor: string | null
  subscriptionsTotal: number
}) {
  // Two lists on one screen, two cursors. They page independently: reading
  // further down the ledger has nothing to do with the list above it. Only the
  // payments list is searchable — the search term rides its params and its
  // storage key so a filtered/searched window never restores a different one's
  // rows; the ledger below is unaffected.
  const morePayments = useInfinite<QueuePayment>({
    endpoint: '/api/admin/queues/payments',
    params: { filter, ...(search ? { search } : {}), ...(showHidden ? { hidden: '1' } : {}) },
    initialCursor: paymentsCursor,
    storageKey: `tm:more:admin-payments:v2:${filter}:${search}:${showHidden ? 'h' : ''}`,
  })
  const moreSubs = useInfinite<SubscriptionRow>({
    endpoint: '/api/admin/queues/subscriptions',
    params: {},
    initialCursor: subscriptionsCursor,
    storageKey: 'tm:more:admin-subscriptions',
  })
  // PR106-H3 §0d/1.3: the first page is server-rendered (`payments`) while
  // useInfinite restores a window from sessionStorage; after a mutation re-renders
  // the screen the two sources can overlap, so a payment appeared twice and the
  // rendered count exceeded the header's exact count. De-duplicate by id — the
  // first occurrence (the fresh server row) wins — so each payment shows once.
  const allPayments = dedupeById([...payments, ...morePayments.items])
  const allSubs = dedupeById([...subscriptions, ...moreSubs.items])
  // The receipt open in the shared viewer (one at a time), by payment id.
  const [viewing, setViewing] = useState<{ id: string; name: string } | null>(null)

  return (
    <div className="space-y-5">
      <nav className="flex flex-wrap gap-2" aria-label="Payment status">
        {PAYMENT_FILTERS.map((f) => (
          <Link
            key={f.key}
            href={filterHref(f.key, search, showHidden)}
            aria-current={filter === f.key ? 'page' : undefined}
            className={`inline-flex min-h-[44px] items-center rounded-xl px-4 text-xs font-bold ${
              filter === f.key
                ? 'bg-tm-black text-white'
                : 'border border-gray-200 bg-white text-slate-700'
            }`}
          >
            {f.label} ({counts[f.key]})
          </Link>
        ))}
      </nav>

      {/* ------------------------------------------------------- payments --- */}
      <section className="space-y-3">
        <div className="flex flex-col gap-3">
          <div className="space-y-0.5">
            <h2 className="text-sm font-black text-tm-navy">
              {paymentsHeading(allPayments.length, paymentsTotal)}
            </h2>
          </div>
          {/* Searches the payer's name or email, or a reference off the receipt. */}
          <QueueSearch
            basePath="/admin/payments"
            initialQuery={search}
            filter={filter}
            keep={{ hidden: showHidden ? '1' : undefined }}
            placeholder="Payer name, email, or reference"
            ariaLabel="Search payments"
          />
        </div>

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
                    <p className="truncate text-[11px] text-gray-500">{shownEmail(p.email)}</p>
                    {p.note && p.userId && (
                      <p className="truncate text-[11px] font-semibold text-tm-gold-ink">{p.note}</p>
                    )}
                  </div>
                  {/* A submitted transfer waiting for a person reads "Waiting for
                      approval" (gold). A 'pending' row with no payer reference
                      never completed → neutral "Incomplete". Others as stored. */}
                  {awaitingApproval(p) ? (
                    <StatusChip status="pending" label={WAITING_LABEL} tone="pending" />
                  ) : p.statusLabel === 'Paid' ? (
                    <StatusChip status={p.status} label="Paid" />
                  ) : (
                    <span className="rounded-full bg-gray-100 px-2 py-0.5 text-[10px] font-bold text-slate-700">
                      {p.statusLabel}
                    </span>
                  )}
                  {p.refund !== 'none' && !p.statusLabel.includes('efunded') && (
                    <span className="rounded-full bg-tm-tint-navy px-2 py-0.5 text-[10px] font-bold text-tm-navy">
                      {refundLabel(p.refund)}
                    </span>
                  )}
                </div>

                <dl className="grid grid-cols-2 gap-2 text-[11px]">
                  <Cell label="Package" value={p.planName} />
                  {/* Amounts reach only the owner and the Partner; for other
                      staff the server sends null and the cell is left out. */}
                  {p.amountPkr !== null && (
                    <Cell
                      label={awaitingApproval(p) ? 'Amount expected' : 'Amount'}
                      value={`Rs. ${p.amountPkr.toLocaleString('en-PK')}`}
                    />
                  )}
                  {/* How it was paid, labelled the way Finance labels it — every
                      bank transfer reads "Bank transfer", whatever the stored
                      method on older rows, so it can be matched to a bank credit. */}
                  <Cell label="Method" value={channelLabel(p.provider, p.method)} />
                  <Cell label={awaitingApproval(p) ? 'Uploaded' : 'Submitted'} value={formatDateTime(p.createdAt)} />
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

                {/* The receipt: an image opens in the shared viewer (zoom, rotate);
                    a PDF opens in a new tab. Served only through the gated route. */}
                {p.hasScreenshot &&
                  (p.receiptPdf ? (
                    <a
                      href={`/api/payments/proof/${p.id}`}
                      target="_blank"
                      rel="noreferrer"
                      className="gap-1.5 inline-flex min-h-[44px] items-center rounded-xl border border-gray-200 px-4 text-xs font-bold text-slate-700"
                    >
                      <Receipt aria-hidden size={14} />
                      Open receipt (PDF)
                    </a>
                  ) : (
                    <button
                      type="button"
                      onClick={() => setViewing({ id: p.id, name: p.name })}
                      className="gap-1.5 inline-flex min-h-[44px] items-center rounded-xl border border-gray-200 px-4 text-xs font-bold text-slate-700"
                    >
                      <Receipt aria-hidden size={14} />
                      Open receipt
                    </button>
                  ))}

                {canApprove && awaitingApproval(p) && (
                  <PaymentDecide paymentId={p.id} payerName={p.name} />
                )}
                {!canApprove && awaitingApproval(p) && <OwnerOnlyNote />}

                {/* Mark as refunded — owner/admin, on an approved payment not yet
                    fully refunded (PR106-H4 §4). */}
                {canRefund && p.amountPkr !== null && p.status === 'approved' && p.refund !== 'full' && (
                  <RefundControl
                    paymentId={p.id}
                    payerName={p.name}
                    amountPkr={p.amountPkr}
                    alreadyRefunded={p.refundedAmountPkr ?? 0}
                  />
                )}
                {p.refundedAmountPkr && p.refundedAmountPkr > 0 ? (
                  <p className="rounded-xl bg-tm-tint-navy p-2 text-[11px] text-tm-navy">
                    Refunded Rs {p.refundedAmountPkr.toLocaleString('en-PK')}
                    {p.refundMethod ? ` to ${p.refundMethod}` : ''}
                    {p.refundedAt ? ` · ${formatDateTime(p.refundedAt)}` : ''}
                  </p>
                ) : null}
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

        {/* Rows with no member name (a deleted or test account) are hidden by
            default; nothing is deleted. A waiting receipt is never hidden. */}
        {!showHidden && counts.hidden > 0 && (
          <p className="text-center">
            <Link
              href={`${filterHref(filter, search, true)}`}
              className="text-xs font-bold text-tm-navy underline"
            >
              Show {counts.hidden} hidden {counts.hidden === 1 ? 'row' : 'rows'}
            </Link>
          </p>
        )}
        {showHidden && (
          <p className="text-center">
            <Link href={filterHref(filter, search, false)} className="text-xs font-bold text-tm-navy underline">
              Hide rows with no member name
            </Link>
          </p>
        )}
      </section>

      <DocumentViewer
        images={viewing ? [{ src: `/api/payments/proof/${viewing.id}`, alt: `Bank transfer receipt — ${viewing.name}`, turnOnly: true }] : []}
        index={viewing ? 0 : null}
        onIndex={() => {}}
        onClose={() => setViewing(null)}
      />

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
                  <p className="truncate text-[11px] text-gray-500">{shownEmail(s.email)}</p>
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
                        <span className="block text-[11px] text-gray-500">{shownEmail(s.email)}</span>
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
