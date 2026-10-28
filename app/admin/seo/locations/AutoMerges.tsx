'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'

import { adminFetch } from '@/components/admin/adminFetch'
import { useCanApprove } from '@/components/admin/ReadOnly'
import { useConfirm } from '@/components/ui/ConfirmDialog'
import { useToast } from '@/components/ui/Toast'
import { autoMergeLine, type AutoMergeRecord } from '@/lib/locationBucketsCore'

// Admin → Locations → "Automatic merges" (owner, 28 Oct 2026): what the
// clean-up matched by itself — the same name written differently, or one
// letter away on a long name, in the same city. Each has an Undo (Owner only;
// the server refuses everyone else). Shown 25 at a time.

export type AutoMergeView = { auditId: string; atText: string; record: AutoMergeRecord; undone: boolean }

const PAGE = 25

export default function AutoMerges({ items }: { items: AutoMergeView[] }) {
  const router = useRouter()
  const toast = useToast()
  const confirm = useConfirm()
  const canApprove = useCanApprove()
  const [busy, setBusy] = useState<string | null>(null)
  const [shown, setShown] = useState(PAGE)
  const [undone, setUndone] = useState<Set<string>>(new Set())

  if (items.length === 0) return null
  const live = items.filter((i) => !i.undone && !undone.has(i.auditId)).length

  const undo = async (it: AutoMergeView) => {
    const yes = await confirm({
      title: 'Undo this automatic merge?',
      body: `“${it.record.value}” will stop counting as ${it.record.intoName}${it.record.kind === 'staff_area' ? `, and the area staff added (“${it.record.value}”) comes back` : ''}. Nothing is deleted.`,
      confirmLabel: 'Undo',
    })
    if (!yes) return
    setBusy(it.auditId)
    const { ok, data } = await adminFetch<{ message?: string; error?: string }>('/api/admin/locations/auto-merges', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ auditId: it.auditId }),
    })
    setBusy(null)
    if (!ok) {
      toast.error(data?.error ?? 'That did not save. Please try again.')
      return
    }
    setUndone((u) => new Set(u).add(it.auditId))
    toast.success(data?.message ?? 'Undone.')
    router.refresh()
  }

  return (
    <section className="space-y-2">
      <h2 className="text-sm font-black text-tm-navy">Automatic merges ({live})</h2>
      <p className="text-[11px] text-gray-600">
        Matched by the clean-up on its own: the same name written differently, or one letter away, in the same city. The text on tuitions and profiles was not changed.
      </p>
      <ul className="space-y-2">
        {items.slice(0, shown).map((it) => {
          const isUndone = it.undone || undone.has(it.auditId)
          return (
            <li key={it.auditId} className="flex flex-wrap items-center justify-between gap-2 rounded-2xl border border-gray-200 bg-white p-3">
              <div className="min-w-0">
                <p className="break-words text-xs font-bold text-tm-navy">{autoMergeLine(it.record)}</p>
                <p className="text-[11px] text-gray-600">
                  {it.record.reason} · {it.atText}
                  {isUndone ? ' · Undone' : ''}
                </p>
              </div>
              {canApprove && !isUndone && (
                <button
                  type="button"
                  disabled={busy !== null}
                  onClick={() => void undo(it)}
                  className="inline-flex min-h-[44px] items-center justify-center rounded-xl border border-gray-200 bg-white px-4 text-xs font-bold text-slate-700 hover:border-tm-navy disabled:opacity-60"
                >
                  {busy === it.auditId ? 'Undoing…' : 'Undo'}
                </button>
              )}
            </li>
          )
        })}
      </ul>
      {shown < items.length && (
        <button
          type="button"
          onClick={() => setShown((n) => n + PAGE)}
          className="min-h-[44px] w-full rounded-xl border border-gray-200 bg-white text-xs font-bold text-slate-700 hover:border-tm-navy"
        >
          Load more ({items.length - shown} left)
        </button>
      )}
    </section>
  )
}
