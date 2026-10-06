'use client'

import { useRef, useState, type FormEvent } from 'react'
import { useRouter } from 'next/navigation'
import { Banknote, CheckCircle2, FileSpreadsheet, Landmark, Scale, Upload } from 'lucide-react'

import { adminFetch } from '@/components/admin/adminFetch'
import { useToast } from '@/components/ui/Toast'
import { formatDate, formatDateTime } from '@/lib/datetime'
import { pkr, type Flag } from '@/lib/reconciliationCore'
import type { ReconciliationView } from '@/lib/reconciliation'

// The PayPro reconciliation screen. Everything it shows is computed by
// lib/reconciliationCore from the latest uploaded export, our payments and the
// bank transfers. Uploads use plain fetch (multipart); the typed transfer uses
// adminFetch (JSON). Nothing on this screen can change a payment's status.

const CARD = 'rounded-2xl border border-gray-200 bg-white p-4'
const INPUT =
  'min-h-[44px] w-full rounded-xl border border-gray-200 bg-white px-3 text-sm text-slate-800 focus:border-tm-navy focus:outline-none'
const BUTTON =
  'inline-flex min-h-[44px] items-center justify-center gap-1.5 rounded-xl bg-tm-navy px-4 text-sm font-bold text-white hover:bg-tm-navy-hover disabled:opacity-60'
const LABEL = 'block text-[11px] font-bold uppercase tracking-wide text-gray-500'

export default function ReconciliationClient({ view }: { view: ReconciliationView }) {
  const router = useRouter()
  const toast = useToast()
  const { period, latestImport, summary, matches, transfers } = view

  const [from, setFrom] = useState(period.from)
  const [to, setTo] = useState(period.to)
  const [busy, setBusy] = useState<'paypro' | 'bank' | 'transfer' | null>(null)
  const payproFile = useRef<HTMLInputElement>(null)
  const bankFile = useRef<HTMLInputElement>(null)

  const [transfer, setTransfer] = useState({ transferredOn: '', amountPkr: '', reference: '', accountLast4: '' })

  const showPeriod = (f: string, t: string) => {
    setFrom(f)
    setTo(t)
    if (/^\d{4}-\d{2}-\d{2}$/.test(f) && /^\d{4}-\d{2}-\d{2}$/.test(t)) {
      router.push(`/admin/payments/reconciliation?from=${f}&to=${t}`)
    }
  }

  const upload = async (kind: 'paypro' | 'bank', input: HTMLInputElement | null) => {
    const file = input?.files?.[0]
    if (!file) {
      toast.error(kind === 'paypro' ? 'Choose the PayPro file first.' : 'Choose the bank statement CSV first.')
      return
    }
    setBusy(kind)
    const body = new FormData()
    body.append('kind', kind)
    body.append('file', file)
    try {
      const res = await fetch('/api/admin/payments/reconciliation', { method: 'POST', body })
      const data = (await res.json().catch(() => ({}))) as {
        error?: string
        rowCount?: number
        added?: number
        skipped?: number
      }
      if (!res.ok) {
        toast.error(data.error ?? 'Upload failed.')
      } else if (kind === 'paypro') {
        toast.success(`PayPro file read: ${data.rowCount ?? 0} orders.`)
      } else {
        const skipped = data.skipped ? ` (${data.skipped} already recorded)` : ''
        toast.success(`${data.added ?? 0} transfers added${skipped}.`)
      }
      if (res.ok) {
        if (input) input.value = ''
        router.refresh()
      }
    } catch {
      toast.error('Could not reach the server.')
    } finally {
      setBusy(null)
    }
  }

  const saveTransfer = async (e: FormEvent) => {
    e.preventDefault()
    setBusy('transfer')
    const { ok, data } = await adminFetch<{ error?: string }>('/api/admin/payments/reconciliation', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        action: 'transfer',
        transferredOn: transfer.transferredOn,
        amountPkr: transfer.amountPkr,
        reference: transfer.reference || null,
        accountLast4: transfer.accountLast4 || null,
      }),
    })
    setBusy(null)
    if (ok) {
      toast.success('Transfer recorded.')
      setTransfer({ transferredOn: '', amountPkr: '', reference: '', accountLast4: '' })
      router.refresh()
    } else {
      toast.error(data?.error ?? 'Could not record the transfer.')
    }
  }

  const owedTone = summary.owed > 0 ? 'text-tm-red' : 'text-tm-green-deep'

  return (
    <div className="space-y-5">
      <header className="space-y-1">
        <h1 className="flex items-center gap-2 text-lg font-black text-tm-navy">
          <Scale aria-hidden size={18} />
          PayPro reconciliation
        </h1>
        <p className="text-xs text-gray-500">
          Upload PayPro&rsquo;s Orders export and compare it with our payments and the bank. This screen only
          reports — approve or reject a payment in the payments queue.
        </p>
      </header>

      {/* Period */}
      <section className={`${CARD} flex flex-wrap items-end gap-3`}>
        <div className="min-w-[160px] flex-1">
          <label htmlFor="rec-from" className={LABEL}>
            From
          </label>
          <input id="rec-from" type="date" value={from} onChange={(e) => showPeriod(e.target.value, to)} className={INPUT} />
        </div>
        <div className="min-w-[160px] flex-1">
          <label htmlFor="rec-to" className={LABEL}>
            To
          </label>
          <input id="rec-to" type="date" value={to} onChange={(e) => showPeriod(from, e.target.value)} className={INPUT} />
        </div>
        <p className="min-h-[44px] flex-[2] self-center text-xs text-gray-500">
          {latestImport ? (
            <>
              Latest PayPro file: <span className="font-bold text-slate-800">{latestImport.filename ?? 'export'}</span>
              {latestImport.sheet ? ` · sheet “${latestImport.sheet}”` : ''} · {latestImport.rowCount.toLocaleString('en-PK')} orders
              {latestImport.periodFrom && latestImport.periodTo
                ? ` · paid ${formatDate(latestImport.periodFrom)} – ${formatDate(latestImport.periodTo)}`
                : ''}{' '}
              · uploaded {formatDateTime(latestImport.createdAt)}
            </>
          ) : (
            'No PayPro file uploaded yet.'
          )}
        </p>
      </section>

      {/* Uploads */}
      <section className="grid gap-3 md:grid-cols-2">
        <div className={`${CARD} space-y-3`}>
          <h2 className="flex items-center gap-2 text-sm font-bold text-tm-navy">
            <FileSpreadsheet aria-hidden size={16} />
            Upload the PayPro file
          </h2>
          <p className="text-xs text-gray-500">
            The Orders export from the PayPro merchant portal, as .xlsx or .csv. Only the order columns are kept —
            no customer names, mobiles or emails are stored.
          </p>
          <input
            ref={payproFile}
            type="file"
            accept=".xlsx,.xlsm,.csv"
            aria-label="PayPro Orders export"
            className="block w-full text-sm text-slate-800 file:mr-3 file:min-h-[44px] file:rounded-xl file:border-0 file:bg-tm-tint-navy file:px-4 file:text-sm file:font-bold file:text-tm-navy"
          />
          <button type="button" className={BUTTON} disabled={busy !== null} onClick={() => upload('paypro', payproFile.current)}>
            <Upload aria-hidden size={14} />
            {busy === 'paypro' ? 'Reading…' : 'Upload PayPro file'}
          </button>
        </div>

        <div className={`${CARD} space-y-3`}>
          <h2 className="flex items-center gap-2 text-sm font-bold text-tm-navy">
            <Landmark aria-hidden size={16} />
            Upload a bank statement
          </h2>
          <p className="text-xs text-gray-500">
            A CSV from the bank. Credits are read by their date and amount; only the last 4 digits of an account
            number are kept. A line already recorded is skipped.
          </p>
          <input
            ref={bankFile}
            type="file"
            accept=".csv,.txt"
            aria-label="Bank statement CSV"
            className="block w-full text-sm text-slate-800 file:mr-3 file:min-h-[44px] file:rounded-xl file:border-0 file:bg-tm-tint-navy file:px-4 file:text-sm file:font-bold file:text-tm-navy"
          />
          <button type="button" className={BUTTON} disabled={busy !== null} onClick={() => upload('bank', bankFile.current)}>
            <Upload aria-hidden size={14} />
            {busy === 'bank' ? 'Reading…' : 'Upload bank CSV'}
          </button>
        </div>
      </section>

      {/* Summary tiles */}
      <section className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Tile label="Total collected by PayPro" value={pkr(summary.collected)} sub={`${summary.paidCount} paid orders in this period`} />
        <Tile label="Expected from PayPro" value={pkr(summary.expected)} sub="Merchant share of those orders" />
        <Tile label="Transfers received" value={pkr(summary.transfersReceived)} sub={`${summary.transferCount} bank transfers in this period`} />
        <Tile
          label={summary.owed > 0 ? 'Still owed by PayPro' : 'Difference'}
          value={pkr(summary.owed)}
          sub={summary.owed > 0 ? 'PayPro owes us this amount' : summary.owed < 0 ? 'We received more than expected' : 'Everything is settled'}
          tone={owedTone}
        />
      </section>

      {/* Flags */}
      <FlagTable
        title="Paid at PayPro, not approved here"
        intro="PayPro says these were paid, but our payment is missing or not approved. Check them in the payments queue."
        rows={matches.paidNotApproved}
        empty="None — every paid order is approved."
        tone="red"
      />
      <FlagTable
        title="Approved here, not paid at PayPro"
        intro="We approved these, but PayPro's file does not show them as paid (or does not list them at all)."
        rows={matches.approvedNotPaid}
        empty="None — every approved payment is paid at PayPro."
        tone="red"
      />
      <FlagTable
        title="Amounts that differ"
        intro="Both sides have the order, but the amounts are not the same."
        rows={matches.amountDifferences}
        empty="None — every matched amount agrees."
        tone="gold"
      />

      <section className={`${CARD} flex items-center gap-2 text-sm text-tm-green-deep`}>
        <CheckCircle2 aria-hidden size={16} />
        <span>
          <span className="font-bold">{matches.matched.length.toLocaleString('en-PK')}</span> orders agree on both sides (paid,
          approved, same amount). Our side: {view.paymentCount.toLocaleString('en-PK')} PayPro payments; the file:{' '}
          {view.rowCount.toLocaleString('en-PK')} orders.
        </span>
      </section>

      {/* Record a transfer */}
      <section className={`${CARD} space-y-3`}>
        <h2 className="flex items-center gap-2 text-sm font-bold text-tm-navy">
          <Banknote aria-hidden size={16} />
          Record a bank transfer
        </h2>
        <p className="text-xs text-gray-500">Money PayPro sent to our bank. Type it in from the bank app or statement.</p>
        <form onSubmit={saveTransfer} className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
          <div>
            <label htmlFor="tr-date" className={LABEL}>
              Date received
            </label>
            <input
              id="tr-date"
              type="date"
              required
              value={transfer.transferredOn}
              onChange={(e) => setTransfer({ ...transfer, transferredOn: e.target.value })}
              className={INPUT}
            />
          </div>
          <div>
            <label htmlFor="tr-amount" className={LABEL}>
              Amount (Rs)
            </label>
            <input
              id="tr-amount"
              inputMode="decimal"
              required
              placeholder="1500"
              value={transfer.amountPkr}
              onChange={(e) => setTransfer({ ...transfer, amountPkr: e.target.value })}
              className={INPUT}
            />
          </div>
          <div>
            <label htmlFor="tr-ref" className={LABEL}>
              Reference
            </label>
            <input
              id="tr-ref"
              placeholder="Bank reference or note"
              value={transfer.reference}
              onChange={(e) => setTransfer({ ...transfer, reference: e.target.value })}
              className={INPUT}
            />
          </div>
          <div>
            <label htmlFor="tr-last4" className={LABEL}>
              Account (last 4 digits)
            </label>
            <input
              id="tr-last4"
              inputMode="numeric"
              pattern="[0-9]{4}"
              maxLength={4}
              placeholder="4821"
              value={transfer.accountLast4}
              onChange={(e) => setTransfer({ ...transfer, accountLast4: e.target.value.replace(/\D/g, '').slice(0, 4) })}
              className={INPUT}
            />
          </div>
          <div className="flex items-end">
            <button type="submit" className={`${BUTTON} w-full`} disabled={busy !== null}>
              {busy === 'transfer' ? 'Saving…' : 'Record transfer'}
            </button>
          </div>
        </form>
      </section>

      {/* Settlements */}
      <section className={`${CARD} space-y-3`}>
        <h2 className="text-sm font-bold text-tm-navy">Settlements</h2>
        {summary.settlementMatches.length === 0 ? (
          <p className="text-xs text-gray-500">No orders in this period carry a Settle-Date yet.</p>
        ) : (
          <>
            <p className="text-xs text-gray-500">
              For each order, whether the bank received at least the merchant share settling on that date.
            </p>
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead>
                  <tr className="text-[11px] uppercase tracking-wide text-gray-500">
                    <th className="py-2 pr-3">Order-Number</th>
                    <th className="py-2 pr-3">Settle date</th>
                    <th className="py-2 pr-3">PayPro status</th>
                    <th className="py-2 pr-3">Merchant share</th>
                    <th className="py-2 pr-3">Bank received that day</th>
                    <th className="py-2">In the bank?</th>
                  </tr>
                </thead>
                <tbody>
                  {summary.settlementMatches.map((s) => (
                    <tr key={`${s.orderNumber}-${s.settleDate}`} className="border-t border-gray-100 text-slate-800">
                      <td className="py-2 pr-3 font-mono">{s.orderNumber}</td>
                      <td className="py-2 pr-3">{formatDate(s.settleDate)}</td>
                      <td className="py-2 pr-3">{s.settleStatus ?? '—'}</td>
                      <td className="py-2 pr-3">{pkr(s.merchantShare)}</td>
                      <td className="py-2 pr-3">
                        {pkr(s.transferredThatDay)} <span className="text-gray-500">of {pkr(s.shareThatDay)}</span>
                      </td>
                      <td className="py-2">
                        {s.covered ? (
                          <span className="rounded-full bg-tm-tint-green px-2 py-0.5 font-bold text-tm-green-deep">Yes</span>
                        ) : (
                          <span className="rounded-full bg-tm-tint-red px-2 py-0.5 font-bold text-tm-red">Not yet</span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}
      </section>

      {/* Transfers list */}
      <section className={`${CARD} space-y-3`}>
        <h2 className="text-sm font-bold text-tm-navy">Bank transfers recorded</h2>
        {transfers.length === 0 ? (
          <p className="text-xs text-gray-500">No transfers recorded yet. Add one above or upload a statement.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead>
                <tr className="text-[11px] uppercase tracking-wide text-gray-500">
                  <th className="py-2 pr-3">Date</th>
                  <th className="py-2 pr-3">Amount</th>
                  <th className="py-2 pr-3">Reference</th>
                  <th className="py-2 pr-3">Account</th>
                  <th className="py-2">How it was recorded</th>
                </tr>
              </thead>
              <tbody>
                {transfers.slice(0, 100).map((t) => (
                  <tr key={t.id} className="border-t border-gray-100 text-slate-800">
                    <td className="py-2 pr-3">{formatDate(t.transferredOn)}</td>
                    <td className="py-2 pr-3 font-bold">{pkr(t.amountPkr)}</td>
                    <td className="py-2 pr-3">{t.reference ?? '—'}</td>
                    <td className="py-2 pr-3">{t.accountLast4 ? `•••• ${t.accountLast4}` : '—'}</td>
                    <td className="py-2">{t.source === 'csv' ? 'Bank statement' : 'Typed in'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            {transfers.length > 100 && (
              <p className="pt-2 text-[11px] text-gray-500">Showing the latest 100 of {transfers.length.toLocaleString('en-PK')}.</p>
            )}
          </div>
        )}
      </section>
    </div>
  )
}

function Tile({ label, value, sub, tone = 'text-tm-navy' }: { label: string; value: string; sub: string; tone?: string }) {
  return (
    <div className={`${CARD} [color-scheme:light]`}>
      <p className="text-[11px] font-bold uppercase tracking-wide text-gray-500">{label}</p>
      <p className={`mt-1 text-2xl font-black ${tone}`}>{value}</p>
      <p className="mt-1 text-[11px] text-gray-500">{sub}</p>
    </div>
  )
}

function FlagTable({
  title,
  intro,
  rows,
  empty,
  tone,
}: {
  title: string
  intro: string
  rows: Flag[]
  empty: string
  tone: 'red' | 'gold'
}) {
  const badge = tone === 'red' ? 'bg-tm-tint-red text-tm-red' : 'bg-tm-tint-gold text-tm-gold-ink'
  return (
    <section className={`${CARD} space-y-3`}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-sm font-bold text-tm-navy">{title}</h2>
        <span className={`rounded-full px-3 py-1 text-xs font-black ${rows.length === 0 ? 'bg-tm-tint-green text-tm-green-deep' : badge}`}>
          {rows.length.toLocaleString('en-PK')}
        </span>
      </div>
      <p className="text-xs text-gray-500">{intro}</p>
      {rows.length === 0 ? (
        <p className="text-xs font-bold text-tm-green-deep">{empty}</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead>
              <tr className="text-[11px] uppercase tracking-wide text-gray-500">
                <th className="py-2 pr-3">Order-Number</th>
                <th className="py-2 pr-3">Our status</th>
                <th className="py-2 pr-3">PayPro status</th>
                <th className="py-2 pr-3">PayPro amount</th>
                <th className="py-2 pr-3">Our amount</th>
                <th className="py-2">Date paid</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.orderNumber} className="border-t border-gray-100 text-slate-800">
                  <td className="py-2 pr-3 font-mono">{r.orderNumber}</td>
                  <td className="py-2 pr-3">{r.ourStatus ?? <span className="text-tm-red">no payment row</span>}</td>
                  <td className="py-2 pr-3">{r.payproStatus ?? <span className="text-tm-red">not in file</span>}</td>
                  <td className="py-2 pr-3">{pkr(r.orderAmount)}</td>
                  <td className="py-2 pr-3">{pkr(r.amountPkr)}</td>
                  <td className="py-2">{r.datePaid ? formatDate(r.datePaid) : '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  )
}
