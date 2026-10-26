'use client'

import { useCallback, useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { adminFetch } from '@/components/admin/adminFetch'
import { useToast } from '@/components/ui/Toast'
import { useConfirm } from '@/components/ui/ConfirmDialog'
import { formatDate } from '@/lib/datetime'

type Summary = {
  id: string
  name: string
  role: string | null
  joinedAt: string
  completion: number
  phoneMasked: string | null
  documents: { count: number; approved: string[] }
  payments: { approved: number; total: number }
  applications: number
  tuitions: number
}
type Preview = { a: Summary; b: Summary; suggestedKeep: string; keepId: string; block: string | null; lines: string[] }

export default function MergeClient({ a, b }: { a: string; b: string }) {
  const router = useRouter()
  const toast = useToast()
  const confirm = useConfirm()
  const [keep, setKeep] = useState<string | null>(null)
  const [p, setP] = useState<Preview | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const load = useCallback(
    async (k: string | null) => {
      setError(null)
      const res = await fetch(`/api/admin/members/merge?a=${a}&b=${b}${k ? `&keep=${k}` : ''}`, { cache: 'no-store' })
      const data = await res.json().catch(() => null)
      if (!res.ok) return setError(data?.error ?? 'The preview did not load.')
      setP(data as Preview)
      setKeep((data as Preview).keepId)
    },
    [a, b],
  )

  useEffect(() => {
    let alive = true
    fetch(`/api/admin/members/merge?a=${a}&b=${b}`, { cache: 'no-store' })
      .then(async (res) => ({ ok: res.ok, data: await res.json().catch(() => null) }))
      .then(({ ok, data }) => {
        if (!alive) return
        if (!ok) return setError(data?.error ?? 'The preview did not load.')
        setP(data as Preview)
        setKeep((data as Preview).keepId)
      })
      .catch(() => alive && setError('The preview did not load.'))
    return () => {
      alive = false
    }
  }, [a, b])

  async function merge() {
    if (!p) return
    const kept = p.keepId === p.a.id ? p.a : p.b
    const other = kept.id === p.a.id ? p.b : p.a
    const ok = await confirm({ title: `Merge ${other.name} into ${kept.name}?`, body: 'You can undo this from either account’s page.', confirmLabel: 'Merge' })
    if (!ok) return
    setBusy(true)
    const { ok: done, data } = await adminFetch<{ error?: string }>('/api/admin/members/merge', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'merge', keepId: kept.id, otherId: other.id }),
    })
    setBusy(false)
    if (!done) return toast.error(data?.error ?? 'The merge did not go through.')
    toast.success(`Merged into ${kept.name}.`)
    router.push(`/admin/users/${kept.id}`)
  }

  if (error)
    return (
      <p role="alert" className="rounded-xl border border-tm-red/30 bg-tm-tint-red p-4 text-xs font-bold text-tm-red">
        {error}
      </p>
    )
  if (!p) return <p className="text-xs text-gray-500">Preparing the preview…</p>

  return <MergePreviewView p={p} keep={keep} busy={busy} onPick={(id) => void load(id)} onMerge={() => void merge()} />
}

/** The preview itself, with no data loading (the screen and its screenshot). */
export function MergePreviewView({ p, keep, busy, onPick, onMerge }: { p: Preview; keep: string | null; busy: boolean; onPick: (id: string) => void; onMerge: () => void }) {
  const card = (s: Summary) => (
    <label
      key={s.id}
      className={`block cursor-pointer space-y-1 rounded-2xl border bg-white p-4 ${keep === s.id ? 'border-tm-navy ring-1 ring-tm-navy' : 'border-gray-200'}`}
      data-merge-side={s.id === p.keepId ? 'keep' : 'other'}
    >
      <span className="flex flex-wrap items-center gap-2">
        <input type="radio" name="keep" checked={keep === s.id} onChange={() => onPick(s.id)} />
        <span className="text-sm font-black text-tm-navy">{s.name}</span>
        {s.id === p.suggestedKeep && (
          <span className="rounded-full bg-tm-tint-green px-2 py-0.5 text-[10px] font-bold text-tm-green-deep">Suggested to keep</span>
        )}
        {s.id === p.keepId && <span className="rounded-full bg-tm-navy px-2 py-0.5 text-[10px] font-bold text-white">Keep</span>}
      </span>
      <dl className="grid grid-cols-2 gap-x-2 gap-y-0.5 text-[11px]">
        <dt className="text-gray-500">Type</dt>
        <dd className="text-right font-bold">{s.role === 'tutor' ? 'Tutor' : 'Parent'}</dd>
        <dt className="text-gray-500">Joined</dt>
        <dd className="text-right font-bold">{formatDate(s.joinedAt)}</dd>
        <dt className="text-gray-500">Phone</dt>
        <dd className="text-right font-mono">{s.phoneMasked ?? '—'}</dd>
        <dt className="text-gray-500">Completion</dt>
        <dd className="text-right font-bold">{s.completion}%</dd>
        <dt className="text-gray-500">Documents</dt>
        <dd className="text-right font-bold">
          {s.documents.count}
          {s.documents.approved.length ? ` · approved: ${s.documents.approved.join(', ')}` : ''}
        </dd>
        <dt className="text-gray-500">Payments</dt>
        <dd className="text-right font-bold">
          {s.payments.approved} paid of {s.payments.total}
        </dd>
        <dt className="text-gray-500">{s.role === 'tutor' ? 'Applications' : 'Tuitions'}</dt>
        <dd className="text-right font-bold">{s.role === 'tutor' ? s.applications : s.tuitions}</dd>
      </dl>
    </label>
  )

  return (
    <div className="space-y-4" data-merge-preview="">
      <div className="grid gap-3 sm:grid-cols-2">{[p.a, p.b].map(card)}</div>
      <section className="space-y-2 rounded-2xl border border-gray-200 bg-white p-4">
        <h3 className="text-sm font-black text-tm-navy">What will move to the kept account</h3>
        {p.block ? (
          <p role="alert" className="rounded-lg bg-tm-tint-red p-3 text-xs font-bold text-tm-red">
            {p.block}
          </p>
        ) : p.lines.length === 0 ? (
          <p className="text-xs text-gray-600">Nothing to move — the other account only becomes “Merged into …”.</p>
        ) : (
          <ul className="space-y-1 text-xs text-slate-800">
            {p.lines.map((l) => (
              <li key={l} className={l.startsWith('PAYMENT MOVES') ? 'rounded-lg bg-tm-tint-gold px-2 py-1 font-black text-tm-gold-ink' : ''}>
                {l}
              </li>
            ))}
          </ul>
        )}
        <p className="text-[11px] text-gray-500">
          The kept account’s phone stays the login; the other phone is saved as a secondary contact. Signing in with the other account will say
          “Please use your other account”.
        </p>
      </section>
      <button
        type="button"
        disabled={busy || !!p.block}
        onClick={onMerge}
        className="min-h-[44px] rounded-xl bg-tm-red px-5 text-sm font-bold text-white hover:bg-tm-red-hover disabled:opacity-50"
      >
        {busy ? 'Merging…' : 'Merge'}
      </button>
    </div>
  )
}
