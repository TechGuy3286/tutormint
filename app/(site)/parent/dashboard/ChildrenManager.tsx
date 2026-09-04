'use client'

import { submitSignal } from '@/lib/submit'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { useToast } from '@/components/ui/Toast'
import { useConfirm } from '@/components/ui/ConfirmDialog'
import { GraduationCap, Plus, Trash2, Undo2 } from 'lucide-react'

// "My children" on the parent dashboard.
//
// A child's name never appears on a public job card. It exists so a parent
// managing tuition for three children can tell their own posts apart, and so a
// job can say which child it is for once a conversation starts.

export type Child = { id: string; name: string; class_level: string | null; notes: string | null }

export default function ChildrenManager({ children }: { children: Child[] }) {
  const router = useRouter()
  const [adding, setAdding] = useState(false)
  const [name, setName] = useState('')
  const [classLevel, setClassLevel] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const toast = useToast()
  const confirm = useConfirm()

  const save = async () => {
    setBusy(true)
    setError(null)
    try {
      const res = await fetch('/api/parent/children', { signal: submitSignal(),
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, classLevel }),
      })
      const json = await res.json()
      if (!res.ok) throw new Error(json.error ?? 'Could not save.')
      setName('')
      setClassLevel('')
      setAdding(false)
      toast.success('Child added.')
      router.refresh()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not save.')
      toast.error(e instanceof Error ? e.message : 'Could not save.')
    } finally {
      setBusy(false)
    }
  }

  const remove = async (id: string, childName: string) => {
    const ok = await confirm({
      title: 'Delete this child?',
      body: `${childName} will be removed from your account. Any tuition that references them stays as it is.`,
      confirmLabel: 'Delete',
    })
    if (!ok) return
    setBusy(true)
    try {
      const res = await fetch('/api/parent/children', { signal: submitSignal(),
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id, action: 'remove' }),
      })
      if (res.ok) toast.success(`${childName} removed.`)
      else toast.error('Could not remove that child.')
      router.refresh()
    } finally {
      setBusy(false)
    }
  }

  return (
    <section className="space-y-3 rounded-2xl border border-gray-200 bg-white p-4 sm:p-5">
      <div className="flex items-center justify-between gap-2">
        <h2 className="text-sm font-black text-tm-navy">My children</h2>
        <button
          type="button"
          onClick={() => setAdding((v) => !v)}
          className="inline-flex min-h-[44px] items-center gap-1 text-xs font-bold text-tm-red"
        >
          <Plus size={14} />
          Add
        </button>
      </div>

      {children.length === 0 && !adding && (
        <p className="text-xs text-gray-500">
          Add a child so your job posts say who the tuition is for. Their name is never shown
          publicly.
        </p>
      )}

      {children.length > 0 && (
        <ul className="space-y-2">
          {children.map((c) => (
            <li
              key={c.id}
              className="flex items-center justify-between gap-3 rounded-xl bg-tm-bg px-3 py-2"
            >
              <span className="flex min-w-0 items-center gap-2">
                <GraduationCap size={14} className="shrink-0 text-gray-500" />
                <span className="truncate text-xs font-bold text-tm-navy">{c.name}</span>
                {c.class_level && (
                  <span className="shrink-0 text-[11px] text-gray-500">{c.class_level}</span>
                )}
              </span>
              <button
                type="button"
                onClick={() => remove(c.id, c.name)}
                disabled={busy}
                aria-label={`Remove ${c.name}`}
                className="flex min-h-[44px] min-w-[44px] items-center justify-center text-gray-500 hover:text-tm-red"
              >
                <Trash2 size={14} />
              </button>
            </li>
          ))}
        </ul>
      )}

      {adding && (
        <div className="space-y-2 rounded-xl bg-tm-bg p-3">
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Child's name"
            aria-label="Child's name"
            className="min-h-[44px] w-full rounded-xl border border-gray-200 bg-white px-3 text-xs font-semibold outline-none focus:border-tm-red"
          />
          <input
            value={classLevel}
            onChange={(e) => setClassLevel(e.target.value)}
            placeholder="Class or level (optional)"
            aria-label="Class or level"
            className="min-h-[44px] w-full rounded-xl border border-gray-200 bg-white px-3 text-xs font-semibold outline-none focus:border-tm-red"
          />
          {error && <p className="text-[11px] font-bold text-tm-red">{error}</p>}
          <div className="flex gap-2">
            <button
              type="button"
              onClick={save}
              disabled={busy || name.trim().length < 2}
              className="items-center gap-1.5 min-h-[44px] flex-1 rounded-xl bg-tm-black px-4 text-xs font-bold text-white disabled:bg-gray-300"
            >
              {busy ? 'Saving…' : 'Save'}
            </button>
            <button
              type="button"
              onClick={() => setAdding(false)}
              className="inline-flex items-center justify-center gap-1.5 min-h-[44px] rounded-xl border border-gray-200 px-4 text-xs font-bold text-slate-700"
            >
              <Undo2 aria-hidden size={13} />
              Cancel
            </button>
          </div>
        </div>
      )}
    </section>
  )
}
