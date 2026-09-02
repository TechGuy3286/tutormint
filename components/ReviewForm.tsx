'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Star } from 'lucide-react'

// "Leave a review", shown only where one has actually been earned.
//
// The parent's hired-tutors list offers it against the job; the completed-demo
// row offers it against the demo. Either way the server checks eligibility
// again through the same function the RLS policy uses, so the button being on
// screen is never what makes a review possible.

export default function ReviewForm({
  tutorId,
  tutorName,
  jobId,
  demoRequestId,
  compact = false,
}: {
  tutorId: string
  tutorName: string
  jobId?: string
  demoRequestId?: string
  compact?: boolean
}) {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [rating, setRating] = useState(5)
  const [comment, setComment] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [done, setDone] = useState(false)

  const submit = async () => {
    setBusy(true)
    setError(null)
    try {
      const res = await fetch('/api/reviews', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tutorId, jobId, demoRequestId, rating, comment }),
      })
      const json = await res.json()
      if (!res.ok) throw new Error(json.error ?? 'Could not save your review.')
      setDone(true)
      setOpen(false)
      router.refresh()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not save your review.')
    } finally {
      setBusy(false)
    }
  }

  if (done) {
    return (
      <p className="text-[11px] font-bold text-tm-green-deep">
        Thank you — your review is now on {tutorName.split(' ')[0]}&apos;s profile.
      </p>
    )
  }

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className={`inline-flex min-h-[44px] items-center justify-center gap-1.5 rounded-xl text-xs font-bold transition-colors ${
          compact
            ? 'text-tm-red underline'
            : 'w-full bg-tm-green-deep px-4 text-white hover:bg-tm-green-deep-hover sm:w-auto'
        }`}
      >
        <Star size={14} className={compact ? '' : 'fill-white'} />
        Leave a review
      </button>
    )
  }

  return (
    <div className="space-y-2 rounded-xl bg-tm-bg p-3">
      <p className="text-[11px] font-bold text-tm-navy">
        How was {tutorName.split(' ')[0]}?
      </p>

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
            <Star
              size={20}
              className={n <= rating ? 'fill-tm-gold stroke-tm-gold' : 'fill-gray-200 stroke-gray-200'}
            />
          </button>
        ))}
      </div>

      <textarea
        value={comment}
        onChange={(e) => setComment(e.target.value)}
        rows={3}
        placeholder="What went well? What could be better? Other parents read this."
        aria-label="Your review"
        className="w-full rounded-xl border border-gray-200 bg-white p-3 text-xs outline-none focus:border-tm-red"
      />

      {error && <p className="text-[11px] font-bold text-tm-red">{error}</p>}

      <div className="flex gap-2">
        <button
          type="button"
          onClick={submit}
          disabled={busy || comment.trim().length < 10}
          className="min-h-[44px] flex-1 rounded-xl bg-tm-green-deep px-4 text-xs font-bold text-white disabled:bg-gray-300"
        >
          {busy ? 'Saving…' : 'Publish review'}
        </button>
        <button
          type="button"
          onClick={() => setOpen(false)}
          className="min-h-[44px] rounded-xl border border-gray-200 px-4 text-xs font-bold text-slate-700"
        >
          Cancel
        </button>
      </div>

      <p className="text-[10px] leading-relaxed text-gray-500">
        Reviews are public on the tutor&apos;s profile and cannot be edited once published.
      </p>
    </div>
  )
}
