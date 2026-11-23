'use client'
import { CalendarCheck, Check, CheckCheck, Pencil, Send, Star, X } from 'lucide-react'
import EmptyState from '@/components/EmptyState'

import { submitSignal } from '@/lib/submit'

import { useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { formatDateTime } from '@/lib/datetime'
import { demoMode, demoStatus } from '@/lib/display'
import { useToast } from '@/components/ui/Toast'
import { demoIsClosed } from '@/lib/demoFeedbackCore'
import RatingStars from '@/components/RatingStars'

// Demo requests, from either side.
//
// A demo is free, held off-platform, and one per parent-tutor pair. The whole
// lifecycle lives here because it is small: requested -> accepted (with a
// proposed time) or declined -> completed -> feedback.
//
// The tutor sees Accept / Decline; the parent sees what came back and, once
// the demo is done, the feedback form. Either side can cancel while it is
// still open, and either side can mark it completed -- it happened off the
// platform, so whoever remembers first should be able to close it out.

export type DemoRow = {
  id: string
  tutorId: string
  tutorName: string
  tutorSlug: string | null
  parentName?: string
  status: 'requested' | 'accepted' | 'declined' | 'completed' | 'cancelled'
  mode: string | null
  proposedTime: string | null
  declineReason: string | null
  createdAt: string
  feedbackLeft?: boolean
  /** True once this demo has been turned into a public review. */
  reviewed?: boolean
  /** PR-17 D.4: the parent's own feedback on this demo (one per demo). */
  feedback?: { rating: number; text: string; commentStatus: string } | null
}

const BTN =
  'inline-flex min-h-[44px] items-center justify-center gap-1.5 rounded-xl px-3 text-xs font-bold transition-colors disabled:opacity-60'

export default function DemoInbox({ role, demos }: { role: 'parent' | 'tutor'; demos: DemoRow[] }) {
  const router = useRouter()
  const toast = useToast()
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [openForm, setOpenForm] = useState<string | null>(null)
  const [time, setTime] = useState('')
  const [reason, setReason] = useState('')
  const [rating, setRating] = useState(5)
  const [feedback, setFeedback] = useState('')

  const call = async (url: string, payload: Record<string, unknown>, done?: string) => {
    setBusy(String(payload.demoId))
    setError(null)
    try {
      const res = await fetch(url, { signal: submitSignal(),
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      })
      const json = await res.json()
      if (!res.ok) throw new Error(json.error ?? 'That did not save. Please try again, or message us on WhatsApp 0321 5872222.')
      setOpenForm(null)
      setTime('')
      setReason('')
      setFeedback('')
      if (done) toast.success(done)
      router.refresh()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'That did not save. Please try again, or message us on WhatsApp 0321 5872222.')
    } finally {
      setBusy(null)
    }
  }

  if (demos.length === 0) {
    return (
      <section className="space-y-2">
        {role === 'parent' && <h2 className="text-sm font-black text-tm-navy">Demo lessons</h2>}
        <EmptyState
          icon={<CalendarCheck aria-hidden size={18} />}
          title={
            role === 'parent'
              ? 'No demo requests yet. Request one demo lesson from any tutor you are considering.'
              : 'No demo requests yet. Parents can ask you for one demo each.'
          }
          action={
            role === 'parent'
              ? { label: 'Find tutors', href: '/browse/tutors' }
              : { label: 'See open tuitions', href: '/tutor/dashboard/jobs' }
          }
        />
      </section>
    )
  }

  return (
    <section className="space-y-3 rounded-2xl border border-gray-200 bg-white p-4 sm:p-5">
      {role === 'parent' && <h2 className="text-sm font-black text-tm-navy">Demo classes</h2>}
      {error && <p className="text-[11px] font-bold text-tm-red">{error}</p>}

      <ul className="space-y-3">
        {demos.map((d) => {
          const who = role === 'parent' ? d.tutorName : (d.parentName ?? 'A parent')
          return (
            <li
              key={d.id}
              data-demo-status={d.status}
              className={`space-y-2 rounded-xl p-3 ${demoIsClosed(d.status) ? 'bg-gray-100' : 'bg-tm-bg'}`}
            >
              {/* items-center, not items-baseline: the name is now a 44px
                  target and a baseline would leave the status floating at the
                  top of it. */}
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="text-xs font-black text-tm-navy">
                  {role === 'parent' && d.tutorSlug ? (
                    <Link
                      href={`/tutor/${d.tutorSlug}`}
                      className="inline-flex min-h-[44px] items-center hover:underline"
                    >
                      {who}
                    </Link>
                  ) : (
                    who
                  )}
                </p>
                <span className={`text-[10px] font-bold uppercase tracking-wide ${demoIsClosed(d.status) ? 'text-slate-700' : 'text-gray-500'}`}>
                  {demoStatus(d.status)}
                  {demoMode(d.mode) ? ` · ${demoMode(d.mode)}` : ''}
                </span>
              </div>

              {d.proposedTime && (
                <p className="text-[11px] font-semibold text-tm-green-deep">
                  Proposed: {formatDateTime(d.proposedTime)}
                </p>
              )}
              {d.declineReason && (
                <p className={`text-[11px] ${demoIsClosed(d.status) ? 'text-slate-700' : 'text-gray-500'}`}>Reason: {d.declineReason}</p>
              )}

              {/* ------------------------------------------ tutor actions --- */}
              {role === 'tutor' && d.status === 'requested' && (
                <div className="space-y-2">
                  {openForm === `accept-${d.id}` ? (
                    <div className="space-y-2">
                      <input
                        type="datetime-local"
                        value={time}
                        onChange={(e) => setTime(e.target.value)}
                        aria-label="Proposed demo time"
                        className="min-h-[44px] w-full rounded-xl border border-gray-200 bg-white px-3 text-xs font-semibold"
                      />
                      <button
                        type="button"
                        disabled={!time || busy === d.id}
                        onClick={() =>
                          call('/api/demo/respond', {
                            demoId: d.id,
                            action: 'accept',
                            proposedTime: new Date(time).toISOString(),
                          }, 'Time sent to the parent.')
                        }
                        className={`${BTN} w-full bg-tm-green-deep text-white`}
                      >
                        <CalendarCheck aria-hidden size={13} />
                        Confirm time
                      </button>
                    </div>
                  ) : openForm === `decline-${d.id}` ? (
                    <div className="space-y-2">
                      <input
                        value={reason}
                        onChange={(e) => setReason(e.target.value)}
                        placeholder="Short reason for the parent"
                        aria-label="Reason"
                        className="min-h-[44px] w-full rounded-xl border border-gray-200 bg-white px-3 text-xs font-semibold"
                      />
                      <button
                        type="button"
                        disabled={reason.trim().length < 3 || busy === d.id}
                        onClick={() =>
                          call('/api/demo/respond', { demoId: d.id, action: 'decline', reason }, 'Decline sent.')
                        }
                        className={`inline-flex items-center gap-1.5 ${BTN} w-full bg-tm-red text-white`}
                      >
                        <Send aria-hidden size={13} />
                        Send decline
                      </button>
                    </div>
                  ) : (
                    <div className="grid grid-cols-2 gap-2">
                      <button
                        type="button"
                        onClick={() => setOpenForm(`accept-${d.id}`)}
                        className={`${BTN} bg-tm-green-deep text-white`}
                      >
                        <Check aria-hidden size={13} />
                        Accept
                      </button>
                      <button
                        type="button"
                        onClick={() => setOpenForm(`decline-${d.id}`)}
                        className={`${BTN} border border-gray-200 text-slate-700`}
                      >
                        <X aria-hidden size={13} />
                        Decline
                      </button>
                    </div>
                  )}
                </div>
              )}

              {/* --------------------------------------- shared actions ----- */}
              {d.status === 'accepted' && (
                <div className="grid grid-cols-2 gap-2">
                  <button
                    type="button"
                    disabled={busy === d.id}
                    onClick={() => call('/api/demo/complete', { demoId: d.id }, 'Marked as completed.')}
                    className={`${BTN} bg-tm-black text-white`}
                  >
                    <CheckCheck aria-hidden size={13} />
                    Mark completed
                  </button>
                  <button
                    type="button"
                    disabled={busy === d.id}
                    onClick={() => call('/api/demo/cancel', { demoId: d.id }, 'Demo cancelled.')}
                    className={`${BTN} border border-gray-200 text-slate-700`}
                  >
                    <X aria-hidden size={13} />
                    Cancel
                  </button>
                </div>
              )}

              {role === 'parent' && d.status === 'requested' && (
                <button
                  type="button"
                  disabled={busy === d.id}
                  onClick={() => call('/api/demo/cancel', { demoId: d.id }, 'Demo cancelled.')}
                  className={`${BTN} w-full border border-gray-200 text-slate-700`}
                >
                  <X aria-hidden size={13} />
                  Cancel request
                </button>
              )}

              {/* ------------------------------------------------ feedback --- */}
              {/* PR-17 D.4: "Leave feedback" once; afterwards the parent's own
                  stars + comment with a small Edit that opens the same form
                  (it updates the one row — never a second review). The stars
                  count in the tutor's rating at once; the comment shows on the
                  profile once checked. */}
              {role === 'parent' && d.status === 'completed' && (
                <div className="space-y-2">
                  {openForm === `fb-${d.id}` ? (
                    <>
                      <div className="space-y-1">
                        <span id={`rate-${d.id}`} className="text-[11px] font-bold text-gray-500">Rating</span>
                        <div role="radiogroup" aria-labelledby={`rate-${d.id}`} className="flex gap-1">
                          {[1, 2, 3, 4, 5].map((n) => (
                            <button
                              key={n}
                              type="button"
                              role="radio"
                              aria-checked={rating === n}
                              aria-label={`${n} out of 5`}
                              onClick={() => setRating(n)}
                              className="inline-flex min-h-[44px] min-w-[44px] items-center justify-center rounded-xl"
                            >
                              <Star
                                aria-hidden
                                size={24}
                                className={n <= rating ? 'fill-tm-gold stroke-tm-gold-ink' : 'fill-white stroke-gray-500'}
                              />
                            </button>
                          ))}
                        </div>
                      </div>
                      <textarea
                        value={feedback}
                        onChange={(e) => setFeedback(e.target.value)}
                        rows={3}
                        placeholder="How did the demo go?"
                        aria-label="Demo feedback"
                        className="w-full rounded-xl border border-gray-200 bg-white p-3 text-xs"
                      />
                      <div className="grid grid-cols-2 gap-2">
                        <button
                          type="button"
                          disabled={feedback.trim().length < 5 || busy === d.id}
                          onClick={() =>
                            call(
                              '/api/demo/feedback',
                              { demoId: d.id, rating, text: feedback },
                              d.feedback ? 'Your feedback is updated.' : 'Thank you — your feedback is saved.',
                            )
                          }
                          className={`inline-flex items-center gap-1.5 ${BTN} bg-tm-green-deep text-white`}
                        >
                          <Send aria-hidden size={13} />
                          {d.feedback ? 'Save changes' : 'Send feedback'}
                        </button>
                        <button
                          type="button"
                          onClick={() => setOpenForm(null)}
                          className={`${BTN} border border-gray-200 text-slate-700`}
                        >
                          Cancel
                        </button>
                      </div>
                      {feedback.trim().length < 5 && (
                        <p className="text-[11px] text-gray-500">Write a sentence about how it went.</p>
                      )}
                    </>
                  ) : d.feedback ? (
                    <div className="space-y-1 rounded-xl bg-white p-3" data-feedback-left="">
                      <div className="flex items-center justify-between gap-2">
                        <p className="text-xs">
                          <RatingStars rating={d.feedback.rating} prefix="You rated" size="md" />
                        </p>
                        <button
                          type="button"
                          onClick={() => {
                            setRating(d.feedback!.rating)
                            setFeedback(d.feedback!.text)
                            setOpenForm(`fb-${d.id}`)
                          }}
                          className="inline-flex min-h-[44px] items-center gap-1 px-2 text-[11px] font-bold text-tm-navy hover:underline"
                        >
                          <Pencil aria-hidden size={12} />
                          Edit
                        </button>
                      </div>
                      {d.feedback.text && <p className="text-xs leading-relaxed text-slate-700">{d.feedback.text}</p>}
                      {d.feedback.commentStatus !== 'approved' && (
                        <p className="text-[11px] text-gray-500">
                          {d.feedback.commentStatus === 'rejected'
                            ? 'Your stars count in the tutor’s rating. Your comment is not shown on their profile.'
                            : 'Your stars count in the tutor’s rating. Your comment shows on their profile once our team has checked it.'}
                        </p>
                      )}
                    </div>
                  ) : (
                    <button
                      type="button"
                      onClick={() => {
                        setRating(5)
                        setFeedback('')
                        setOpenForm(`fb-${d.id}`)
                      }}
                      className={`${BTN} w-full bg-tm-green-deep text-white`}
                    >
                      <Star aria-hidden size={13} />
                      Leave feedback
                    </button>
                  )}
                </div>
              )}
            </li>
          )
        })}
      </ul>
    </section>
  )
}
