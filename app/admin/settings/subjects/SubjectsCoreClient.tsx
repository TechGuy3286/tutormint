'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'

import { adminFetch } from '@/components/admin/adminFetch'
import { useToast } from '@/components/ui/Toast'
import type { LevelSubject } from '@/lib/subjectsCore'

// The "Main subject" checkboxes for one level (owner, 7 Oct 2026). Save sends
// the whole ticked set; the server changes only the flags that differ and
// records the change in the audit log.

export default function SubjectsCoreClient({
  levelSlug,
  levelName,
  subjects,
}: {
  levelSlug: string
  levelName: string
  subjects: LevelSubject[]
}) {
  const router = useRouter()
  const toast = useToast()
  const [ticked, setTicked] = useState<Set<number>>(() => new Set(subjects.filter((s) => s.isCore).map((s) => s.masterId)))
  const [busy, setBusy] = useState(false)
  const saved = new Set(subjects.filter((s) => s.isCore).map((s) => s.masterId))
  const dirty = ticked.size !== saved.size || [...ticked].some((id) => !saved.has(id))

  const toggle = (id: number) =>
    setTicked((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })

  const save = async () => {
    setBusy(true)
    const { ok, data } = await adminFetch<{ error?: string; added?: string[]; removed?: string[] }>('/api/admin/taxonomy/core', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ levelSlug, coreMasterIds: [...ticked] }),
    })
    setBusy(false)
    if (!ok) {
      toast.error(data?.error ?? 'That did not save. Please try again.')
      return
    }
    toast.success('Main subjects saved.')
    router.refresh()
  }

  return (
    <section className="space-y-3 rounded-2xl border border-gray-200 bg-white p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm font-black text-tm-navy">{levelName}</p>
        <p className="text-[11px] text-gray-600">
          {ticked.size} main subject{ticked.size === 1 ? '' : 's'} of {subjects.length}
        </p>
      </div>
      {subjects.length === 0 ? (
        <p className="text-xs text-gray-500">This level has no subjects.</p>
      ) : (
        <ul className="grid grid-cols-1 gap-1 sm:grid-cols-2">
          {subjects.map((s) => (
            <li key={s.masterId}>
              <label className="flex min-h-[40px] cursor-pointer items-center gap-2 rounded-lg px-2 text-xs text-slate-700 hover:bg-tm-bg">
                <input
                  type="checkbox"
                  checked={ticked.has(s.masterId)}
                  onChange={() => toggle(s.masterId)}
                  className="h-4 w-4 rounded border-gray-300"
                  aria-label={`Main subject: ${s.name}`}
                />
                <span>{s.name}</span>
              </label>
            </li>
          ))}
        </ul>
      )}
      <button
        type="button"
        onClick={() => void save()}
        disabled={busy || !dirty}
        className="inline-flex min-h-[44px] items-center rounded-xl bg-tm-red px-5 text-xs font-bold text-white hover:bg-tm-red-hover disabled:opacity-60"
      >
        {busy ? 'Saving…' : 'Save main subjects'}
      </button>
    </section>
  )
}
