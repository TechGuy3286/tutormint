'use client'

import { useEffect, useState } from 'react'
import { Loader2, Plus, X } from 'lucide-react'
import { useToast } from '@/components/ui/Toast'
import { submitSignal } from '@/lib/submit'
import { MAX_QUICK_REPLIES, DEFAULT_QUICK_REPLIES } from '@/lib/messagingRules'

// The tutor's quick replies — the chips above their composer. Plain text, up to
// six, edited here and saved to tutor_quick_replies. A tutor with none saved
// sees the defaults as a starting point (empty state, not stored) and can keep,
// change or clear them; nothing is written until Save.

export default function QuickRepliesEditor() {
  const toast = useToast()
  const [items, setItems] = useState<string[]>([])
  const [loaded, setLoaded] = useState(false)
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    let live = true
    void fetch('/api/tutor/quick-replies', { signal: submitSignal(), headers: { accept: 'application/json' } })
      .then((r) => (r.ok ? r.json() : { replies: [] }))
      .then((j) => {
        if (!live) return
        const replies = Array.isArray(j.replies) ? (j.replies as string[]) : []
        setItems(replies.length > 0 ? replies : DEFAULT_QUICK_REPLIES)
        setLoaded(true)
      })
      .catch(() => {
        if (live) {
          setItems(DEFAULT_QUICK_REPLIES)
          setLoaded(true)
        }
      })
    return () => {
      live = false
    }
  }, [])

  const update = (i: number, v: string) =>
    setItems((prev) => prev.map((x, j) => (j === i ? v : x)))
  const remove = (i: number) => setItems((prev) => prev.filter((_, j) => j !== i))
  const add = () => setItems((prev) => (prev.length < MAX_QUICK_REPLIES ? [...prev, ''] : prev))

  const save = async () => {
    setSaving(true)
    try {
      const replies = items.map((s) => s.trim()).filter(Boolean).slice(0, MAX_QUICK_REPLIES)
      const res = await fetch('/api/tutor/quick-replies', {
        signal: submitSignal(),
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ replies }),
      })
      const json = await res.json()
      if (res.ok) {
        setItems((json.replies as string[]) ?? replies)
        toast.success('Quick replies saved.')
      } else {
        toast.error(json.error ?? 'Could not save.')
      }
    } catch {
      toast.error('Could not save.')
    } finally {
      setSaving(false)
    }
  }

  if (!loaded) {
    return (
      <p className="flex items-center gap-2 text-xs text-gray-500">
        <Loader2 size={14} className="animate-spin" aria-hidden /> Loading…
      </p>
    )
  }

  return (
    <div className="space-y-3">
      <p className="text-[11px] leading-relaxed text-gray-500">
        Up to {MAX_QUICK_REPLIES} short openers, shown as one-tap chips above your composer in Messages.
        Tapping a chip inserts it — it never sends on its own.
      </p>

      <ul className="space-y-2">
        {items.map((v, i) => (
          <li key={i} className="flex items-center gap-2">
            <input
              value={v}
              maxLength={120}
              onChange={(e) => update(i, e.target.value)}
              placeholder="e.g. Which area are you in?"
              aria-label={`Quick reply ${i + 1}`}
              className="min-h-[44px] flex-1 rounded-xl border border-gray-200 bg-white px-3 text-xs outline-none focus:border-tm-red"
            />
            <button
              type="button"
              onClick={() => remove(i)}
              aria-label={`Remove quick reply ${i + 1}`}
              className="grid h-11 w-11 shrink-0 place-items-center rounded-xl border border-gray-200 text-gray-500 hover:border-tm-red hover:text-tm-red"
            >
              <X size={16} aria-hidden />
            </button>
          </li>
        ))}
      </ul>

      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={add}
          disabled={items.length >= MAX_QUICK_REPLIES}
          className="inline-flex min-h-[44px] items-center gap-1.5 rounded-xl border border-gray-200 px-4 text-xs font-bold text-tm-navy transition-colors hover:border-tm-navy disabled:text-gray-300"
        >
          <Plus size={14} aria-hidden />
          Add a quick reply
        </button>
        <button
          type="button"
          onClick={save}
          disabled={saving}
          className="inline-flex min-h-[44px] items-center justify-center gap-1.5 rounded-xl bg-tm-red px-5 text-xs font-bold text-white transition-colors hover:bg-tm-red-hover disabled:opacity-60"
        >
          {saving && <Loader2 size={14} className="animate-spin" aria-hidden />}
          Save quick replies
        </button>
      </div>
    </div>
  )
}
