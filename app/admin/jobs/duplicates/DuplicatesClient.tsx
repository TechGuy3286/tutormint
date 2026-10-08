'use client'

import Link from 'next/link'
import { useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import { Copy, GitMerge, Loader2 } from 'lucide-react'

import { adminFetch } from '@/components/admin/adminFetch'
import { useToast } from '@/components/ui/Toast'
import { useConfirm } from '@/components/ui/ConfirmDialog'
import { useAdminReadOnly } from '@/components/admin/ReadOnly'
import type { RepeatPair } from '@/lib/duplicates'

// The Duplicates screen (owner, 6 Oct 2026). One card per repeat, grouped by
// the staff member who posted it. "Merge into original" calls the admin action
// route (action 'merge'): the repeat is closed and marked merged, its URL 301s
// to the original, Google is told, the original gets one refresh. A repeat with
// applications is refused by the server and left for a human.

export default function DuplicatesClient({ pairs, days, canMerge }: { pairs: RepeatPair[]; days: number; canMerge: boolean }) {
  const router = useRouter()
  const toast = useToast()
  const confirm = useConfirm()
  const readOnly = useAdminReadOnly()
  const [busy, setBusy] = useState<string | null>(null)

  const groups = useMemo(() => {
    const m = new Map<string, RepeatPair[]>()
    for (const p of pairs) {
      const k = p.repeat.postedBy ?? 'Unknown staff member'
      ;(m.get(k) ?? m.set(k, []).get(k)!).push(p)
    }
    return [...m.entries()].sort((a, b) => b[1].length - a[1].length)
  }, [pairs])

  const merge = async (p: RepeatPair) => {
    const ok = await confirm({
      title: `Merge ${p.repeat.refId ?? 'this tuition'} into ${p.original.refId ?? 'the original'}?`,
      body: 'The repeat is closed and its address will send visitors to the original. Nothing is deleted. The original moves to the top of Browse with a fresh 7 days.',
      confirmLabel: 'Merge into original',
    })
    if (!ok) return
    setBusy(p.repeat.id)
    const r = await adminFetch<{ error?: string; repeatRef?: string; survivorRef?: string }>('/api/admin/jobs/action', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ jobId: p.repeat.id, action: 'merge', survivorId: p.original.id, reason: `Duplicates view: ${p.reasons.join(', ')}` }),
    })
    if (r.ok) {
      toast.success(`Merged ${r.data?.repeatRef ?? ''} into ${r.data?.survivorRef ?? ''}.`)
      router.refresh()
    } else {
      toast.error(r.data?.error ?? 'Could not merge. Please try again.')
    }
    setBusy(null)
  }

  return (
    <div className="space-y-4">
      <header className="flex flex-wrap items-baseline justify-between gap-2">
        <p className="text-xs text-gray-500">
          Repeats posted in the last {days} day{days === 1 ? '' : 's'}: {pairs.length}. A repeat shares a title, or the full
          combination (city, area, level, subjects, gender, budget), with an older open or paused tuition.
        </p>
        <nav className="flex gap-2 text-[11px] font-bold">
          {[7, 30, 90].map((d) => (
            <Link key={d} href={`/admin/jobs/duplicates?days=${d}`} className={`rounded-full px-3 py-1 ring-1 ${d === days ? 'bg-tm-navy text-white ring-tm-navy' : 'text-tm-navy ring-gray-200'}`}>
              {d} days
            </Link>
          ))}
        </nav>
      </header>

      {pairs.length === 0 ? (
        <p className="rounded-2xl border border-dashed border-gray-200 bg-white p-6 text-center text-xs text-gray-500">
          No repeats in this period. The check at “Post a tuition” now warns before a repeat is published.
        </p>
      ) : (
        groups.map(([who, list]) => (
          <section key={who} className="space-y-2">
            <h2 className="flex items-center gap-2 text-sm font-black text-tm-navy">
              <Copy aria-hidden size={14} /> {who} <span className="text-xs font-bold text-gray-500">— {list.length} repeat{list.length === 1 ? '' : 's'}</span>
            </h2>
            <ul className="space-y-2">
              {list.map((p) => (
                <li key={p.repeat.id} className="grid gap-3 rounded-2xl border border-gray-200 bg-white p-4 sm:grid-cols-[1fr_1fr_auto] sm:items-center">
                  <div className="min-w-0 space-y-0.5">
                    <p className="text-[10px] font-bold uppercase tracking-wide text-gray-500">Repeat</p>
                    <Link href={`/admin/jobs/${p.repeat.id}`} className="block truncate text-xs font-black text-tm-navy hover:underline">
                      {p.repeat.refId} · {p.repeat.title}
                    </Link>
                    <p className="text-[11px] text-gray-500">
                      {p.repeat.createdAt.slice(0, 10)} · {p.repeat.status} · {p.repeat.applications} application{p.repeat.applications === 1 ? '' : 's'}
                    </p>
                  </div>
                  <div className="min-w-0 space-y-0.5">
                    <p className="text-[10px] font-bold uppercase tracking-wide text-gray-500">Original ({p.reasons.join(', ')})</p>
                    <Link href={`/admin/jobs/${p.original.id}`} className="block truncate text-xs font-black text-tm-navy hover:underline">
                      {p.original.refId} · {p.original.title}
                    </Link>
                    <p className="text-[11px] text-gray-500">{p.original.createdAt.slice(0, 10)} · {p.original.status}</p>
                  </div>
                  <div>
                    {readOnly ? null : canMerge ? (
                      <button
                        type="button"
                        onClick={() => merge(p)}
                        disabled={busy === p.repeat.id || p.repeat.applications > 0}
                        title={p.repeat.applications > 0 ? 'Has applications — close it by hand if that is right.' : undefined}
                        className="inline-flex min-h-[44px] w-full items-center justify-center gap-1.5 rounded-xl bg-tm-red px-4 text-xs font-bold text-white hover:bg-tm-red-hover disabled:opacity-50 sm:w-auto"
                      >
                        {busy === p.repeat.id ? <Loader2 aria-hidden size={13} className="animate-spin" /> : <GitMerge aria-hidden size={13} />}
                        Merge into original
                      </button>
                    ) : (
                      <span className="text-[11px] text-gray-500">An admin merges these.</span>
                    )}
                  </div>
                </li>
              ))}
            </ul>
          </section>
        ))
      )}
    </div>
  )
}
