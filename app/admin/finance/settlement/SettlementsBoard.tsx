'use client'

import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { useRouter } from 'next/navigation'
import { Download, Link2, MoreHorizontal, Plus, Search, Upload } from 'lucide-react'

import { adminFetch } from '@/components/admin/adminFetch'
import { useToast } from '@/components/ui/Toast'
import { useAdminReadOnly } from '@/components/admin/ReadOnly'
import { formatDate, formatDateTime } from '@/lib/datetime'
import { pkr } from '@/lib/reconciliationCore'
import { useUrlState } from '@/lib/useUrlState'
import { FEE_CHECK_WORDS, feeNeedsCheck, type CreditView, type OrderView } from '@/lib/settlementMatchCore'
import { financeCards, financeCounts, type FinanceGroup, type FinanceItem } from '@/lib/financeItemsCore'
import type { SettlementsBoard as BoardData } from '@/lib/settlementMatch'

import AddBankCredits from './AddBankCredits'
import LinkBankCredit from '@/components/admin/LinkBankCredit'
import { autoReceiptMatch } from '@/lib/bankPaymentLinkCore'

// Finance — ONE page (owner, 21 Oct 2026; it merged the Finance and Settlement
// check tabs). Three cards (Received · In the bank · Needs attention), two
// filters (Needs attention · All good ✅) over every money item of the month
// (lib/financeItemsCore — each item in exactly one), one main action per bank
// credit ("Link": one search for a member, a PayPro order or an approved bank
// transfer), "Ignore (not a sale)" in a small ⋯ menu, one "+ Add" button, and
// everything else behind "Show details" (closed by default). Layout only: the
// matching, the numbers and the Owner-only routes are unchanged — the Partner
// sees the page with no buttons, and the server refuses their writes anyway.

const INPUT =
  'min-h-[44px] w-full rounded-xl border border-gray-200 bg-white px-3 text-sm text-slate-800 focus:border-tm-navy focus:outline-none'
const BUTTON =
  'inline-flex min-h-[44px] items-center justify-center gap-1.5 rounded-xl bg-tm-navy px-4 text-xs font-bold text-white hover:bg-tm-navy-hover disabled:opacity-60'
const GHOST =
  'inline-flex min-h-[44px] items-center justify-center gap-1.5 rounded-xl border border-gray-200 bg-white px-4 text-xs font-bold text-slate-700 hover:border-tm-navy disabled:opacity-60'
const LABEL = 'block text-[11px] font-bold text-gray-600'
const CARD = 'space-y-1 rounded-2xl border border-gray-200 bg-white p-3'
const CHIP = 'inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-bold'

type DetailTab = 'orders' | 'receipts' | 'credits'
type ConfirmMode = 'unlink' | 'ignore'
type Member = { id: string; name: string; role: string; city: string | null; joined: string }

function monthName(ym: string): string {
  const [y, m] = ym.split('-').map(Number)
  return new Date(Date.UTC(y, m - 1, 1)).toLocaleString('en-GB', { month: 'long', year: 'numeric', timeZone: 'UTC' })
}

function orderChip(o: OrderView) {
  if (o.state === 'matched') return <span className={`${CHIP} bg-tm-tint-green text-tm-green-deep`}>✅ Matched</span>
  if (o.state === 'not_paid') return <span className={`${CHIP} bg-tm-bg text-gray-600`}>{o.transactionStatus ?? 'Not paid'}</span>
  return (
    <span className={`${CHIP} ${o.overdue ? 'bg-tm-tint-red text-tm-red' : 'bg-tm-tint-gold text-tm-gold-ink'}`}>
      ⏳ {o.state === 'waiting' ? 'Paid, waiting for the bank' : 'Paid out, no bank credit yet'}
      {o.ageDays !== null ? ` · ${o.ageDays}d` : ''}
    </span>
  )
}

const isGroup = (v: string): v is FinanceGroup => v === 'attention' || v === 'good'

export default function SettlementsBoard({
  data,
  items,
  details,
  detailsOpen = false,
}: {
  data: BoardData
  items: FinanceItem[]
  /** Server-rendered detail sections (totals, range check, download). */
  details?: ReactNode
  detailsOpen?: boolean
}) {
  const router = useRouter()
  const toast = useToast()
  const readOnly = useAdminReadOnly()
  const { view } = data

  // A Needs-attention alert dealt with (Owner): marked, never deleted.
  const resolveAlert = async (id: string) => {
    const res = await adminFetch('/api/admin/finance/alerts', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ id }) })
    if (!res.ok) {
      toast.error('That did not save. Please try again.')
      return
    }
    toast.success('Marked as dealt with.')
    router.refresh()
  }
  const counts = financeCounts(items)
  const cards = financeCards(view, items)
  const [group, setGroup] = useUrlState<FinanceGroup>('f', counts.attention > 0 ? 'attention' : 'good', isGroup)
  const [detailTab, setDetailTab] = useState<DetailTab>('credits')
  const [busy, setBusy] = useState<string | null>(null)
  const [adding, setAdding] = useState<null | 'menu' | 'credit' | 'export'>(null)
  const [uploaded, setUploaded] = useState<{ newCount: number; updatedCount: number; unknownOrders: string[] } | null>(null)
  const [linkFor, setLinkFor] = useState<string | null>(null)
  const [confirmFor, setConfirmFor] = useState<{ id: string; mode: ConfirmMode } | null>(null)
  const [menuFor, setMenuFor] = useState<string | null>(null)
  const [note, setNote] = useState('')
  const file = useRef<HTMLInputElement>(null)

  const creditById = useMemo(() => new Map(view.credits.map((c) => [c.id, c])), [view.credits])
  const orderByNumber = useMemo(() => new Map(view.orders.map((o) => [o.orderNumber, o])), [view.orders])
  const receiptById = useMemo(() => new Map(view.receipts.map((r) => [r.id, r])), [view.receipts])
  const shown = items.filter((i) => i.group === group)

  const upload = async () => {
    const f = file.current?.files?.[0]
    if (!f) {
      toast.error('Choose the PayPro Orders export first.')
      return
    }
    setBusy('upload')
    const body = new FormData()
    body.append('kind', 'gateway')
    body.append('gateway', 'paypro')
    body.append('file', f)
    try {
      const res = await fetch('/api/admin/payments/settlement', { method: 'POST', body })
      const d = (await res.json().catch(() => ({}))) as { error?: string; newCount?: number; updatedCount?: number; unknownOrders?: string[] }
      if (!res.ok) toast.error(d.error ?? 'That upload did not go through. Please try again.')
      else {
        setUploaded({ newCount: d.newCount ?? 0, updatedCount: d.updatedCount ?? 0, unknownOrders: d.unknownOrders ?? [] })
        toast.success(`PayPro export read: ${d.newCount ?? 0} new, ${d.updatedCount ?? 0} updated.`)
        if (file.current) file.current.value = ''
        router.refresh()
      }
    } catch {
      toast.error('We could not reach TutorMint. Check your internet connection and try again.')
    } finally {
      setBusy(null)
    }
  }

  const sendLink = async (transferId: string, action: 'link' | 'unlink' | 'ignore' | 'auto', orders: string[] = [], receipts: string[] = []) => {
    setBusy(`link-${transferId}`)
    const { ok, data: d } = await adminFetch<{ error?: string }>('/api/admin/payments/settlement/links', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ transferId, action, orders, receipts, note }),
    })
    setBusy(null)
    if (!ok) {
      toast.error(d?.error ?? 'That did not save. Please try again.')
      return false
    }
    toast.success(action === 'link' ? 'Linked.' : action === 'unlink' ? 'Unlinked.' : action === 'ignore' ? 'Marked as ignored (not a sale).' : 'Back to automatic matching.')
    setLinkFor(null)
    setConfirmFor(null)
    setNote('')
    router.refresh()
    return true
  }

  // ---------------------------------------------------------------- a credit
  const creditBody = (c: CreditView, label?: string) => {
    const m = c.match
    const manual = m?.status === 'manual' || c.state === 'held' || c.state === 'ignored'
    return (
      <>
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <p className={`text-sm font-black ${c.state === 'ignored' ? 'text-gray-600 line-through' : 'text-tm-navy'}`}>{pkr(c.amountPkr)}</p>
          {c.state === 'matched' ? (
            m!.status === 'amount_mismatch' ? (
              <span className={`${CHIP} bg-tm-tint-red text-tm-red`}>⚠️ Amount mismatch</span>
            ) : (
              <span className={`${CHIP} bg-tm-tint-green text-tm-green-deep`}>✅ Linked{m!.status === 'manual' ? ' by hand' : ''}</span>
            )
          ) : c.state === 'ignored' ? (
            <span className={`${CHIP} bg-white text-gray-600`}>Ignored (not a sale)</span>
          ) : (
            <span className={`${CHIP} bg-tm-tint-red text-tm-red`}>❓ Not linked</span>
          )}
        </div>
        {label && <p className="text-xs font-bold text-slate-800">{label}</p>}
        <p className="text-xs text-slate-700">
          {formatDate(c.date)}
          {c.time ? ` · ${c.time}` : ''} · {c.senderName ?? 'Sender not recorded'}
          {c.senderBank ? ` · ${c.senderBank}` : ''}
        </p>
        <p className="break-all text-[11px] text-gray-600">
          <span className="font-bold" data-credit-source="">Source: {c.source === 'email' ? 'Email' : 'Manual'}</span>
          {' · '}
          {c.reference ? `Ref ${c.reference} · ` : ''}
          {c.isPaypro ? 'PayPro payout' : 'Bank transfer from a member'}
          {c.note ? ` · ${c.note}` : ''}
        </p>
        {m && (
          <div className="space-y-0.5 text-[11px] text-slate-700">
            <p>
              {m.how} · expected {pkr(m.expected)}
              {m.status === 'bank_charge' ? ` · ${pkr(-m.difference)} bank charge` : ''}
              {m.status === 'amount_mismatch' || (m.status === 'manual' && Math.abs(m.difference) > 0.005)
                ? ` · ${m.difference < 0 ? `${pkr(-m.difference)} short` : `${pkr(m.difference)} over`}`
                : ''}
            </p>
            {m.orders.length > 0 && <p className="break-all">Orders: {m.orders.join(', ')}</p>}
            {m.receipts.length > 0 && <p className="break-all">Bank transfers: {m.receipts.map((id) => data.receiptRefs[id] ?? id).join(', ')}</p>}
            {m.note && <p>Note: {m.note}</p>}
          </div>
        )}
        {c.state === 'ignored' && (
          <p className="text-[11px] text-slate-700">
            Not matched, not counted as unmatched, and not in any money total or the CSV.{c.ignoreNote ? ` Note: ${c.ignoreNote}` : ''}
          </p>
        )}

        {!readOnly && linkFor !== c.id && confirmFor?.id !== c.id && (
          <div className="flex flex-wrap items-center gap-2 pt-1">
            <button type="button" onClick={() => { setLinkFor(c.id); setMenuFor(null); setNote('') }} className={BUTTON}>
              <Link2 aria-hidden size={14} /> {c.state === 'matched' ? 'Change link' : 'Link'}
            </button>
            <div className="relative">
              <button
                type="button"
                aria-label="More actions"
                aria-expanded={menuFor === c.id}
                onClick={() => setMenuFor(menuFor === c.id ? null : c.id)}
                className={`${GHOST} px-3`}
              >
                <MoreHorizontal aria-hidden size={16} />
              </button>
              {menuFor === c.id && (
                <div role="menu" className="absolute left-0 z-10 mt-1 w-56 space-y-1 rounded-xl border border-gray-200 bg-white p-1 shadow-lg">
                  {c.state !== 'ignored' && (
                    <button type="button" role="menuitem" onClick={() => { setConfirmFor({ id: c.id, mode: 'ignore' }); setMenuFor(null); setNote('') }} className="block min-h-[40px] w-full rounded-lg px-3 text-left text-xs font-bold text-slate-700 hover:bg-tm-bg">
                      Ignore (not a sale)
                    </button>
                  )}
                  {c.state === 'matched' && (
                    <button type="button" role="menuitem" onClick={() => { setConfirmFor({ id: c.id, mode: 'unlink' }); setMenuFor(null); setNote('') }} className="block min-h-[40px] w-full rounded-lg px-3 text-left text-xs font-bold text-slate-700 hover:bg-tm-bg">
                      Unlink
                    </button>
                  )}
                  {manual && (
                    <button type="button" role="menuitem" disabled={busy !== null} onClick={() => { setMenuFor(null); void sendLink(c.id, 'auto') }} className="block min-h-[40px] w-full rounded-lg px-3 text-left text-xs font-bold text-slate-700 hover:bg-tm-bg">
                      Back to automatic
                    </button>
                  )}
                </div>
              )}
            </div>
          </div>
        )}
        {!readOnly && linkFor === c.id && (
          <LinkPanel
            credit={c}
            data={data}
            busy={busy === `link-${c.id}`}
            note={note}
            setNote={setNote}
            onSave={(orders, receipts) => sendLink(c.id, 'link', orders, receipts)}
            onCancel={() => setLinkFor(null)}
          />
        )}
        {!readOnly && confirmFor?.id === c.id && (
          <div className="space-y-2 rounded-xl border border-gray-100 bg-tm-bg p-3">
            <p className="text-xs font-bold text-tm-navy">
              {confirmFor.mode === 'unlink'
                ? 'Unlink this credit? It will show as not linked.'
                : 'Ignore this credit (not a sale)? It is unlinked and no longer counts as unmatched. It stays on record; “Back to automatic” undoes this.'}
            </p>
            <label className="block">
              <span className={LABEL}>Note (why)</span>
              <input value={note} onChange={(e) => setNote(e.target.value)} className={INPUT} maxLength={500} />
            </label>
            <div className="flex flex-wrap gap-2">
              <button type="button" disabled={busy !== null} onClick={() => void sendLink(c.id, confirmFor.mode)} className={BUTTON}>
                {busy === `link-${c.id}` ? 'Saving…' : confirmFor.mode === 'unlink' ? 'Unlink' : 'Ignore (not a sale)'}
              </button>
              <button type="button" onClick={() => setConfirmFor(null)} className={GHOST}>
                Cancel
              </button>
            </div>
          </div>
        )}
      </>
    )
  }

  const creditCard = (c: CreditView, label?: string) => (
    <li key={c.id} className={c.state === 'ignored' ? CARD.replace('bg-white', 'bg-tm-bg') : CARD}>
      {creditBody(c, label)}
    </li>
  )

  const orderCard = (o: OrderView, label?: string) => (
    <li key={o.orderNumber} className={CARD}>
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <p className="break-all text-xs font-bold text-tm-navy">{o.orderNumber}</p>
        {orderChip(o)}
      </div>
      {label && <p className="text-xs font-bold text-slate-800">{label}</p>}
      <p className="text-[11px] text-slate-700">
        {o.method} · amount {pkr(o.orderAmount)} · share {pkr(o.merchantShare)} · fee {feeNeedsCheck(o.fee) ? FEE_CHECK_WORDS : pkr(o.fee)}
      </p>
      <p className="text-[11px] text-gray-600">
        {o.datePaid ? `Paid ${formatDate(o.datePaid)}` : 'Not paid'}
        {o.settleDate ? ` · settled ${formatDate(o.settleDate)}` : ''}
        {o.settleStatus ? ` · ${o.settleStatus}` : ''}
      </p>
    </li>
  )

  const itemRow = (it: FinanceItem) => {
    if (it.kind === 'alert' && it.alertId) {
      return (
        <li key={it.key} className={CARD} data-finance-alert="">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <p className="text-xs font-bold text-tm-red">{it.label}</p>
            {it.amount !== null && <p className="text-xs font-black text-tm-navy">{pkr(it.amount)}</p>}
          </div>
          {it.detail && <p className="text-[11px] leading-relaxed text-slate-700">{it.detail}</p>}
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="text-[11px] text-gray-600">{it.day ? formatDate(it.day) : ''}</p>
            {!readOnly && (
              <button type="button" className={GHOST} onClick={() => void resolveAlert(it.alertId!)}>
                Mark as dealt with
              </button>
            )}
          </div>
        </li>
      )
    }
    if (it.kind === 'credit' && it.creditId) {
      const c = creditById.get(it.creditId)
      if (c) return creditCard(c, it.label)
    }
    if (it.kind === 'order' && it.orderNumber) {
      const o = orderByNumber.get(it.orderNumber)
      if (o) return orderCard(o, it.label)
    }
    const r = it.receiptId ? receiptById.get(it.receiptId) : undefined
    return (
      <li key={it.key} className={CARD}>
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <p className="break-all text-xs font-bold text-tm-navy">{it.ref ?? ''}</p>
          {it.amount !== null && <p className="text-xs font-black text-tm-navy">{pkr(it.amount)}</p>}
        </div>
        <p className={`text-xs font-bold ${it.red ? 'text-tm-red' : it.group === 'attention' ? 'text-tm-gold-ink' : 'text-tm-green-deep'}`}>{it.label}</p>
        <p className="text-[11px] text-slate-700">
          {it.day ? (it.kind === 'receipt' ? `Approved ${formatDate(it.day)}` : formatDate(it.day)) : ''}
          {r?.payerName ? ` · ${r.payerName}` : ''}
          {r?.transactionId ? ` · transaction ID ${r.transactionId}` : ''}
        </p>
      </li>
    )
  }

  const detailTabs: { id: DetailTab; label: string; count: number }[] = [
    { id: 'credits', label: 'Bank credits', count: view.credits.length },
    { id: 'orders', label: 'PayPro orders', count: view.orders.length },
    { id: 'receipts', label: 'Bank transfers', count: view.receipts.length },
  ]
  const empty = (text: string) => <p className="rounded-2xl border border-gray-200 bg-white p-4 text-xs text-gray-600">{text}</p>

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end gap-2">
        <label className="min-w-[160px] flex-1">
          <span className={LABEL}>Month</span>
          <input
            type="month"
            defaultValue={view.month}
            onChange={(e) => /^\d{4}-\d{2}$/.test(e.target.value) && router.push(`/admin/finance?month=${e.target.value}`)}
            className={INPUT}
          />
        </label>
        {!readOnly && (
          <div className="relative">
            <button type="button" aria-expanded={adding === 'menu'} onClick={() => setAdding(adding === 'menu' ? null : 'menu')} className={BUTTON}>
              <Plus aria-hidden size={14} /> Add
            </button>
            {adding === 'menu' && (
              <div role="menu" className="absolute right-0 z-10 mt-1 w-56 space-y-1 rounded-xl border border-gray-200 bg-white p-1 shadow-lg">
                <button type="button" role="menuitem" onClick={() => setAdding('credit')} className="block min-h-[40px] w-full rounded-lg px-3 text-left text-xs font-bold text-slate-700 hover:bg-tm-bg">
                  Add bank credit
                </button>
                <button type="button" role="menuitem" onClick={() => setAdding('export')} className="block min-h-[40px] w-full rounded-lg px-3 text-left text-xs font-bold text-slate-700 hover:bg-tm-bg">
                  Upload PayPro export
                </button>
              </div>
            )}
          </div>
        )}
      </div>

      {!readOnly && adding === 'credit' && (
        <section className="rounded-2xl border border-gray-200 bg-white p-4">
          <AddBankCredits onClose={() => setAdding(null)} />
        </section>
      )}
      {!readOnly && adding === 'export' && (
        <section className="space-y-2 rounded-2xl border border-gray-200 bg-white p-4">
          <p className="text-xs font-black text-tm-navy">PayPro Orders export</p>
          <p className="text-[11px] text-gray-600">
            {data.latestUpload
              ? `Last upload: ${data.latestUpload.filename ?? 'export'} · ${formatDateTime(data.latestUpload.createdAt)}. `
              : 'No export uploaded yet. '}
            Uploading the same or an overlapping file again updates orders — it never adds them twice.
          </p>
          <div className="flex flex-wrap items-center gap-2">
            <input ref={file} type="file" accept=".xlsx,.xlsm,.csv" className="max-w-full text-xs" aria-label="PayPro Orders export" />
            <button type="button" onClick={() => void upload()} disabled={busy !== null} className={GHOST}>
              <Upload aria-hidden size={14} /> {busy === 'upload' ? 'Uploading…' : 'Upload export'}
            </button>
            <button type="button" onClick={() => setAdding(null)} className={GHOST}>
              Close
            </button>
          </div>
          {uploaded && (
            <p className="break-all text-[11px] text-slate-700" role="status">
              <span className="font-bold">
                {uploaded.newCount} new · {uploaded.updatedCount} updated · {uploaded.unknownOrders.length} unknown order number
                {uploaded.unknownOrders.length === 1 ? '' : 's'}
              </span>
              {uploaded.unknownOrders.length > 0 ? ` (not in TutorMint): ${uploaded.unknownOrders.slice(0, 30).join(', ')}${uploaded.unknownOrders.length > 30 ? '…' : ''}` : ''}
            </p>
          )}
        </section>
      )}

      <dl className="grid grid-cols-1 gap-2 sm:grid-cols-3">
        <div className={CARD}>
          <dt className="text-[11px] font-bold text-gray-600">Received</dt>
          <dd className="text-lg font-black text-tm-navy">{pkr(cards.received)}</dd>
          <dd className="text-[11px] text-gray-500">From customers, {monthName(view.month)}</dd>
        </div>
        <div className={CARD}>
          <dt className="text-[11px] font-bold text-gray-600">In the bank</dt>
          <dd className="text-lg font-black text-tm-navy">{pkr(cards.inBank)}</dd>
          <dd className="text-[11px] text-gray-500">Net settled</dd>
        </div>
        <div className={CARD}>
          <dt className="text-[11px] font-bold text-gray-600">Needs attention</dt>
          <dd className={`text-lg font-black ${cards.attention > 0 ? 'text-tm-red' : 'text-tm-green-deep'}`}>{cards.attention}</dd>
          <dd className="text-[11px] text-gray-500">{cards.attention === 1 ? 'item' : 'items'}</dd>
        </div>
      </dl>

      <nav aria-label="Filter" className="flex flex-wrap gap-2">
        {(['attention', 'good'] as const).map((g) => {
          const on = group === g
          return (
            <button
              key={g}
              type="button"
              aria-pressed={on}
              onClick={() => setGroup(g)}
              className={`inline-flex min-h-[44px] items-center gap-1.5 rounded-full border px-4 text-xs font-bold ${
                on ? 'border-tm-navy bg-tm-navy text-white' : 'border-gray-200 bg-white text-tm-navy hover:border-tm-navy'
              }`}
            >
              {g === 'attention' ? 'Needs attention' : 'All good ✅'} <span className={on ? 'text-white' : 'text-gray-500'}>{counts[g]}</span>
            </button>
          )
        })}
      </nav>

      {shown.length === 0 ? (
        empty(
          group === 'attention'
            ? data.hasExport || view.credits.length > 0
              ? `Nothing needs attention for ${monthName(view.month)}.`
              : 'Upload the PayPro export and add your bank credits to start matching.'
            : `Nothing is settled yet for ${monthName(view.month)}.`,
        )
      ) : (
        <ul className="space-y-2">{shown.map(itemRow)}</ul>
      )}

      <details open={detailsOpen} className="rounded-2xl border border-gray-200 bg-white p-4">
        <summary className="min-h-[44px] cursor-pointer text-sm font-bold text-tm-navy">Show details</summary>
        <div className="space-y-6 pt-3">
          <section className="space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <p className="text-sm font-black text-tm-navy">Full lists, {monthName(view.month)}</p>
              <a href={`/api/admin/payments/settlement/month?month=${view.month}`} className={GHOST} download>
                <Download aria-hidden size={14} /> Export CSV
              </a>
            </div>
            <div className="-mx-1 flex gap-1 overflow-x-auto px-1 pb-1" role="tablist" aria-label="Full lists">
              {detailTabs.map((t) => (
                <button
                  key={t.id}
                  type="button"
                  role="tab"
                  aria-selected={detailTab === t.id}
                  onClick={() => setDetailTab(t.id)}
                  className={`min-h-[44px] shrink-0 rounded-xl border px-3 text-xs font-bold ${
                    detailTab === t.id ? 'border-tm-navy bg-tm-navy text-white' : 'border-gray-200 bg-white text-slate-700 hover:border-tm-navy'
                  }`}
                >
                  {t.label} ({t.count})
                </button>
              ))}
            </div>
            {detailTab === 'credits' &&
              (view.credits.length === 0 ? empty('No bank credits recorded this month.') : <ul className="space-y-2">{view.credits.map((c) => creditCard(c))}</ul>)}
            {detailTab === 'orders' &&
              (view.orders.length === 0 ? empty('No PayPro orders for this month. Upload the PayPro Orders export.') : <ul className="space-y-2">{view.orders.map((o) => orderCard(o))}</ul>)}
            {detailTab === 'receipts' &&
              (view.receipts.length === 0 ? (
                empty('No approved bank transfers this month.')
              ) : (
                <ul className="space-y-2">
                  {view.receipts.map((r) => (
                    <li key={r.id} className={CARD}>
                      <div className="flex flex-wrap items-baseline justify-between gap-2">
                        <p className="break-all text-xs font-bold text-tm-navy">{r.ref}</p>
                        {r.state === 'matched' ? (
                          <span className={`${CHIP} bg-tm-tint-green text-tm-green-deep`}>✅ Matched</span>
                        ) : (
                          <span className={`${CHIP} ${r.overdue ? 'bg-tm-tint-red text-tm-red' : 'bg-tm-tint-gold text-tm-gold-ink'}`}>⏳ No bank credit yet · {r.ageDays}d</span>
                        )}
                      </div>
                      <p className="text-[11px] text-slate-700">
                        {pkr(r.amountPkr)} · approved {formatDate(r.approvedDay)}
                        {r.payerName ? ` · ${r.payerName}` : ''}
                        {r.transactionId ? ` · transaction ID ${r.transactionId}` : ''}
                      </p>
                    </li>
                  ))}
                </ul>
              ))}
          </section>

          <section className="space-y-2">
            <p className="text-sm font-black text-tm-navy">Gateway fees by method</p>
            <p className="text-[11px] text-gray-600">Gateway fees this month: {pkr(view.cards.fees)} · waiting for settlement: {pkr(view.cards.waiting)}.</p>
            {view.feeTable.length === 0 ? (
              <p className="text-[11px] text-gray-600">Fees appear once a PayPro export is uploaded.</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full min-w-[420px] text-left text-xs text-slate-700">
                  <thead>
                    <tr className="text-[11px] font-bold text-gray-600">
                      <th className="p-2">Month</th>
                      <th className="p-2">Method</th>
                      <th className="p-2">Orders</th>
                      <th className="p-2">Fee per order</th>
                      <th className="p-2">Total fees</th>
                    </tr>
                  </thead>
                  <tbody>
                    {view.feeTable.map((f) => (
                      <tr key={`${f.month}-${f.method}`} className="border-t border-gray-100">
                        <td className="p-2">{monthName(f.month)}</td>
                        <td className="p-2 font-bold">{f.method}</td>
                        <td className="p-2">{f.orders}</td>
                        <td className="p-2">
                          {[
                            ...f.perOrder.map((n) => pkr(n)),
                            ...(f.checkOrders.length > 0
                              ? [`${FEE_CHECK_WORDS} (${f.checkOrders.length} ${f.checkOrders.length === 1 ? 'order' : 'orders'}: ${f.checkOrders.join(', ')})`]
                              : []),
                          ].join(', ')}
                        </td>
                        <td className="p-2">{pkr(f.fees)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>

          {details}
        </div>
      </details>
    </div>
  )
}

/**
 * The one "Link" panel for a bank credit (owner, 21 Oct 2026): it replaced
 * "Link by hand" and "Link to member". One search finds an open PayPro order,
 * an approved bank transfer or a member. Orders and transfers are ticked and
 * saved through the same Owner-only link route as before; a member opens the
 * same "record a bank payment" form (Owner only, fresh password) as before.
 */
function LinkPanel({
  credit: c,
  data,
  busy,
  note,
  setNote,
  onSave,
  onCancel,
}: {
  credit: CreditView
  data: BoardData
  busy: boolean
  note: string
  setNote: (v: string) => void
  onSave: (orders: string[], receipts: string[]) => Promise<boolean>
  onCancel: () => void
}) {
  const m = c.match
  const [q, setQ] = useState('')
  const [pickOrders, setPickOrders] = useState<string[]>(m?.orders ?? [])
  const [pickReceipts, setPickReceipts] = useState<string[]>(m?.receipts ?? [])
  const [members, setMembers] = useState<Member[]>([])
  const [member, setMember] = useState<{ id: string; name: string } | null>(null)

  const needle = q.trim().toLowerCase()
  const orderOptions = [
    ...(m?.orders ?? []).map((n) => ({ orderNumber: n, label: n })),
    ...data.openOrders.map((o) => ({
      orderNumber: o.orderNumber,
      label: `${o.orderNumber} · ${o.method} · ${pkr(o.merchantShare)}${o.settleDate ? ` · settled ${formatDate(o.settleDate)}` : ''}`,
    })),
  ].filter((o) => !needle || pickOrders.includes(o.orderNumber) || o.label.toLowerCase().includes(needle))
  const receiptOptions = [
    ...(m?.receipts ?? []).map((id) => ({ id, label: data.receiptRefs[id] ?? id })),
    ...data.openReceipts.map((r) => ({ id: r.id, label: `${r.ref} · ${pkr(r.amountPkr)} · approved ${formatDate(r.approvedDay)}${r.payerName ? ` · ${r.payerName}` : ''}` })),
  ].filter((r) => !needle || pickReceipts.includes(r.id) || r.label.toLowerCase().includes(needle))

  useEffect(() => {
    if (member || needle.length < 2) {
      setMembers([])
      return
    }
    const ctrl = new AbortController()
    const t = setTimeout(async () => {
      try {
        const res = await fetch(`/api/admin/payments/bank-link?q=${encodeURIComponent(needle)}`, { signal: ctrl.signal })
        const d = (await res.json().catch(() => ({}))) as { members?: Member[] }
        setMembers(d.members ?? [])
      } catch {
        /* a newer keystroke cancelled it */
      }
    }, 250)
    return () => {
      clearTimeout(t)
      ctrl.abort()
    }
  }, [needle, member])

  const toggle = (list: string[], set: (v: string[]) => void, v: string) => set(list.includes(v) ? list.filter((x) => x !== v) : [...list, v])

  if (member) {
    return (
      <LinkBankCredit
        credit={{
          id: c.id,
          date: c.date,
          time: c.time,
          amountPkr: c.amountPkr,
          reference: c.reference,
          senderName: c.senderName,
          replacesReceipts: autoReceiptMatch(c.state, m) ? m!.receipts.map((id) => data.receiptRefs[id] ?? id) : [],
        }}
        initialMember={member}
        onCancel={() => {
          setMember(null)
          onCancel()
        }}
      />
    )
  }

  const picked =
    data.openOrders.filter((o) => pickOrders.includes(o.orderNumber)).reduce((s, o) => s + (o.merchantShare ?? 0), 0) +
    data.openReceipts.filter((r) => pickReceipts.includes(r.id)).reduce((s, r) => s + r.amountPkr, 0)

  return (
    <div className="space-y-2 rounded-xl border border-gray-100 bg-tm-bg p-3">
      <p className="text-xs font-bold text-tm-navy">What does this {pkr(c.amountPkr)} pay?</p>
      <label className="relative block">
        <span className="sr-only">Search for a member, an order or a payment</span>
        <Search aria-hidden size={14} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-gray-500" />
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Member name, email or mobile · order number · TM reference · amount"
          className={`${INPUT} pl-9`}
          autoFocus
        />
      </label>

      {members.length > 0 && (
        <div className="space-y-1">
          <p className={LABEL}>Members</p>
          <ul className="max-h-40 space-y-1 overflow-y-auto">
            {members.map((mm) => (
              <li key={mm.id}>
                <button
                  type="button"
                  onClick={() => setMember({ id: mm.id, name: mm.name })}
                  className="min-h-[40px] w-full rounded-lg bg-white px-2 text-left text-xs text-slate-700 hover:bg-tm-tint-navy"
                >
                  <span className="font-bold">{mm.name}</span> · {mm.role === 'tutor' ? 'Tutor' : 'Parent'}
                  {mm.city ? ` · ${mm.city}` : ''} · joined {formatDate(mm.joined)}
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}

      {orderOptions.length + receiptOptions.length > 0 ? (
        <div className="space-y-1">
          <p className={LABEL}>Orders and payments waiting for a bank credit</p>
          <div className="max-h-56 space-y-1 overflow-y-auto">
            {orderOptions.map((o) => (
              <label key={o.orderNumber} className="flex min-h-[36px] items-center gap-2 break-all text-[11px] text-slate-700">
                <input type="checkbox" checked={pickOrders.includes(o.orderNumber)} onChange={() => toggle(pickOrders, setPickOrders, o.orderNumber)} />
                {o.label}
              </label>
            ))}
            {receiptOptions.map((r) => (
              <label key={r.id} className="flex min-h-[36px] items-center gap-2 break-all text-[11px] text-slate-700">
                <input type="checkbox" checked={pickReceipts.includes(r.id)} onChange={() => toggle(pickReceipts, setPickReceipts, r.id)} />
                Bank transfer {r.label}
              </label>
            ))}
          </div>
        </div>
      ) : (
        <p className="text-[11px] text-gray-600">
          {needle ? 'No open order or payment matches that. Pick a member above if a member paid this.' : 'Nothing is waiting for a bank credit. Search for the member who paid it.'}
        </p>
      )}
      {picked > 0 && (
        <p className="text-[11px] text-slate-700">
          Newly ticked: {pkr(picked)} · this credit: {pkr(c.amountPkr)}
        </p>
      )}
      <label className="block">
        <span className={LABEL}>Note (why)</span>
        <input value={note} onChange={(e) => setNote(e.target.value)} className={INPUT} maxLength={500} />
      </label>
      <div className="flex flex-wrap gap-2">
        <button type="button" disabled={busy || pickOrders.length + pickReceipts.length === 0} onClick={() => void onSave(pickOrders, pickReceipts)} className={BUTTON}>
          {busy ? 'Saving…' : 'Save link'}
        </button>
        <button type="button" onClick={onCancel} className={GHOST}>
          Cancel
        </button>
      </div>
    </div>
  )
}
