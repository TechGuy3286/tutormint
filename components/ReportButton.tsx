'use client'

import { useState } from 'react'
import { Flag } from 'lucide-react'

// "Report" — one component, three places (tutor profile, job card, thread).
//
// T5 shipped this only in the thread header because that was the only place
// with a queue-shaped story behind it. T7a gives reports somewhere to land, so
// the button belongs everywhere a member can encounter another member.
//
// The reason list is the same server-side allowlist in /api/reports, so a
// crafted request cannot invent a category the queue does not filter on. The
// confirmation is deliberately flat: it does not say what will happen to the
// other person, because it does not know, and promising a suspension you have
// not decided on is worse than saying nothing.

const REASONS = [
  { code: 'spam', label: 'Spam or advertising' },
  { code: 'harassment', label: 'Harassment or abuse' },
  { code: 'fake_profile', label: 'Fake or impersonated profile' },
  { code: 'off_platform_payment', label: 'Asking to pay outside TutorMint' },
  { code: 'inappropriate_content', label: 'Inappropriate content' },
  { code: 'other', label: 'Something else' },
]

export default function ReportButton({
  reportedId,
  targetType,
  targetId,
  label = 'Report',
  className,
}: {
  reportedId: string
  targetType: 'profile' | 'thread' | 'job' | 'message'
  targetId?: string | null
  label?: string
  className?: string
}) {
  const [open, setOpen] = useState(false)
  const [reason, setReason] = useState('spam')
  const [detail, setDetail] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [done, setDone] = useState(false)

  const submit = async () => {
    setBusy(true)
    setError(null)
    try {
      const res = await fetch('/api/reports', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ reportedId, targetType, targetId, reason, detail }),
      })
      const json = await res.json()
      if (!res.ok) throw new Error(json.error ?? 'Could not send that report.')
      setDone(true)
      setOpen(false)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not send that report.')
    } finally {
      setBusy(false)
    }
  }

  if (done) {
    return (
      <p className="text-[11px] font-bold text-[#059669]">
        Thank you — a person will look at this.
      </p>
    )
  }

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className={
          className ??
          'inline-flex min-h-[44px] items-center gap-1.5 text-xs font-bold text-gray-400 hover:text-[#d60008]'
        }
      >
        <Flag size={14} />
        {label}
      </button>
    )
  }

  return (
    <div className="space-y-2 rounded-xl border border-gray-200 bg-white p-3">
      <p className="text-[11px] font-black text-[#0F172A]">What is wrong?</p>

      <label className="block space-y-1">
        <span className="sr-only">Reason</span>
        <select
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          className="min-h-[44px] w-full rounded-xl border border-gray-200 bg-white px-3 text-xs font-semibold"
        >
          {REASONS.map((r) => (
            <option key={r.code} value={r.code}>
              {r.label}
            </option>
          ))}
        </select>
      </label>

      <textarea
        value={detail}
        onChange={(e) => setDetail(e.target.value)}
        rows={3}
        placeholder="Anything that would help us understand (optional)"
        aria-label="Details"
        className="w-full rounded-xl border border-gray-200 p-3 text-xs outline-none focus:border-[#d60008]"
      />

      {error && <p className="text-[11px] font-bold text-[#d60008]">{error}</p>}

      <div className="grid grid-cols-2 gap-2">
        <button
          type="button"
          onClick={submit}
          disabled={busy}
          className="min-h-[44px] rounded-xl bg-[#d60008] px-4 text-xs font-bold text-white disabled:bg-gray-300"
        >
          {busy ? 'Sending…' : 'Send report'}
        </button>
        <button
          type="button"
          onClick={() => setOpen(false)}
          className="min-h-[44px] rounded-xl border border-gray-200 px-4 text-xs font-bold text-[#334155]"
        >
          Cancel
        </button>
      </div>
    </div>
  )
}
