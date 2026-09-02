'use client'

import { useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import ReviewForm from '@/components/ReviewForm'

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
}

const BTN =
  'inline-flex min-h-[44px] items-center justify-center rounded-xl px-3 text-xs font-bold transition-colors disabled:opacity-60'

export default function DemoInbox({ role, demos }: { role: 'parent' | 'tutor'; demos: DemoRow[] }) {
  const router = useRouter()
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [openForm, setOpenForm] = useState<string | null>(null)
  const [time, setTime] = useState('')
  const [reason, setReason] = useState('')
  const [rating, setRating] = useState(5)
  const [feedback, setFeedback] = useState('')

  const call = async (url: string, payload: Record<string, unknown>) => {
    setBusy(String(payload.demoId))
    setError(null)
    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      })
      const json = await res.json()
      if (!res.ok) throw new Error(json.error ?? 'Something went wrong.')
      setOpenForm(null)
      setTime('')
      setReason('')
      setFeedback('')
      router.refresh()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Something went wrong.')
    } finally {
      setBusy(null)
    }
  }

  if (demos.length === 0) {
    return (
      <section className="space-y-2 rounded-2xl border border-gray-200 bg-white p-4 sm:p-5">
        <h2 className="text-sm font-black text-tm-navy">Demo classes</h2>
        <p className="text-xs text-gray-500">
          {role === 'parent'
            ? 'No demo requests yet. Request one free demo from any tutor you are considering.'
            : 'No demo requests yet. Parents can ask you for one free demo each.'}
        </p>
      </section>
    )
  }

  return (
    <section className="space-y-3 rounded-2xl border border-gray-200 bg-white p-4 sm:p-5">
      <h2 className="text-sm font-black text-tm-navy">Demo classes</h2>
      {error && <p className="text-[11px] font-bold text-tm-red">{error}</p>}

      <ul className="space-y-3">
        {demos.map((d) => {
          const who = role === 'parent' ? d.tutorName : (d.parentName ?? 'A parent')
          return (
            <li key={d.id} className="space-y-2 rounded-xl bg-tm-bg p-3">
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <p className="text-xs font-black text-tm-navy">
                  {role === 'parent' && d.tutorSlug ? (
                    <Link href={`/tutor/${d.tutorSlug}`} className="hover:underline">
                      {who}
                    </Link>
                  ) : (
                    who
                  )}
                </p>
                <span className="text-[10px] font-bold uppercase tracking-wide text-gray-500">
                  {d.status}
                  {d.mode ? ` · ${d.mode === 'online' ? 'Online' : 'In person'}` : ''}
                </span>
              </div>

              {d.proposedTime && (
                <p className="text-[11px] font-semibold text-tm-green-deep">
                  Proposed: {new Date(d.proposedTime).toLocaleString('en-PK')}
                </p>
              )}
              {d.declineReason && (
                <p className="text-[11px] text-gray-500">Reason: {d.declineReason}</p>
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
                          })
                        }
                        className={`${BTN} w-full bg-tm-green-deep text-white`}
                      >
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
                          call('/api/demo/respond', { demoId: d.id, action: 'decline', reason })
                        }
                        className={`${BTN} w-full bg-tm-red text-white`}
                      >
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
                        Accept
                      </button>
                      <button
                        type="button"
                        onClick={() => setOpenForm(`decline-${d.id}`)}
                        className={`${BTN} border border-gray-200 text-slate-700`}
                      >
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
                    onClick={() => call('/api/demo/complete', { demoId: d.id })}
                    className={`${BTN} bg-tm-black text-white`}
                  >
                    Mark completed
                  </button>
                  <button
                    type="button"
                    disabled={busy === d.id}
                    onClick={() => call('/api/demo/cancel', { demoId: d.id })}
                    className={`${BTN} border border-gray-200 text-slate-700`}
                  >
                    Cancel
                  </button>
                </div>
              )}

              {role === 'parent' && d.status === 'requested' && (
                <button
                  type="button"
                  disabled={busy === d.id}
                  onClick={() => call('/api/demo/cancel', { demoId: d.id })}
                  className={`${BTN} w-full border border-gray-200 text-slate-700`}
                >
                  Cancel request
                </button>
              )}

              {/* ------------------------------------------------ feedback --- */}
              {role === 'parent' && d.status === 'completed' && !d.feedbackLeft && (
                <div className="space-y-2">
                  {openForm === `fb-${d.id}` ? (
                    <>
                      <label className="block space-y-1">
                        <span className="text-[11px] font-bold text-gray-500">Rating</span>
                        <select
                          value={rating}
                          onChange={(e) => setRating(Number(e.target.value))}
                          className="min-h-[44px] w-full rounded-xl border border-gray-200 bg-white px-3 text-xs font-semibold"
                        >
                          {[5, 4, 3, 2, 1].map((n) => (
                            <option key={n} value={n}>
                              {n} out of 5
                            </option>
                          ))}
                        </select>
                      </label>
                      <textarea
                        value={feedback}
                        onChange={(e) => setFeedback(e.target.value)}
                        rows={3}
                        placeholder="How did the demo go?"
                        aria-label="Demo feedback"
                        className="w-full rounded-xl border border-gray-200 bg-white p-3 text-xs"
                      />
                      <button
                        type="button"
                        disabled={feedback.trim().length < 5 || busy === d.id}
                        onClick={() =>
                          call('/api/demo/feedback', { demoId: d.id, rating, text: feedback })
                        }
                        className={`${BTN} w-full bg-tm-green-deep text-white`}
                      >
                        Send feedback
                      </button>
                    </>
                  ) : (
                    <button
                      type="button"
                      onClick={() => setOpenForm(`fb-${d.id}`)}
                      className={`${BTN} w-full bg-tm-green-deep text-white`}
                    >
                      Leave feedback
                    </button>
                  )}
                </div>
              )}

              {/* A completed demo also earns a public review on the tutor's
                  profile. Feedback above is private to the pair; this is not. */}
              {role === 'parent' && d.status === 'completed' && (
                d.reviewed ? (
                  <p className="text-[11px] font-bold text-tm-green-deep">You reviewed this tutor</p>
                ) : (
                  <ReviewForm tutorId={d.tutorId} tutorName={d.tutorName} demoRequestId={d.id} />
                )
              )}
            </li>
          )
        })}
      </ul>
    </section>
  )
}
