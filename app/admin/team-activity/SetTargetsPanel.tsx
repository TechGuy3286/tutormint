'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'

import { adminFetch } from '@/components/admin/adminFetch'
import { useToast } from '@/components/ui/Toast'

// "Set targets" (owner, 16 Oct 2026) — rendered for the Owner only; the API
// refuses everyone else (403 + the Owner is alerted). A target per person for
// the chosen month, "Set the same for all", "Copy last month's targets", and
// a switch to put someone on or off the target list. An empty box leaves that
// person's target as it is. Every change is written to Audit.

type Row = { staffId: string; name: string; onList: boolean; target: number | null; lastMonth: number | null }

export default function SetTargetsPanel({ month, monthLabel, rows }: { month: string; monthLabel: string; rows: Row[] }) {
  const router = useRouter()
  const toast = useToast()
  const [values, setValues] = useState<Record<string, string>>(() =>
    Object.fromEntries(rows.map((r) => [r.staffId, r.target == null ? '' : String(r.target)])),
  )
  const [same, setSame] = useState('')
  const [busy, setBusy] = useState(false)
  const listed = rows.filter((r) => r.onList)

  const setForList = (fn: (r: Row) => string) =>
    setValues((v) => {
      const next = { ...v }
      for (const r of listed) next[r.staffId] = fn(r)
      return next
    })

  const save = async () => {
    setBusy(true)
    const { ok, data } = await adminFetch<{ error?: string; changed?: number }>('/api/admin/team-activity/targets', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        action: 'set',
        month,
        targets: rows.filter((r) => r.onList).map((r) => ({ staffId: r.staffId, target: values[r.staffId] ?? '' })),
      }),
    })
    setBusy(false)
    if (!ok) {
      toast.error(data?.error ?? 'The targets did not save. Please try again.')
      return
    }
    toast.success(data?.changed ? `Targets saved for ${monthLabel}.` : 'Nothing changed.')
    router.refresh()
  }

  const toggle = async (r: Row) => {
    setBusy(true)
    const { ok, data } = await adminFetch<{ error?: string }>('/api/admin/team-activity/targets', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'list', staffId: r.staffId, onList: !r.onList }),
    })
    setBusy(false)
    if (!ok) {
      toast.error(data?.error ?? 'That did not save. Please try again.')
      return
    }
    toast.success(r.onList ? `${r.name} is now "No target".` : `${r.name} is on the target list.`)
    router.refresh()
  }

  const btn = 'inline-flex min-h-[44px] items-center rounded-xl px-4 text-xs font-bold disabled:opacity-60'

  return (
    <details className="rounded-2xl border border-gray-200 bg-white p-4">
      <summary className="min-h-[44px] cursor-pointer text-sm font-black text-tm-navy">Set targets — {monthLabel}</summary>
      <div className="mt-3 space-y-4">
        <div className="flex flex-wrap items-end gap-2">
          <label className="text-[11px] font-bold text-gray-600">
            <span className="mb-1 block">Set the same for all</span>
            <input
              inputMode="numeric"
              value={same}
              onChange={(e) => setSame(e.target.value.replace(/[^0-9]/g, ''))}
              className="min-h-[44px] w-24 rounded-xl border border-gray-200 px-3 text-sm"
            />
          </label>
          <button type="button" disabled={!same} onClick={() => setForList(() => same)} className={`${btn} border border-tm-navy text-tm-navy`}>
            Apply to all
          </button>
          <button
            type="button"
            onClick={() => setForList((r) => (r.lastMonth == null ? (values[r.staffId] ?? '') : String(r.lastMonth)))}
            className={`${btn} border border-gray-300 text-slate-700`}
          >
            Copy last month&rsquo;s targets
          </button>
        </div>

        <ul className="divide-y divide-gray-100">
          {rows.map((r) => (
            <li key={r.staffId} className="flex flex-wrap items-center justify-between gap-2 py-2">
              <span className="min-w-[140px] text-sm font-bold text-slate-800">
                {r.name}
                <span className="block text-[11px] font-normal text-gray-500">
                  {r.onList ? `Last month: ${r.lastMonth ?? 'not set'}` : 'No target'}
                </span>
              </span>
              <span className="flex items-center gap-2">
                {r.onList && (
                  <input
                    aria-label={`Target for ${r.name}`}
                    inputMode="numeric"
                    value={values[r.staffId] ?? ''}
                    placeholder="—"
                    onChange={(e) => setValues((v) => ({ ...v, [r.staffId]: e.target.value.replace(/[^0-9]/g, '') }))}
                    className="min-h-[44px] w-20 rounded-xl border border-gray-200 px-3 text-sm tabular-nums"
                  />
                )}
                <button type="button" disabled={busy} onClick={() => void toggle(r)} className={`${btn} border border-gray-300 text-slate-700`}>
                  {r.onList ? 'Remove from list' : 'Add to list'}
                </button>
              </span>
            </li>
          ))}
        </ul>

        <button type="button" disabled={busy} onClick={() => void save()} className={`${btn} bg-tm-red text-white hover:bg-tm-red-hover`}>
          {busy ? 'Saving…' : 'Save targets'}
        </button>
      </div>
    </details>
  )
}
