'use client'

import { useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import { adminFetch } from '@/components/admin/adminFetch'
import { formatDate } from '@/lib/datetime'

export type PlanRow = {
  code: string
  name: string
  audience: string
  price_pkr: number
  monthly_quota: number
  displayed_quota: string
}

export type AccountRow = {
  id: string
  fullName: string
  email: string
  role: string
  activePlan: string | null
  expiresAt: string | null
  source: string | null
  note: string | null
}

export default function PlanGrantClient({
  plans,
  accounts,
  canMutate,
}: {
  plans: PlanRow[]
  accounts: AccountRow[]
  canMutate: boolean
}) {
  const router = useRouter()
  const [q, setQ] = useState('')
  const [open, setOpen] = useState<AccountRow | null>(null)
  const [planCode, setPlanCode] = useState('')
  const [days, setDays] = useState('30')
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const [msg, setMsg] = useState('')

  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase()
    if (!needle) return accounts.slice(0, 40)
    return accounts
      .filter((a) => a.fullName?.toLowerCase().includes(needle) || a.email?.toLowerCase().includes(needle))
      .slice(0, 40)
  }, [q, accounts])

  // Only plans matching the selected account's audience are offered.
  const eligiblePlans = useMemo(() => {
    if (!open) return []
    const audience = open.role === 'tutor' ? 'tutor' : 'parent'
    return plans.filter((p) => p.audience === audience)
  }, [open, plans])

  async function submit(action: 'grant' | 'revoke') {
    if (!open) return
    setBusy(true)
    setErr('')
    setMsg('')

    const { ok, data: json } = await adminFetch<{ error?: string; expiresAt?: string; revoked?: number }>(
      '/api/admin/plans',
      {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        userId: open.id,
        action,
        planCode: action === 'grant' ? planCode : undefined,
        days: action === 'grant' ? Number(days) : undefined,
        note,
      }),
      },
    )
    setBusy(false)

    if (!ok) {
      setErr(json.error ?? 'Action failed.')
      return
    }

    setMsg(
      action === 'grant'
        ? `${planCode} granted to ${open.fullName} until ${formatDate(json.expiresAt ?? Date.now())}.`
        : `Revoked ${json.revoked} active subscription(s) for ${open.fullName}.`,
    )
    setOpen(null)
    setPlanCode('')
    setNote('')
    router.refresh()
  }

  return (
    <div className="space-y-4">
      <header className="space-y-1">
        <p className="text-xs text-gray-500">
          Grant or revoke a plan on any account. Grants are recorded as{' '}
          <code className="text-[10px]">admin_grant</code> so they can be told apart from real
          purchases.
        </p>
      </header>

      {!canMutate && (
        <p className="p-3 bg-tm-tint-gold border border-tm-gold/30 text-tm-gold-ink text-xs font-bold rounded-xl">
          Read-only: your admin role can view plans but not change them.
        </p>
      )}

      {msg && (
        <p className="p-3 bg-tm-tint-green border border-tm-green-deep/30 text-tm-green-deep text-xs font-bold rounded-xl">
          {msg}
        </p>
      )}

      <input
        value={q}
        onChange={(e) => setQ(e.target.value)}
        placeholder="Search by name or email…"
        className="w-full min-h-[44px] p-3 bg-white border border-gray-200 rounded-xl text-sm outline-none focus:border-tm-navy"
      />

      <ul className="space-y-2">
        {filtered.map((a) => (
          <li key={a.id}>
            <button
              onClick={() => {
                if (!canMutate) return
                setOpen(a)
                setPlanCode('')
                setDays('30')
                setNote('')
                setErr('')
              }}
              disabled={!canMutate}
              className="w-full text-left bg-white border border-gray-200 rounded-2xl p-3 sm:p-4 hover:border-tm-navy transition-colors flex items-center gap-3 min-h-[44px] disabled:cursor-default disabled:hover:border-gray-200"
            >
              <div className="min-w-0 flex-1">
                <p className="text-xs font-black text-tm-navy truncate">{a.fullName}</p>
                <p className="text-[11px] text-gray-500 truncate">
                  {a.email} · {a.role}
                </p>
              </div>
              <span
                className={`shrink-0 px-2 py-1 rounded-lg border text-[10px] font-bold ${
                  a.activePlan
                    ? 'bg-tm-tint-green text-tm-green-deep border-tm-green-deep/30'
                    : 'bg-gray-50 text-gray-500 border-gray-200'
                }`}
              >
                {a.activePlan ?? 'none'}
                {a.source === 'admin_grant' ? ' ·granted' : ''}
              </span>
            </button>
          </li>
        ))}
      </ul>

      {open && (
        <div
          className="fixed inset-0 z-50 bg-tm-black/50 flex items-end sm:items-center sm:justify-center"
          role="dialog"
          aria-modal="true"
          aria-label={`Plan for ${open.fullName}`}
          onClick={() => setOpen(null)}
        >
          <div
            className="bg-white w-full sm:max-w-md rounded-t-3xl sm:rounded-3xl p-5 space-y-4"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <h2 className="text-base font-black text-tm-navy truncate">{open.fullName}</h2>
                <p className="text-[11px] text-gray-500 truncate">
                  {open.role} · current: {open.activePlan ?? 'none'}
                  {open.expiresAt ? ` (until ${formatDate(open.expiresAt)})` : ''}
                </p>
              </div>
              <button onClick={() => setOpen(null)} className="text-gray-500 text-xl min-h-[44px] px-2" aria-label="Close">
                ×
              </button>
            </div>

            <div className="space-y-1">
              <label htmlFor="plan" className="text-[11px] font-bold text-tm-navy">
                Plan ({open.role === 'tutor' ? 'tutor' : 'parent'} plans only)
              </label>
              <select
                id="plan"
                value={planCode}
                onChange={(e) => setPlanCode(e.target.value)}
                className="w-full min-h-[44px] p-3 bg-tm-bg border border-gray-200 rounded-xl text-sm outline-none focus:border-tm-navy"
              >
                <option value="">Select a plan…</option>
                {eligiblePlans.map((p) => (
                  <option key={p.code} value={p.code}>
                    {p.name} — {p.price_pkr} PKR ({p.displayed_quota})
                  </option>
                ))}
              </select>
            </div>

            <div className="space-y-1">
              <label htmlFor="days" className="text-[11px] font-bold text-tm-navy">
                Duration (days)
              </label>
              <input
                id="days"
                type="number"
                min={1}
                max={3650}
                value={days}
                onChange={(e) => setDays(e.target.value)}
                className="w-full min-h-[44px] p-3 bg-tm-bg border border-gray-200 rounded-xl text-sm outline-none focus:border-tm-navy"
              />
            </div>

            <div className="space-y-1">
              <label htmlFor="note" className="text-[11px] font-bold text-tm-navy">
                Note (recorded in the audit log)
              </label>
              <input
                id="note"
                value={note}
                onChange={(e) => setNote(e.target.value)}
                placeholder="Pre-launch testing"
                className="w-full min-h-[44px] p-3 bg-tm-bg border border-gray-200 rounded-xl text-sm outline-none focus:border-tm-navy"
              />
            </div>

            {err && <p className="text-[11px] font-bold text-tm-red">{err}</p>}

            <div className="grid grid-cols-2 gap-2">
              <button
                onClick={() => submit('grant')}
                disabled={busy || !planCode}
                className="min-h-[44px] py-3 bg-tm-green-deep hover:bg-tm-green-deep-hover text-white text-xs font-bold rounded-xl disabled:opacity-50"
              >
                Grant
              </button>
              <button
                onClick={() => submit('revoke')}
                disabled={busy || !open.activePlan}
                className="min-h-[44px] py-3 bg-tm-red hover:bg-tm-red-hover text-white text-xs font-bold rounded-xl disabled:opacity-50"
              >
                Revoke active
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
