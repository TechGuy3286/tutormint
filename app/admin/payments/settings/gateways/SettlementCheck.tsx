'use client'

import { useRef, useState, type FormEvent } from 'react'
import { useRouter } from 'next/navigation'
import { Download, Upload } from 'lucide-react'

import { adminFetch } from '@/components/admin/adminFetch'
import { useToast } from '@/components/ui/Toast'
import { useConfirm } from '@/components/ui/ConfirmDialog'
import { formatDate, formatDateTime } from '@/lib/datetime'
import { pkr } from '@/lib/reconciliationCore'
import type { SettlementFlag } from '@/lib/settlementCore'
import type { SettlementView } from '@/lib/settlement'

// Settlement check for one connected gateway (owner, 6 Oct 2026). Everything
// shown is computed on the server (lib/settlementCore) for the chosen range,
// Pakistan time. Uploads post multipart; the rest goes through adminFetch. Nothing
// here changes a payment's status — mismatches are listed only.

const INPUT =
  'min-h-[44px] w-full rounded-xl border border-gray-200 bg-white px-3 text-sm text-slate-800 focus:border-tm-navy focus:outline-none'
const BUTTON =
  'inline-flex min-h-[44px] items-center justify-center gap-1.5 rounded-xl bg-tm-navy px-4 text-xs font-bold text-white hover:bg-tm-navy-hover disabled:opacity-60'
const GHOST =
  'inline-flex min-h-[44px] items-center justify-center gap-1.5 rounded-xl border border-gray-200 bg-white px-4 text-xs font-bold text-slate-700 hover:border-tm-navy disabled:opacity-60'
const LABEL = 'block text-[11px] font-bold text-gray-600'
const SUB = 'space-y-2 rounded-xl border border-gray-100 bg-tm-bg p-3'

function FlagList({ title, rows }: { title: string; rows: SettlementFlag[] }) {
  if (rows.length === 0) return null
  return (
    <div className="space-y-1">
      <p className="text-[11px] font-bold text-tm-red">
        {title} ({rows.length})
      </p>
      <ul className="space-y-0.5 text-[11px] text-slate-700">
        {rows.map((f) => (
          <li key={`${title}-${f.ref}`} className="break-all">
            {f.ref}
            {f.day ? ` · ${formatDate(f.day)}` : ''}
            {f.ourAmount !== null ? ` · ours ${pkr(f.ourAmount)}` : ''}
            {f.gatewayAmount !== null ? ` · gateway ${pkr(f.gatewayAmount)}` : ''}
          </li>
        ))}
      </ul>
    </div>
  )
}

export default function SettlementCheck({ view, gatewayName }: { view: SettlementView; gatewayName: string }) {
  const router = useRouter()
  const toast = useToast()
  const confirm = useConfirm()
  const r = view.result
  const [from, setFrom] = useState(r.from)
  const [to, setTo] = useState(r.to)
  const [busy, setBusy] = useState<string | null>(null)
  const gatewayFile = useRef<HTMLInputElement>(null)
  const bankFile = useRef<HTMLInputElement>(null)
  const [transfer, setTransfer] = useState({ transferredOn: '', amountPkr: '', reference: '', accountLast4: '' })
  const [ded, setDed] = useState({ name: '', percent: '', fixedPkr: '', effectiveFrom: '' })

  const showRange = (e: FormEvent) => {
    e.preventDefault()
    if (!/^\d{4}-\d{2}-\d{2}$/.test(from) || !/^\d{4}-\d{2}-\d{2}$/.test(to)) {
      toast.error('Choose both dates.')
      return
    }
    router.push(`/admin/payments/settings/gateways?from=${from}&to=${to}`)
  }

  const upload = async (kind: 'gateway' | 'bank', input: HTMLInputElement | null) => {
    const file = input?.files?.[0]
    if (!file) {
      toast.error(kind === 'gateway' ? `Choose the ${gatewayName} file first.` : 'Choose the bank statement CSV first.')
      return
    }
    setBusy(kind)
    const body = new FormData()
    body.append('kind', kind)
    body.append('gateway', view.gateway)
    body.append('file', file)
    try {
      const res = await fetch('/api/admin/payments/settlement', { method: 'POST', body })
      const data = (await res.json().catch(() => ({}))) as { error?: string; rowCount?: number; added?: number; skipped?: number }
      if (!res.ok) toast.error(data.error ?? 'That upload did not go through. Please try again.')
      else if (kind === 'gateway') toast.success(`${gatewayName} file read: ${data.rowCount ?? 0} orders.`)
      else toast.success(`${data.added ?? 0} transfers added${data.skipped ? ` (${data.skipped} already recorded)` : ''}.`)
      if (res.ok) {
        if (input) input.value = ''
        router.refresh()
      }
    } catch {
      toast.error('We could not reach TutorMint. Check your internet connection and try again.')
    } finally {
      setBusy(null)
    }
  }

  const post = async (key: string, body: Record<string, unknown>, done: string): Promise<boolean> => {
    setBusy(key)
    const { ok, data } = await adminFetch<{ error?: string }>('/api/admin/payments/settlement', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ gateway: view.gateway, ...body }),
    })
    setBusy(null)
    if (!ok) {
      toast.error(data?.error ?? 'That did not save. Please try again.')
      return false
    }
    toast.success(done)
    router.refresh()
    return true
  }

  const saveTransfer = async (e: FormEvent) => {
    e.preventDefault()
    const ok = await post(
      'transfer',
      {
        action: 'transfer',
        transferredOn: transfer.transferredOn,
        amountPkr: transfer.amountPkr,
        reference: transfer.reference || null,
        accountLast4: transfer.accountLast4 || null,
      },
      'Transfer recorded.',
    )
    if (ok) setTransfer({ transferredOn: '', amountPkr: '', reference: '', accountLast4: '' })
  }

  const saveDeduction = async (e: FormEvent) => {
    e.preventDefault()
    const ok = await post(
      'deduction',
      { action: 'add_deduction', name: ded.name, percent: ded.percent || null, fixedPkr: ded.fixedPkr || null, effectiveFrom: ded.effectiveFrom },
      'Deduction line added.',
    )
    if (ok) setDed({ name: '', percent: '', fixedPkr: '', effectiveFrom: '' })
  }

  const removeLine = async (id: string, name: string) => {
    const ok = await confirm({
      title: `Remove “${name}”?`,
      body: 'It stops applying to every period, past and future. The record is kept in the audit log.',
      confirmLabel: 'Remove',
    })
    if (!ok) return
    await post(`remove-${id}`, { action: 'remove_deduction', id }, 'Deduction line removed.')
  }

  const exportHref = `/api/admin/payments/settlement/export?gateway=${view.gateway}&from=${r.from}&to=${r.to}`

  return (
    <div className="space-y-3 border-t border-gray-100 pt-3">
      <h3 className="text-sm font-black text-tm-navy">Settlement check</h3>

      <form onSubmit={showRange} className="flex flex-wrap items-end gap-2">
        <label className="min-w-[140px] flex-1">
          <span className={LABEL}>From (Pakistan time)</span>
          <input type="date" value={from} onChange={(e) => setFrom(e.target.value)} className={INPUT} />
        </label>
        <label className="min-w-[140px] flex-1">
          <span className={LABEL}>To</span>
          <input type="date" value={to} onChange={(e) => setTo(e.target.value)} className={INPUT} />
        </label>
        <button type="submit" className={BUTTON}>
          Show
        </button>
      </form>

      {/* TutorMint side — calculated, no upload. */}
      <div className={SUB}>
        <p className="text-xs font-black text-tm-navy">TutorMint side</p>
        <p className="text-xs text-slate-700">
          {r.ourCount} approved payment{r.ourCount === 1 ? '' : 's'} · {pkr(r.ourTotal)}
        </p>
        <a href={exportHref} className={GHOST} download>
          <Download aria-hidden size={14} /> Download (.xlsx)
        </a>
      </div>

      {/* Gateway side — the gateway's own file. */}
      <div className={SUB}>
        <p className="text-xs font-black text-tm-navy">{gatewayName} side</p>
        <p className="text-[11px] text-gray-600">
          {view.latestImport
            ? `Latest file: ${view.latestImport.filename ?? 'export'} · ${view.latestImport.rowCount} orders · uploaded ${formatDateTime(view.latestImport.createdAt)}.`
            : `No ${gatewayName} file uploaded yet. Upload the Orders export (.xlsx or .csv) for this range.`}
        </p>
        {r.hasGatewayFile && (
          <p className="text-xs text-slate-700">
            {r.gatewayCount} paid order{r.gatewayCount === 1 ? '' : 's'} in the range · reported {pkr(r.gatewayReported)} (MerchantShare)
          </p>
        )}
        <div className="flex flex-wrap items-center gap-2">
          <input ref={gatewayFile} type="file" accept=".xlsx,.xlsm,.csv" className="max-w-full text-xs" aria-label={`${gatewayName} file`} />
          <button type="button" onClick={() => void upload('gateway', gatewayFile.current)} disabled={busy !== null} className={GHOST}>
            <Upload aria-hidden size={14} /> {busy === 'gateway' ? 'Uploading…' : 'Upload gateway file'}
          </button>
        </div>
        <FlagList title={`Paid at ${gatewayName}, not approved on TutorMint`} rows={r.paidNotApproved} />
        <FlagList title={`Approved on TutorMint, not paid at ${gatewayName}`} rows={r.approvedNotPaid} />
        <FlagList title="Amounts that differ" rows={r.amountDifferences} />
        {r.hasGatewayFile && r.paidNotApproved.length + r.approvedNotPaid.length + r.amountDifferences.length === 0 && (
          <p className="text-[11px] font-bold text-tm-green-deep">Every payment in this range matches.</p>
        )}
      </div>

      {/* Deductions — owner-editable, by effective date. */}
      <div className={SUB}>
        <p className="text-xs font-black text-tm-navy">Deductions</p>
        <p className="text-[11px] text-gray-600">
          Applied to each payment with the line in effect on that payment&rsquo;s date. To change a rate, add a new line with the
          same name and a later start date — earlier periods keep the old rate.
        </p>
        {view.deductions.length === 0 ? (
          <p className="text-[11px] text-gray-500">No deduction lines yet.</p>
        ) : (
          <ul className="divide-y divide-gray-200">
            {view.deductions.map((d) => (
              <li key={d.id} className="flex flex-wrap items-center justify-between gap-2 py-1.5 text-xs text-slate-700">
                <span>
                  <span className="font-bold">{d.name}</span>
                  {d.percent !== null ? ` · ${d.percent}%` : ''}
                  {d.fixedPkr !== null ? ` · ${pkr(d.fixedPkr)} per payment` : ''} · from {formatDate(d.effectiveFrom)}
                </span>
                <button type="button" onClick={() => void removeLine(d.id, d.name)} disabled={busy !== null} className="min-h-[36px] text-[11px] font-bold text-tm-red hover:underline">
                  Remove
                </button>
              </li>
            ))}
          </ul>
        )}
        <form onSubmit={saveDeduction} className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          <label className="col-span-2 sm:col-span-1">
            <span className={LABEL}>Name</span>
            <input value={ded.name} onChange={(e) => setDed({ ...ded, name: e.target.value })} placeholder="PayPro fee" className={INPUT} />
          </label>
          <label>
            <span className={LABEL}>Percent</span>
            <input value={ded.percent} onChange={(e) => setDed({ ...ded, percent: e.target.value })} inputMode="decimal" placeholder="2.5" className={INPUT} />
          </label>
          <label>
            <span className={LABEL}>Fixed (Rs)</span>
            <input value={ded.fixedPkr} onChange={(e) => setDed({ ...ded, fixedPkr: e.target.value })} inputMode="decimal" placeholder="0" className={INPUT} />
          </label>
          <label className="col-span-2 sm:col-span-1">
            <span className={LABEL}>Effective from</span>
            <input type="date" value={ded.effectiveFrom} onChange={(e) => setDed({ ...ded, effectiveFrom: e.target.value })} className={INPUT} />
          </label>
          <button type="submit" disabled={busy !== null} className={`${BUTTON} col-span-2 sm:col-span-4`}>
            {busy === 'deduction' ? 'Saving…' : 'Add deduction line'}
          </button>
        </form>
      </div>

      {/* Bank transfers — the existing records, entered or uploaded here. */}
      <div className={SUB}>
        <p className="text-xs font-black text-tm-navy">Bank transfers</p>
        {view.transfers.length === 0 ? (
          <p className="text-[11px] text-gray-500">No transfers recorded in this range.</p>
        ) : (
          <ul className="space-y-0.5 text-[11px] text-slate-700">
            {view.transfers.map((t) => (
              <li key={t.id}>
                {formatDate(t.transferredOn)} · {pkr(t.amountPkr)}
                {t.reference ? ` · ${t.reference}` : ''}
                {t.accountLast4 ? ` · ••••${t.accountLast4}` : ''}
              </li>
            ))}
          </ul>
        )}
        <form onSubmit={saveTransfer} className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          <label>
            <span className={LABEL}>Date</span>
            <input type="date" value={transfer.transferredOn} onChange={(e) => setTransfer({ ...transfer, transferredOn: e.target.value })} className={INPUT} />
          </label>
          <label>
            <span className={LABEL}>Amount (Rs)</span>
            <input value={transfer.amountPkr} onChange={(e) => setTransfer({ ...transfer, amountPkr: e.target.value })} inputMode="decimal" className={INPUT} />
          </label>
          <label>
            <span className={LABEL}>Reference</span>
            <input value={transfer.reference} onChange={(e) => setTransfer({ ...transfer, reference: e.target.value })} className={INPUT} />
          </label>
          <label>
            <span className={LABEL}>Last 4 digits</span>
            <input value={transfer.accountLast4} onChange={(e) => setTransfer({ ...transfer, accountLast4: e.target.value })} inputMode="numeric" maxLength={4} className={INPUT} />
          </label>
          <button type="submit" disabled={busy !== null} className={`${BUTTON} col-span-2 sm:col-span-4`}>
            {busy === 'transfer' ? 'Saving…' : 'Record transfer'}
          </button>
        </form>
        <div className="flex flex-wrap items-center gap-2">
          <input ref={bankFile} type="file" accept=".csv,.txt" className="max-w-full text-xs" aria-label="Bank statement CSV" />
          <button type="button" onClick={() => void upload('bank', bankFile.current)} disabled={busy !== null} className={GHOST}>
            <Upload aria-hidden size={14} /> {busy === 'bank' ? 'Uploading…' : 'Upload bank statement'}
          </button>
        </div>
      </div>

      {/* Per settle date (owner, 8 Oct 2026) — only when the file has Settle-Dates. */}
      {view.perSettle && (
        <div className={SUB}>
          <p className="text-xs font-black text-tm-navy">By settle date</p>
          <p className="text-[11px] text-gray-600">
            Each settle date&rsquo;s MerchantShare total against the nearest bank transfer within 2 days. A shortfall of Rs 2 or
            less is a bank charge, not missing money.
          </p>
          {view.perSettle.groups.length === 0 ? (
            <p className="text-[11px] text-gray-500">No orders settled in this range.</p>
          ) : (
            <ul className="divide-y divide-gray-200">
              {view.perSettle.groups.map((g) => (
                <li key={g.settleDate} className="flex flex-wrap items-baseline justify-between gap-2 py-1.5 text-xs text-slate-700">
                  <span>
                    <span className="font-bold">Settled {formatDate(g.settleDate)}</span> · {g.orderCount} order{g.orderCount === 1 ? '' : 's'} ·{' '}
                    {pkr(g.merchantShare)}
                    {g.transfer ? ` · transfer ${formatDate(g.transfer.transferredOn)} ${pkr(g.transfer.amountPkr)}` : ' · no transfer within 2 days'}
                  </span>
                  <span
                    className={`font-black ${
                      g.status === 'missing' ? 'text-tm-red' : g.status === 'over' ? 'text-tm-navy' : 'text-tm-green-deep'
                    }`}
                  >
                    {g.status === 'matched' && 'Matched'}
                    {g.status === 'bank_charge' && `Matched · ${pkr(g.bankCharge)} bank charge`}
                    {g.status === 'over' && `${pkr(g.difference ?? 0)} more than expected`}
                    {g.status === 'missing' && (g.difference === null ? 'Missing' : `${pkr(-(g.difference ?? 0))} missing`)}
                  </span>
                </li>
              ))}
            </ul>
          )}
          <p className="pt-1 text-xs font-black text-tm-navy">Due from {gatewayName}</p>
          {view.perSettle.due.length === 0 ? (
            <p className="text-[11px] font-bold text-tm-green-deep">Every paid order has been settled.</p>
          ) : (
            <ul className="space-y-0.5 text-[11px]">
              {view.perSettle.due.map((d) => (
                <li key={d.orderNumber} className={d.overdue ? 'font-bold text-tm-red' : 'text-slate-700'}>
                  {d.orderNumber} · {d.merchantShare !== null ? pkr(d.merchantShare) : '—'}
                  {d.datePaid ? ` · paid ${formatDate(d.datePaid)}` : ''}
                  {d.ageDays !== null ? ` · ${d.ageDays} day${d.ageDays === 1 ? '' : 's'} old` : ''}
                  {d.overdue ? ' · overdue' : ''}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      {/* The result for the range. */}
      <dl className="space-y-1 rounded-xl border border-gray-200 bg-white p-3 text-xs">
        <div className="flex justify-between gap-3"><dt className="text-gray-600">TutorMint collected</dt><dd className="font-bold text-slate-800">{pkr(r.ourTotal)}</dd></div>
        <div className="flex justify-between gap-3">
          <dt className="text-gray-600">{gatewayName} reported</dt>
          <dd className="font-bold text-slate-800">{r.hasGatewayFile ? `${pkr(r.gatewayReported)}` : 'No file yet'}</dd>
        </div>
        {r.deductionLines.map((l) => (
          <div key={l.name} className="flex justify-between gap-3"><dt className="text-gray-600">− {l.name}</dt><dd className="text-slate-800">{pkr(l.amount)}</dd></div>
        ))}
        <div className="flex justify-between gap-3"><dt className="text-gray-600">Total deductions</dt><dd className="text-slate-800">{pkr(r.totalDeductions)}</dd></div>
        <div className="flex justify-between gap-3"><dt className="text-gray-600">Expected in bank</dt><dd className="font-bold text-slate-800">{pkr(r.expectedInBank)}</dd></div>
        <div className="flex justify-between gap-3"><dt className="text-gray-600">Bank transfers received</dt><dd className="font-bold text-slate-800">{pkr(r.transfersReceived)}</dd></div>
        <div className="flex justify-between gap-3 border-t border-gray-100 pt-1">
          <dt className="font-bold text-tm-navy">Difference</dt>
          <dd className={`font-black ${r.missing ? 'text-tm-red' : 'text-tm-green-deep'}`}>
            {r.missing ? `${pkr(-r.difference)} missing` : r.difference > 0 ? `${pkr(r.difference)} more than expected` : 'None'}
          </dd>
        </div>
        <p className="pt-1 text-[11px] text-gray-500">
          Expected in bank = TutorMint collected − total deductions. Difference = bank transfers − expected in bank. Nothing here changes a payment.
        </p>
      </dl>
    </div>
  )
}
