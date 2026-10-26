'use client'

import { submitSignal } from '@/lib/submit'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Star, Undo2 } from 'lucide-react'

import { REVIEW_MAX_CHARS, REVIEW_MIN_CHARS, REVIEW_SENT_MESSAGE } from '@/lib/reviewsCore'

// "Leave a review" (owner, 27 Oct 2026 — lib/reviewsCore). Shown only for a
// hire: a tutor this parent hired on a tuition they posted, not yet reviewed.
// The server checks the hire again, and the database refuses an unearned
// review, so the button being on screen never makes a review possible. The
// review is saved as pending and appears once the Owner approves it.

export default function ReviewForm({
  applicationId,
  tutorName,
  compact = false,
  startOpen = false,
}: {
  applicationId: string
  tutorName: string
  compact?: boolean
  startOpen?: boolean
}) {
  const router = useRouter()
  const [open, setOpen] = useState(startOpen)
  const [rating, setRating] = useState(5)
  const [comment, setComment] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [done, setDone] = useState(false)
  const first = tutorName.split(' ')[0] || 'this tutor'

  const submit = async () => {
    setBusy(true)
    setError(null)
    try {
      const res = await fetch('/api/reviews', {
        signal: submitSignal(),
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ applicationId, rating, comment }),
      })
      const json = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(json.error ?? 'Your review could not be saved. Please try again.')
      setDone(true)
      setOpen(false)
      router.refresh()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Your review could not be saved. Please try again.')
    } finally {
      setBusy(false)
    }
  }

  if (done) return <p className="text-[11px] font-bold text-tm-green-deep">{REVIEW_SENT_MESSAGE}</p>

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className={`inline-flex min-h-[44px] items-center justify-center gap-1.5 rounded-xl text-xs font-bold transition-colors ${
          compact ? 'text-tm-red underline' : 'w-full bg-tm-green-deep px-4 text-white hover:bg-tm-green-deep-hover sm:w-auto'
        }`}
      >
        <Star size={14} className={compact ? '' : 'fill-white'} />
        Leave a review
      </button>
    )
  }

  return (
    <div className="space-y-2 rounded-xl bg-tm-bg p-3">
      <p className="text-[11px] font-bold text-tm-navy">How was {first}?</p>

      <div className="flex items-center gap-1" role="radiogroup" aria-label="Rating">
        {[1, 2, 3, 4, 5].map((n) => (
          <button
            key={n}
            type="button"
            role="radio"
            aria-checked={rating === n}
            aria-label={`${n} out of 5`}
            onClick={() => setRating(n)}
            className="flex min-h-[44px] min-w-[44px] items-center justify-center"
          >
            <Star size={20} className={n <= rating ? 'fill-tm-gold stroke-tm-gold' : 'fill-gray-200 stroke-gray-200'} />
          </button>
        ))}
      </div>

      <textarea
        value={comment}
        onChange={(e) => setComment(e.target.value.slice(0, REVIEW_MAX_CHARS))}
        rows={3}
        maxLength={REVIEW_MAX_CHARS}
        placeholder="What went well? What could be better? Other parents read this."
        aria-label="Your review"
        className="w-full rounded-xl border border-gray-200 bg-white p-3 text-xs outline-none focus:border-tm-red"
      />

      {error && <p className="text-[11px] font-bold text-tm-red">{error}</p>}

      <div className="flex gap-2">
        <button
          type="button"
          onClick={submit}
          disabled={busy || comment.trim().length < REVIEW_MIN_CHARS}
          className="min-h-[44px] flex-1 items-center gap-1.5 rounded-xl bg-tm-green-deep px-4 text-xs font-bold text-white disabled:bg-gray-300"
        >
          {busy ? 'Sending…' : 'Send review'}
        </button>
        <button
          type="button"
          onClick={() => setOpen(false)}
          className="inline-flex min-h-[44px] items-center justify-center gap-1.5 rounded-xl border border-gray-200 px-4 text-xs font-bold text-slate-700"
        >
          <Undo2 aria-hidden size={13} />
          Cancel
        </button>
      </div>

      <p className="text-[10px] leading-relaxed text-gray-500">
        Our team checks every review before it appears on the tutor&apos;s profile. You can leave one review for each tutor you hire.
      </p>
    </div>
  )
}
