'use client'

import { useMemo, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { Download, Link2, Plus, Upload } from 'lucide-react'

import { adminFetch } from '@/components/admin/adminFetch'
import { useToast } from '@/components/ui/Toast'
import { useAdminReadOnly } from '@/components/admin/ReadOnly'
import { formatDate, formatDateTime } from '@/lib/datetime'
import { pkr } from '@/lib/reconciliationCore'
import type { CreditView, OrderView } from '@/lib/settlementMatchCore'
import type { SettlementsBoard as BoardData } from '@/lib/settlementMatch'

import AddBankCredits from './AddBankCredits'

// Settlements (owner, 11 Oct 2026): what customers paid against what reached the
// bank, for one month. Everything shown is worked out on the server
// (lib/settlementMatchCore). The owner uploads the PayPro export, adds bank
// credits by pasting the bank's alerts (AddBankCredits), and may link, unlink or
// ignore ("not a sale") a credit by hand — a credit is never deleted; the Partner sees the same
// page with no buttons, and the server refuses their writes anyway. Nothing here
// changes a payment.

const INPUT =
  'min-h-[44px] w-full rounded-xl border border-gray-200 bg-white px-3 text-sm text-slate-800 focus:border-tm-navy focus:outline-none'
const BUTTON =
  'inline-flex min-h-[44px] items-center justify-center gap-1.5 rounded-xl bg-tm-navy px-4 text-xs font-bold text-white hover:bg-tm-navy-hover disabled:opacity-60'
const GHOST =
  'inline-flex min-h-[44px] items-center justify-center gap-1.5 rounded-xl border border-gray-200 bg-white px-4 text-xs font-bold text-slate-700 hover:border-tm-navy disabled:opacity-60'
const LABEL = 'block text-[11px] font-bold text-gray-600'
const CARD = 'space-y-1 rounded-2xl border border-gray-200 bg-white p-3'
const CHIP = 'inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-bold'

type Tab = 'attention' | 'matched' | 'orders' | 'receipts' | 'credits'

type LinkMode = 'link' | 'unlink' | 'ignore'

function monthName(ym: string): string {
  const [y, m] = ym.split('-').map(Number)
  return new Date(Date.UTC(y, m - 1, 1)).toLocaleString('en-GB', { month: 'long', year: 'numeric', timeZone: 'UTC' })
}

function orderChip(o: OrderView) {
  if (o.state === 'matched') return <span className={`${CHIP} bg-tm-tint-green text-tm-green-deep`}>✅ Matched</span>
  if (o.state === 'not_paid') return <span className={`${CHIP} bg-tm-bg text-gray-600`}>{o.transactionStatus ?? 'Not paid'}</span>
  return (
    <span className={`${CHIP} ${o.overdue ? 'bg-tm-tint-red text-tm-red' : 'bg-tm-tint-gold text-tm-gold-ink'}`}>
      ⏳ {o.state === 'waiting' ? 'Paid, not settled yet' : 'Settled, no bank credit yet'}
      {o.ageDays !== null ? ` · ${o.ageDays}d` : ''}
    </span>
  )
}

export default function SettlementsBoard({ data }: { data: BoardData }) {
  const router = useRouter()
  const toast = useToast()
  const readOnly = useAdminReadOnly()
  const { view } = data
  const [tab, setTab] = useState<Tab>('attention')
  const [busy, setBusy] = useState<string | null>(null)
  const [showCredit, setShowCredit] = useState(false)
  const [uploaded, setUploaded] = useState<{ newCount: number; updatedCount: number; unknownOrders: string[] } | null>(null)
  const [linking, setLinking] = useState<{ id: string; mode: LinkMode } | null>(null)
  const [pickOrders, setPickOrders] = useState<string[]>([])
  const [pickReceipts, setPickReceipts] = useState<string[]>([])
  const [note, setNote] = useState('')
  const file = useRef<HTMLInputElement>(null)

  const creditById = useMemo(() => new Map(view.credits.map((c) => [c.id, c])), [view.credits])

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

  const openLink = (c: CreditView, mode: LinkMode) => {
    setLinking({ id: c.id, mode })
    setPickOrders(c.match?.orders ?? [])
    setPickReceipts(c.match?.receipts ?? [])
    setNote('')
  }

  const sendLink = async (transferId: string, action: LinkMode | 'auto') => {
    setBusy(`link-${transferId}`)
    const { ok, data: d } = await adminFetch<{ error?: string }>('/api/admin/payments/settlement/links', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ transferId, action, orders: pickOrders, receipts: pickReceipts, note }),
    })
    setBusy(null)
    if (!ok) {
      toast.error(d?.error ?? 'That did not save. Please try again.')
      return
    }
    toast.success(action === 'link' ? 'Linked.' : action === 'unlink' ? 'Unlinked.' : action === 'ignore' ? 'Marked as ignored (not a sale).' : 'Back to automatic matching.')
    setLinking(null)
    router.refresh()
  }

  const toggle = (list: string[], set: (v: string[]) => void, v: string) => set(list.includes(v) ? list.filter((x) => x !== v) : [...list, v])

  const creditCard = (c: CreditView) => {
    const m = c.match
    const manual = m?.status === 'manual' || c.state === 'held' || c.state === 'ignored'
    const open = linking?.id === c.id
    // Already-linked orders stay tickable while re-linking this credit.
    const orderOptions = [
      ...(m?.orders ?? []).map((n) => ({ orderNumber: n, label: n })),
      ...data.openOrders.map((o) => ({
        orderNumber: o.orderNumber,
        label: `${o.orderNumber} · ${o.method} · ${pkr(o.merchantShare)}${o.settleDate ? ` · settled ${formatDate(o.settleDate)}` : ''}`,
      })),
    ]
    const receiptOptions = [
      ...(m?.receipts ?? []).map((id) => ({ id, label: data.receiptRefs[id] ?? id })),
      ...data.openReceipts.map((r) => ({ id: r.id, label: `${r.ref} · ${pkr(r.amountPkr)} · approved ${formatDate(r.approvedDay)}${r.payerName ? ` · ${r.payerName}` : ''}` })),
    ]
    const picked =
      orderOptions.length + receiptOptions.length > 0
        ? data.openOrders.filter((o) => pickOrders.includes(o.orderNumber)).reduce((s, o) => s + (o.merchantShare ?? 0), 0) +
          data.openReceipts.filter((r) => pickReceipts.includes(r.id)).reduce((s, r) => s + r.amountPkr, 0)
        : 0
    return (
      <li key={c.id} className={CARD}>
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <p className="text-sm font-black text-tm-navy">{pkr(c.amountPkr)}</p>
          {c.state === 'matched' ? (
            m!.status === 'amount_mismatch' ? (
              <span className={`${CHIP} bg-tm-tint-red text-tm-red`}>⚠️ Amount mismatch</span>
            ) : (
              <span className={`${CHIP} bg-tm-tint-green text-tm-green-deep`}>✅ Matched{m!.status === 'manual' ? ' by hand' : ''}</span>
            )
          ) : c.state === 'ignored' ? (
            <span className={`${CHIP} bg-tm-bg text-gray-600`}>Ignored (not a sale)</span>
          ) : (
            <span className={`${CHIP} bg-tm-tint-red text-tm-red`}>❓ Not matched</span>
          )}
        </div>
        <p className="text-xs text-slate-700">
          {formatDate(c.date)}
          {c.time ? ` · ${c.time}` : ''} · {c.senderName ?? 'Sender not recorded'}
          {c.senderBank ? ` · ${c.senderBank}` : ''}
        </p>
        <p className="break-all text-[11px] text-gray-600">
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
        {c.state === 'held' && <p className="text-[11px] text-slate-700">Unlinked by hand — it is not matched automatically.</p>}
        {c.state === 'ignored' && (
          <p className="text-[11px] text-slate-700">
            Ignored (not a sale) — it is not matched and not counted as unmatched.{c.ignoreNote ? ` Note: ${c.ignoreNote}` : ''}
          </p>
        )}
        {!readOnly && !open && (
          <div className="flex flex-wrap gap-2 pt-1">
            <button type="button" onClick={() => openLink(c, 'link')} className={GHOST}>
              <Link2 aria-hidden size={14} /> {c.state === 'matched' ? 'Change link' : 'Link by hand'}
            </button>
            {c.state === 'matched' && (
              <button type="button" onClick={() => openLink(c, 'unlink')} className={GHOST}>
                Unlink
              </button>
            )}
            {c.state !== 'ignored' && (
              <button type="button" onClick={() => openLink(c, 'ignore')} className={GHOST}>
                Ignore (not a sale)
              </button>
            )}
            {manual && (
              <button type="button" disabled={busy !== null} onClick={() => void sendLink(c.id, 'auto')} className={GHOST}>
                Back to automatic
              </button>
            )}
          </div>
        )}
        {!readOnly && open && (
          <div className="space-y-2 rounded-xl border border-gray-100 bg-tm-bg p-3">
            {linking!.mode === 'link' ? (
              <>
                <p className="text-xs font-bold text-tm-navy">What does this credit pay?</p>
                {orderOptions.length + receiptOptions.length === 0 && (
                  <p className="text-[11px] text-gray-600">Nothing is waiting for a bank credit. Upload the PayPro export first.</p>
                )}
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
                {picked > 0 && (
                  <p className="text-[11px] text-slate-700">
                    Newly ticked: {pkr(picked)} · this credit: {pkr(c.amountPkr)}
                  </p>
                )}
              </>
            ) : linking!.mode === 'unlink' ? (
              <p className="text-xs font-bold text-tm-navy">Unlink this credit? It will show as not matched.</p>
            ) : (
              <p className="text-xs font-bold text-tm-navy">
                Ignore this credit (not a sale)? It is unlinked and no longer counts as unmatched. It stays on record; &ldquo;Back to automatic&rdquo; undoes this.
              </p>
            )}
            <label className="block">
              <span className={LABEL}>Note (why)</span>
              <input value={note} onChange={(e) => setNote(e.target.value)} className={INPUT} maxLength={500} />
            </label>
            <div className="flex flex-wrap gap-2">
              <button type="button" disabled={busy !== null} onClick={() => void sendLink(c.id, linking!.mode)} className={BUTTON}>
                {busy === `link-${c.id}` ? 'Saving…' : linking!.mode === 'link' ? 'Save link' : linking!.mode === 'unlink' ? 'Unlink' : 'Ignore (not a sale)'}
              </button>
              <button type="button" onClick={() => setLinking(null)} className={GHOST}>
                Cancel
              </button>
            </div>
          </div>
        )}
      </li>
    )
  }

  const tabs: { id: Tab; label: string; count: number }[] = [
    { id: 'attention', label: 'Needs attention', count: view.attention.length },
    { id: 'matched', label: 'Matched', count: view.matched.length },
    { id: 'orders', label: 'PayPro orders', count: view.orders.length },
    { id: 'receipts', label: 'Bank transfers', count: view.receipts.length },
    { id: 'credits', label: 'Bank credits', count: view.credits.length },
  ]
  const cards: { label: string; value: string; red?: boolean }[] = [
    { label: 'Received from customers', value: pkr(view.cards.received) },
    { label: 'Gateway fees', value: pkr(view.cards.fees) },
    { label: 'Net settled to bank', value: pkr(view.cards.netSettled) },
    { label: 'Waiting for settlement', value: pkr(view.cards.waiting) },
    { label: 'Unmatched items', value: String(view.cards.unmatched), red: view.cards.unmatched > 0 },
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
            onChange={(e) => /^\d{4}-\d{2}$/.test(e.target.value) && router.push(`/admin/finance/settlement?month=${e.target.value}`)}
            className={INPUT}
          />
        </label>
        <a href={`/api/admin/payments/settlement/month?month=${view.month}`} className={GHOST} download>
          <Download aria-hidden size={14} /> Export {monthName(view.month)} (CSV)
        </a>
      </div>

      <dl className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-5">
        {cards.map((c) => (
          <div key={c.label} className={CARD}>
            <dt className="text-[11px] font-bold text-gray-600">{c.label}</dt>
            <dd className={`text-lg font-black ${c.red ? 'text-tm-red' : 'text-tm-navy'}`}>{c.value}</dd>
          </div>
        ))}
      </dl>

      {!readOnly && (
        <section className="space-y-3 rounded-2xl border border-gray-200 bg-white p-4">
          <div className="space-y-2">
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
          </div>

          <div className="space-y-2 border-t border-gray-100 pt-3">
            {!showCredit ? (
              <button type="button" onClick={() => setShowCredit(true)} className={BUTTON}>
                <Plus aria-hidden size={14} /> Add bank credit
              </button>
            ) : (
              <AddBankCredits onClose={() => setShowCredit(false)} />
            )}
          </div>
        </section>
      )}

      <div className="-mx-1 flex gap-1 overflow-x-auto px-1 pb-1" role="tablist" aria-label="Settlement lists">
        {tabs.map((t) => (
          <button
            key={t.id}
            type="button"
            role="tab"
            aria-selected={tab === t.id}
            onClick={() => setTab(t.id)}
            className={`min-h-[44px] shrink-0 rounded-xl border px-3 text-xs font-bold ${
              tab === t.id ? 'border-tm-navy bg-tm-navy text-white' : 'border-gray-200 bg-white text-slate-700 hover:border-tm-navy'
            }`}
          >
            {t.label} ({t.count})
          </button>
        ))}
      </div>

      {tab === 'attention' &&
        (view.attention.length === 0 ? (
          empty(data.hasExport || view.credits.length > 0 ? `Nothing needs attention for ${monthName(view.month)}.` : 'Upload the PayPro export and add your bank credits to start matching.')
        ) : (
          <ul className="space-y-2">
            {view.attention.map((a, i) => {
              const c = a.creditId ? creditById.get(a.creditId) : undefined
              if (c) return creditCard(c)
              return (
                <li key={`${a.kind}-${i}`} className={CARD}>
                  <p className={`break-all text-xs font-bold ${a.red ? 'text-tm-red' : 'text-tm-gold-ink'}`}>
                    {a.icon} {a.title}
                  </p>
                  <p className="break-all text-[11px] text-slate-700">
                    {a.day ? `${formatDate(a.day)} · ` : ''}
                    {a.detail}
                  </p>
                </li>
              )
            })}
          </ul>
        ))}

      {tab === 'matched' && (view.matched.length === 0 ? empty('No matched bank credits this month.') : <ul className="space-y-2">{view.matched.map(creditCard)}</ul>)}

      {tab === 'credits' && (view.credits.length === 0 ? empty('No bank credits recorded this month.') : <ul className="space-y-2">{view.credits.map(creditCard)}</ul>)}

      {tab === 'orders' &&
        (view.orders.length === 0 ? (
          empty('No PayPro orders for this month. Upload the PayPro Orders export.')
        ) : (
          <ul className="space-y-2">
            {view.orders.map((o) => (
              <li key={o.orderNumber} className={CARD}>
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                  <p className="break-all text-xs font-bold text-tm-navy">{o.orderNumber}</p>
                  {orderChip(o)}
                </div>
                <p className="text-[11px] text-slate-700">
                  {o.method} · amount {pkr(o.orderAmount)} · share {pkr(o.merchantShare)} · fee {pkr(o.fee)}
                </p>
                <p className="text-[11px] text-gray-600">
                  {o.datePaid ? `Paid ${formatDate(o.datePaid)}` : 'Not paid'}
                  {o.settleDate ? ` · settled ${formatDate(o.settleDate)}` : ''}
                  {o.settleStatus ? ` · ${o.settleStatus}` : ''}
                </p>
                {o.flags.length > 0 && (
                  <p className="text-[11px] font-bold text-tm-red">
                    ⚠️{' '}
                    {o.flags
                      .map((f) => (f === 'not_in_tutormint' ? 'Not in TutorMint' : f === 'not_approved' ? 'Not approved on TutorMint' : `TutorMint has ${pkr(o.ourAmount)}`))
                      .join(' · ')}
                  </p>
                )}
              </li>
            ))}
          </ul>
        ))}

      {tab === 'receipts' &&
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

      <section className="space-y-2 rounded-2xl border border-gray-200 bg-white p-4">
        <p className="text-xs font-black text-tm-navy">Gateway fees by method</p>
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
                    <td className="p-2">{f.perOrder.map((n) => pkr(n)).join(', ')}</td>
                    <td className="p-2">{pkr(f.fees)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  )
}
