'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import { MessageCircle, SkipForward } from 'lucide-react'

import { adminFetch } from '@/components/admin/adminFetch'
import { useToast } from '@/components/ui/Toast'
import OnItButton from '@/components/admin/OnItButton'
import { formatDate } from '@/lib/datetime'
import { KIND_LABEL, type FollowStage, type PipeKind } from '@/lib/tutorPipelineCore'
import { sessionLine, type ModeOutcome } from '@/lib/followUpModeCore'
import { NI_REASONS, NI_REASON_LABEL, niMarkProblem, type NiReason } from '@/lib/notInterestedCore'
import type { ModeCard } from '@/lib/followUpMode'

// The "Start follow-ups" screen (owner, 23 Nov 2026 — PR-18 Part B). The
// server holds the tutor on screen for this staff member; every button records
// by the existing People rules and the next tutor opens by itself. The session
// count lives in this page only (nothing stored in the browser).

const BTN = 'inline-flex min-h-[44px] items-center justify-center gap-1.5 rounded-xl px-4 text-xs font-bold disabled:opacity-50'

export default function FollowUpModeClient({ stage: initialStage, stages }: { stage: FollowStage; stages: { value: FollowStage; label: string }[] }) {
  const toast = useToast()
  const [stage, setStage] = useState<FollowStage>(initialStage)
  const [card, setCard] = useState<ModeCard | null>(null)
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [opened, setOpened] = useState(false)
  const [done, setDone] = useState(0)
  const [ni, setNi] = useState<{ reason: NiReason | ''; note: string } | null>(null)
  const skip = useRef<string[]>([])

  const post = <T,>(body: Record<string, unknown>) =>
    adminFetch<T & { error?: string }>('/api/admin/people/follow-up-mode', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })

  const next = useCallback(
    async (s: FollowStage) => {
      setLoading(true)
      setError(null)
      setOpened(false)
      setNi(null)
      const { ok, data } = await post<{ card: ModeCard | null }>({ action: 'next', stage: s, skip: skip.current })
      setLoading(false)
      if (!ok) {
        setCard(null)
        setError(data?.error ?? 'Could not load the next tutor. Try again.')
        return
      }
      setCard(data.card ?? null)
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  )

  useEffect(() => {
    void next(stage)
  }, [next, stage])

  const openWhatsApp = async () => {
    if (!card) return
    // Opened first, filled after: a pop-up opened after an await is blocked.
    const tab = window.open('', '_blank')
    setBusy(true)
    const { ok, data } = await post<{ waHref?: string }>({ action: 'open', memberId: card.memberId, stage })
    setBusy(false)
    if (!ok || !data.waHref) {
      tab?.close()
      toast.error(data?.error ?? 'Could not open WhatsApp.')
      return
    }
    if (tab) tab.location.href = data.waHref
    else window.open(data.waHref, '_blank')
    setOpened(true)
  }

  const outcome = async (o: ModeOutcome) => {
    if (!card) return
    if (o === 'not_interested') {
      const problem = niMarkProblem(ni?.reason || null, ni?.note || null)
      if (problem) return void toast.error(problem)
    }
    setBusy(true)
    const { ok, data } = await post<{ counted?: boolean }>({
      action: 'outcome',
      memberId: card.memberId,
      stage,
      outcome: o,
      reason: o === 'not_interested' ? ni?.reason || null : null,
      note: o === 'not_interested' ? ni?.note.trim() || null : null,
    })
    setBusy(false)
    if (!ok) return void toast.error(data?.error ?? 'That did not save. Please try again.')
    skip.current = [...skip.current, card.memberId]
    if (o !== 'skip') setDone((d) => d + 1)
    toast.success(
      o === 'sent' ? `Follow-up ${card.followNumber} recorded for ${card.name}.` : o === 'no_answer' ? 'No answer noted. They are due again tomorrow.' : o === 'not_interested' ? `${card.name} marked Not interested.` : 'Skipped.',
    )
    await next(stage)
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <label className="flex items-center gap-2 text-xs font-bold text-slate-700">
          Stage
          <select
            value={stage}
            onChange={(e) => {
              skip.current = []
              setStage(e.target.value as FollowStage)
            }}
            className="min-h-[44px] rounded-xl border border-gray-200 bg-white px-3 text-xs font-bold text-tm-navy"
          >
            {stages.map((s) => (
              <option key={s.value} value={s.value}>
                {s.label}
              </option>
            ))}
          </select>
        </label>
        <span className="ms-auto rounded-full bg-tm-tint-green px-3 py-1.5 text-xs font-black text-tm-green-deep">{sessionLine(done)}</span>
      </div>

      {error && <p className="rounded-xl bg-tm-tint-red p-3 text-xs font-bold text-tm-red">{error}</p>}

      {loading ? (
        <p className="rounded-2xl border border-gray-200 bg-white p-4 text-sm text-gray-600">Finding the next tutor…</p>
      ) : !card ? (
        <div className="space-y-2 rounded-2xl border border-gray-200 bg-white p-4 text-sm text-gray-600">
          <p>Nobody is due in this stage right now{done > 0 ? ' — well done' : ''}.</p>
          <p>
            Pick another stage above, or go back to{' '}
            <Link href="/admin/users?tab=tutors" className="font-bold text-tm-navy underline">
              People → Tutors
            </Link>
            .
          </p>
        </div>
      ) : (
        <section className="space-y-3 rounded-2xl border border-gray-200 bg-white p-4 sm:p-5" aria-live="polite">
          <div className="flex flex-wrap items-start justify-between gap-2">
            <div className="min-w-0">
              <Link href={`/admin/users/${card.memberId}?from=${encodeURIComponent('/admin/users/follow-up-mode?stage=' + stage)}`} className="text-base font-black text-tm-navy underline-offset-2 hover:underline">
                {card.name}
              </Link>
              <p className="text-xs text-gray-600">
                {[card.city ?? 'No city', card.stageLabel, `signed up ${card.daysSinceSignup === 'today' ? 'today' : `${card.daysSinceSignup} ago`}`].join(' · ')}
              </p>
              <p className="text-xs text-gray-600">
                {card.lastFollowUp
                  ? `Last follow-up: ${KIND_LABEL[card.lastFollowUp.kind as PipeKind] ?? card.lastFollowUp.kind}, ${formatDate(card.lastFollowUp.at)}${card.lastFollowUp.by ? ` by ${card.lastFollowUp.by}` : ''}`
                  : 'Not followed up yet'}{' '}
                · this is follow-up {card.followNumber}
              </p>
              <p className="text-xs font-semibold text-slate-700">
                {card.maskedPhone}
                {!card.numberVerified && ' · Number not verified'}
                {card.stuck && ' · Signed up by email, stuck at the mobile screen'}
              </p>
            </div>
            <span className="shrink-0 text-[11px] font-bold text-gray-600">{card.left} more after this</span>
          </div>

          <OnItButton memberId={card.memberId} initial={card.onIt} compact />

          <pre className="whitespace-pre-wrap rounded-xl bg-tm-bg p-3 font-sans text-xs leading-relaxed text-slate-700">{card.message}</pre>

          <button type="button" disabled={busy} onClick={() => void openWhatsApp()} className={`${BTN} w-full bg-tm-green-deep text-white hover:opacity-90`}>
            <MessageCircle size={15} aria-hidden /> Open WhatsApp
          </button>

          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            <button type="button" disabled={busy || !opened} onClick={() => void outcome('sent')} className={`${BTN} bg-tm-navy text-white hover:bg-tm-navy-hover`} title={opened ? undefined : 'Open WhatsApp first'}>
              Sent
            </button>
            <button type="button" disabled={busy} onClick={() => void outcome('no_answer')} className={`${BTN} border border-gray-200 bg-white text-tm-navy hover:border-tm-navy`}>
              No answer
            </button>
            <button
              type="button"
              disabled={busy}
              onClick={() => setNi((x) => (x ? null : { reason: '', note: '' }))}
              className={`${BTN} border border-gray-200 bg-white text-tm-navy hover:border-tm-navy`}
              aria-expanded={!!ni}
            >
              Not interested
            </button>
            <button type="button" disabled={busy} onClick={() => void outcome('skip')} className={`${BTN} border border-gray-200 bg-white text-slate-700 hover:border-tm-navy`}>
              <SkipForward size={14} aria-hidden /> Skip
            </button>
          </div>
          {!opened && <p className="text-[11px] text-gray-600">Open WhatsApp first, then tap Sent once the message has gone.</p>}

          {ni && (
            <div className="space-y-2 rounded-xl border border-gray-200 p-3">
              <label className="block space-y-1 text-xs font-bold text-slate-700">
                Why not interested?
                <select
                  value={ni.reason}
                  onChange={(e) => setNi({ ...ni, reason: e.target.value as NiReason })}
                  className="min-h-[44px] w-full rounded-xl border border-gray-200 bg-white px-3 text-xs font-semibold text-tm-navy"
                >
                  <option value="">Choose a reason</option>
                  {NI_REASONS.map((r) => (
                    <option key={r} value={r}>
                      {NI_REASON_LABEL[r]}
                    </option>
                  ))}
                </select>
              </label>
              <input
                value={ni.note}
                onChange={(e) => setNi({ ...ni, note: e.target.value })}
                maxLength={500}
                placeholder={ni.reason === 'other' ? 'Say why (needed for Other)' : 'Note (optional)'}
                className="min-h-[44px] w-full rounded-xl border border-gray-200 px-3 text-xs text-tm-navy focus:border-tm-navy focus:outline-none"
              />
              <button type="button" disabled={busy || !ni.reason} onClick={() => void outcome('not_interested')} className={`${BTN} w-full bg-tm-red text-white hover:bg-tm-red-hover`}>
                Mark Not interested
              </button>
            </div>
          )}
        </section>
      )}
    </div>
  )
}
