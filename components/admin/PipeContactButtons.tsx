'use client'

import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { useRouter } from 'next/navigation'
import { Mic, MessageCircle, Phone } from 'lucide-react'

import { adminFetch } from '@/components/admin/adminFetch'
import { followUpLeaves, notInterestedLeaves, usePipelineMove, type Moved } from '@/components/admin/PipelineMoves'
import { useConfirm } from '@/components/ui/ConfirmDialog'
import { useToast } from '@/components/ui/Toast'
import { UNDO_MS } from '@/lib/tutorFollowUpTabsCore'
import { KIND_LABEL, type FollowStage, type FollowState, type PipeKind } from '@/lib/tutorPipelineCore'

// The follow-up contact buttons for a tutor (owner, 15 Nov 2026), on the
// People → Tutors card AND the admin member page, so a contact made from
// either place is logged the same way and moves the card:
//   WhatsApp    opens the stage's ready message; logged on tap.
//   Voice note  opens the chat; back on the page, "Voice note sent?" logs it.
//   Call        opens the dialler; back on the page, "Reached them?":
//               Yes, talked  → the follow-up;
//               No answer    → an attempt only (due again tomorrow);
//               Wrong number → an attempt, then offers "Not interested · Wrong number".
// Every logged follow-up has the 10-second Undo. Opening a card or a page logs
// nothing.

export type PipeContactLinks = {
  /** The stage's ready message (number and staff ref already in it). */
  waHref: string | null
  /** The chat with no message, for the voice note. */
  chatHref: string | null
  telHref: string | null
}

type Ask = 'call' | 'voice' | null

export default function PipeContactButtons({
  memberId,
  stage,
  nextKind,
  links,
  from,
  btnClass,
  showWhatsApp = true,
  showVoice = true,
}: {
  memberId: string
  stage: FollowStage
  nextKind: FollowState['nextKind']
  links: PipeContactLinks
  /** 'card' = only the due action; 'member' = every channel, any one counts. */
  from: 'card' | 'member'
  btnClass: string
  showWhatsApp?: boolean
  showVoice?: boolean
}) {
  const router = useRouter()
  const toast = useToast()
  const confirm = useConfirm()
  const move = usePipelineMove()
  const [busy, setBusy] = useState(false)
  const [ask, setAsk] = useState<Ask>(null)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  useEffect(() => () => {
    if (timer.current) clearTimeout(timer.current)
  }, [])

  const post = <T,>(body: Record<string, unknown>) =>
    adminFetch<T & { error?: string }>('/api/admin/people/follow-up', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })

  const undo = async (id: string) => {
    move.begin(memberId, false)
    const { ok, data } = await post<{ moved?: Moved }>({ action: 'undo', id })
    if (!ok) {
      move.fail(memberId)
      return void toast.error(data?.error ?? 'Could not undo that.')
    }
    move.done(memberId, data?.moved)
    toast.success('Undone — the tutor is back where they were.')
    router.refresh()
  }

  const record = async (kind: PipeKind) => {
    if (busy) return
    setBusy(true)
    // The card leaves its chip at once (owner, 15 Nov 2026); back if the save fails.
    move.begin(memberId, followUpLeaves(move.view))
    const { ok, data } = await post<{ id?: string; number?: number; moved?: Moved }>({ action: 'record', memberId, stage, kind, from })
    setBusy(false)
    if (!ok || !data?.id) {
      move.fail(memberId)
      return void toast.error(data?.error ?? 'That did not save. Please try again.')
    }
    move.done(memberId, data.moved)
    const id = data.id
    router.refresh()
    toast.success(`Follow-up ${data.number ?? ''} logged (${KIND_LABEL[kind]})`, { label: 'Undo', onClick: () => void undo(id), ms: UNDO_MS })
  }

  const attempt = async (outcome: 'no_answer' | 'wrong_number') => {
    if (busy) return
    setBusy(true)
    move.begin(memberId, false)
    const { ok, data } = await post<{ suggestNotInterested?: boolean; moved?: Moved }>({ action: 'attempt', memberId, outcome })
    setBusy(false)
    if (!ok) {
      move.fail(memberId)
      return void toast.error(data?.error ?? 'That did not save. Please try again.')
    }
    move.done(memberId, data?.moved)
    router.refresh()
    if (outcome === 'no_answer') return void toast.success('No answer logged. They stay in Not followed up, due again tomorrow.')
    toast.success('Wrong number logged.')
    const yes = await confirm({
      title: 'Mark as Not interested?',
      body: 'Reason: Wrong number. They leave the follow-up lists; you can undo it from the card menu.',
      confirmLabel: 'Mark Not interested',
      cancelLabel: 'Not now',
    })
    if (!yes) return
    move.begin(memberId, notInterestedLeaves(move.view))
    const r = await adminFetch<{ error?: string; moved?: Moved }>('/api/admin/follow-ups/not-interested', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ memberId, reason: 'wrong_number' }),
    })
    if (!r.ok) {
      move.fail(memberId)
      return void toast.error(r.data?.error ?? 'That did not save. Please try again.')
    }
    move.done(memberId, r.data?.moved)
    toast.success('Marked Not interested · Wrong number.')
    router.refresh()
  }

  // Ask once the dialler / chat has had a moment to open — on a phone the page
  // is hidden meanwhile, and the question is waiting when staff come back.
  const askSoon = (what: Exclude<Ask, null>) => {
    if (timer.current) clearTimeout(timer.current)
    timer.current = setTimeout(() => setAsk(what), 700)
  }

  const wantWhatsApp = showWhatsApp && !!links.waHref && (from === 'member' || nextKind !== 'voice')
  const wantVoice = showVoice && !!links.chatHref && (from === 'member' || nextKind === 'voice')

  return (
    <>
      {wantWhatsApp && (
        <a
          href={links.waHref as string}
          target="_blank"
          rel="noopener noreferrer"
          onClick={() => void record('whatsapp')}
          aria-disabled={busy}
          data-pipe-wa=""
          className={`${btnClass} bg-tm-green-deep text-white hover:bg-tm-green-deep-hover`}
        >
          <MessageCircle aria-hidden size={13} /> WhatsApp
        </a>
      )}
      {wantVoice && (
        <a
          href={links.chatHref as string}
          target="_blank"
          rel="noopener noreferrer"
          onClick={() => askSoon('voice')}
          data-pipe-voice=""
          className={`${btnClass} ${from === 'card' ? 'bg-tm-green-deep text-white hover:bg-tm-green-deep-hover' : 'border border-tm-green-deep text-tm-green-deep hover:bg-tm-tint-green'}`}
        >
          <Mic aria-hidden size={13} /> Voice note
        </a>
      )}
      {links.telHref && (
        <a href={links.telHref} onClick={() => askSoon('call')} data-pipe-call="" className={`${btnClass} border border-gray-200 bg-white text-slate-700 hover:border-tm-navy`}>
          <Phone aria-hidden size={13} /> Call
        </a>
      )}
      {ask && (
        <AskDialog
          title={ask === 'call' ? 'Reached them?' : 'Voice note sent?'}
          busy={busy}
          options={
            ask === 'call'
              ? [
                  { key: 'yes', label: 'Yes, talked', primary: true, run: () => record('call') },
                  { key: 'no_answer', label: 'No answer', run: () => attempt('no_answer') },
                  { key: 'wrong_number', label: 'Wrong number', run: () => attempt('wrong_number') },
                ]
              : [
                  { key: 'yes', label: 'Yes, sent', primary: true, run: () => record('voice') },
                  { key: 'no', label: 'Not yet', run: async () => {} },
                ]
          }
          onClose={() => setAsk(null)}
        />
      )}
    </>
  )
}

/** A small question in a portal (cards lift on hover, so nothing fixed may sit
 *  inside one). Escape or the backdrop closes it without logging anything. */
function AskDialog({
  title,
  options,
  busy,
  onClose,
}: {
  title: string
  options: { key: string; label: string; primary?: boolean; run: () => Promise<void> | void }[]
  busy: boolean
  onClose: () => void
}) {
  const first = useRef<HTMLButtonElement>(null)
  useEffect(() => {
    first.current?.focus()
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [onClose])
  if (typeof document === 'undefined') return null
  return createPortal(
    <div className="fixed inset-0 z-[90] flex items-end justify-center bg-tm-black/40 p-4 sm:items-center" onClick={onClose} data-pipe-ask="">
      <div role="dialog" aria-modal="true" aria-label={title} className="w-full max-w-sm space-y-3 rounded-2xl bg-white p-4 shadow-xl" onClick={(e) => e.stopPropagation()}>
        <p className="text-sm font-black text-tm-navy">{title}</p>
        <div className="flex flex-col gap-2">
          {options.map((o, i) => (
            <button
              key={o.key}
              ref={i === 0 ? first : undefined}
              type="button"
              disabled={busy}
              onClick={async () => {
                onClose()
                await o.run()
              }}
              className={`min-h-[44px] rounded-xl px-3 text-xs font-bold disabled:opacity-50 ${
                o.primary ? 'bg-tm-green-deep text-white hover:bg-tm-green-deep-hover' : 'border border-gray-200 text-slate-700 hover:border-tm-navy'
              }`}
            >
              {o.label}
            </button>
          ))}
        </div>
      </div>
    </div>,
    document.body,
  )
}
