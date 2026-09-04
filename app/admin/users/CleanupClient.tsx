'use client'

import { useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { AlertTriangle } from 'lucide-react'
import { adminFetch } from '@/components/admin/adminFetch'
import { useToast } from '@/components/ui/Toast'
import { formatDate } from '@/lib/datetime'

export type Candidate = {
  id: string
  email: string | null
  createdAt: string
  confirmed: boolean
  hasProfile: boolean
  role: string | null
  reason: string
}

// Junk accounts: what a scan found, and the one screen that can delete them.
//
// Nothing is pre-selected. The list is a suggestion from a heuristic, and
// heuristics are wrong sometimes; the owner ticks what they recognise as junk,
// and types DELETE, and only then does anything happen. The server recomputes
// the whole candidate list before deleting, so a tick on this page can never
// remove an account the scan would not have offered.

export default function CleanupClient({
  candidates,
  scanned,
}: {
  candidates: Candidate[]
  scanned: number
}) {
  const router = useRouter()
  const toast = useToast()
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [confirm, setConfirm] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [done, setDone] = useState<string | null>(null)

  const toggle = (id: string) => {
    const next = new Set(selected)
    if (next.has(id)) next.delete(id)
    else next.add(id)
    setSelected(next)
  }

  const remove = async () => {
    setBusy(true)
    setError(null)
    try {
      const { ok, data: json } = await adminFetch<{ [k: string]: unknown; error?: string }>(
        '/api/admin/cleanup',
        {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ids: Array.from(selected), confirm }),
        },
      )
      if (!ok) throw new Error(json.error ?? 'That did not work.')
      setDone(
        `Deleted ${json.deleted} account${json.deleted === 1 ? '' : 's'}` +
          (json.refused ? ` · ${json.refused} refused (they have activity now)` : ''),
      )
      toast.success(
        typeof json.deleted === 'number'
          ? `Deleted ${json.deleted} account${json.deleted === 1 ? '' : 's'}.`
          : 'Junk accounts deleted.',
      )
      setSelected(new Set())
      setConfirm('')
      router.refresh()
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'That did not work.'
      setError(msg)
      toast.error(msg)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="space-y-5">
      <header className="space-y-2">
        <Link href="/admin/users" className="text-xs font-bold text-tm-red hover:underline">
          ← All members
        </Link>
        <h2 className="text-lg font-black text-tm-navy">Junk accounts</h2>
        <p className="text-xs leading-relaxed text-gray-500">
          {candidates.length} of {scanned} accounts look like junk: an address that cannot receive
          mail, or a domain one keystroke from a real provider, or unconfirmed for over a month.
        </p>
        <p className="rounded-2xl border border-gray-200 bg-white p-3 text-[11px] leading-relaxed text-gray-500">
          Never listed, whatever the address looks like: seed fixtures, staff accounts, and any
          account with a job, application, payment, subscription, message, report, review or demo
          behind it. That last rule is what keeps a real account with a scruffy-looking address
          safe.
        </p>
      </header>

      {done && (
        <p className="rounded-xl border border-tm-green-deep/30 bg-tm-tint-green p-3 text-xs font-bold text-tm-green-deep">
          {done}
        </p>
      )}
      {error && (
        <p className="rounded-xl border border-tm-red/30 bg-tm-tint-red p-3 text-xs font-bold text-tm-red">
          {error}
        </p>
      )}

      {candidates.length === 0 ? (
        <p className="rounded-2xl border border-gray-200 bg-white p-6 text-center text-xs text-gray-500">
          Nothing to clean up.
        </p>
      ) : (
        <>
          <ul className="space-y-2">
            {candidates.map((c) => (
              <li key={c.id}>
                <label
                  className={`flex cursor-pointer items-start gap-3 rounded-2xl border bg-white p-3 ${
                    selected.has(c.id) ? 'border-tm-red' : 'border-gray-200'
                  }`}
                >
                  <input
                    type="checkbox"
                    checked={selected.has(c.id)}
                    onChange={() => toggle(c.id)}
                    className="mt-0.5 h-5 w-5 shrink-0"
                  />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-xs font-black text-tm-navy">
                      {c.email ?? '(no email)'}
                    </span>
                    <span className="block text-[11px] text-gray-500">{c.reason}</span>
                    <span className="block text-[11px] text-gray-500">
                      Created {formatDate(c.createdAt)} ·{' '}
                      {c.confirmed ? 'confirmed' : 'never confirmed'} ·{' '}
                      {c.hasProfile ? `profile (${c.role})` : 'no profile row'}
                    </span>
                  </span>
                </label>
              </li>
            ))}
          </ul>

          <section className="space-y-2 rounded-2xl border border-tm-gold/30 bg-tm-tint-gold p-4">
            <p className="flex items-start gap-2 text-xs font-semibold leading-relaxed text-tm-gold-ink">
              <AlertTriangle size={16} className="mt-px shrink-0" />
              {selected.size === 0
                ? 'Tick the accounts you want removed.'
                : `${selected.size} account${selected.size === 1 ? '' : 's'} will be deleted from authentication permanently. There is no undo.`}
            </p>

            <input
              value={confirm}
              onChange={(e) => setConfirm(e.target.value)}
              placeholder="Type DELETE to confirm"
              aria-label="Type DELETE to confirm"
              className="min-h-[44px] w-full rounded-xl border border-gray-200 px-3 text-xs font-semibold"
            />

            <button
              type="button"
              disabled={busy || selected.size === 0 || confirm.trim().toUpperCase() !== 'DELETE'}
              onClick={remove}
              className="min-h-[44px] w-full rounded-xl bg-tm-red px-4 text-xs font-bold text-white disabled:bg-gray-300"
            >
              {busy ? 'Deleting…' : `Delete ${selected.size || ''} selected`}
            </button>
          </section>
        </>
      )}
    </div>
  )
}
