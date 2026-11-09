'use client'

import { useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { AlertTriangle, Check, Mic, MessageCircle, MoreHorizontal, Phone, X } from 'lucide-react'

import { adminFetch } from '@/components/admin/adminFetch'
import NotInterestedButton from '@/components/admin/NotInterestedButton'
import PaidWelcomeActions from '@/components/admin/PaidWelcomeActions'
import { useAdminReadOnly, useDocDecider } from '@/components/admin/ReadOnly'
import { useConfirm } from '@/components/ui/ConfirmDialog'
import { useToast } from '@/components/ui/Toast'
import { formatDate } from '@/lib/datetime'
import { UNDO_MS } from '@/lib/tutorFollowUpTabsCore'
import { dueLine, isFollowStage, KIND_LABEL, sentLine, type PipeKind } from '@/lib/tutorPipelineCore'
import { blankLine, NO_MOBILE_LINE, pipeStatusLine, type PipeCard } from '@/lib/tutorPipelineCardCore'
import { BLANK_REJECT_LABEL, blankRejectReason, type BlankItem } from '@/lib/photoBlankCore'

// People → Tutors (owner, 8 Nov 2026; cleaned up 9 Nov 2026): the pipeline
// block on a tutor card. ONE status line (what is missing, waiting or
// rejected, and the profile %), then the ONE follow-up that is due:
//   Follow-up 1   WhatsApp — opens the ready message, logged on tap.
//   Follow-up 2   voice note — opens the chat; staff record it in WhatsApp,
//                 then tap "Voice note sent" to log it.
//   Follow-up 3+  WhatsApp (logged on tap) or a call ("Call done" logs it).
// Every log has a 10-second Undo; the card moves to Followed up at once.
// A photo that looks blank shows a red flag and a one-tap "Reject — photo
// unclear" (the existing rejection flow and reason; never automatic).
// "Not interested" and its Undo live in the card's "⋯" menu (PipelineMoreMenu).

export type PipeLinks = {
  /** The stage's ready message (number and staff ref already in it). */
  waHref: string | null
  /** The chat with no message, for the voice note. */
  chatHref: string | null
  telHref: string | null
}

const BTN = 'inline-flex min-h-[44px] flex-1 items-center justify-center gap-1.5 rounded-xl px-2 text-[11px] font-bold'
const BLANK_NAME: Record<BlankItem, string> = { photo: 'Profile photo', selfie: 'Selfie' }

export default function PipelineActions({ memberId, pipe, links }: { memberId: string; pipe: PipeCard; links: PipeLinks }) {
  const router = useRouter()
  const toast = useToast()
  const confirm = useConfirm()
  const readOnly = useAdminReadOnly()
  const decider = useDocDecider()
  const [busy, setBusy] = useState(false)

  const undo = async (id: string) => {
    const { ok, data } = await adminFetch<{ error?: string }>('/api/admin/people/follow-up', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'undo', id }),
    })
    if (!ok) return void toast.error(data?.error ?? 'Could not undo that.')
    toast.success('Undone — the tutor is back where they were.')
    router.refresh()
  }

  const record = async (kind: PipeKind) => {
    if (busy) return
    setBusy(true)
    const { ok, data } = await adminFetch<{ error?: string; id?: string; number?: number }>('/api/admin/people/follow-up', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'record', memberId, stage: pipe.stage, kind }),
    })
    setBusy(false)
    if (!ok || !data?.id) return void toast.error(data?.error ?? 'That did not save. Please try again.')
    const id = data.id
    router.refresh()
    toast.success(`Follow-up ${data.number ?? ''} logged (${KIND_LABEL[kind]}) — moved to Followed up`, { label: 'Undo', onClick: () => void undo(id), ms: UNDO_MS })
  }

  // The one-tap rejection of a blank photo — the SAME route and reasons as the
  // Review card; the server decides who may.
  const rejectBlank = async (item: BlankItem) => {
    if (busy) return
    const yes = await confirm({
      title: `Reject the ${BLANK_NAME[item].toLowerCase()}?`,
      body: `The tutor is told: "${blankRejectReason(item)}" and asked to upload a new one.`,
      confirmLabel: 'Reject',
      cancelLabel: 'Cancel',
      destructive: true,
    })
    if (!yes) return
    setBusy(true)
    const { ok, data } = await adminFetch<{ error?: string }>('/api/admin/tutors/document-review', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ tutorId: memberId, item: item === 'photo' ? 'profile_pic' : 'selfie', decision: 'reject', reason: blankRejectReason(item), nameChecked: false }),
    })
    setBusy(false)
    if (!ok) return void toast.error(data?.error ?? 'That did not save. Please try again.')
    toast.success('Rejected. The tutor was notified.')
    router.refresh()
  }

  const follow = pipe.follow
  const followable = isFollowStage(pipe.stage) && !pipe.notInterested
  const due = followable && pipe.section === 'not'
  const blank = blankLine(pipe)
  const pending = pipe.pending ?? []
  // Backend Support may decide only a waiting photo or selfie; the Owner any.
  const mayReject = (item: BlankItem) =>
    !readOnly && (decider === 'owner' || (decider === 'staff' && pending.includes(BLANK_NAME[item])))
  const tone =
    pipe.stage === 'rejected'
      ? 'bg-tm-tint-red text-tm-red'
      : pipe.stage === 'approved' || pipe.stage === 'paid'
        ? 'bg-tm-tint-green text-tm-green-deep'
        : 'bg-tm-tint-gold text-tm-gold-ink'

  return (
    <div className="space-y-2 text-[11px]" data-pipe-stage={pipe.stage}>
      <p data-status-line="" className={`rounded-lg px-2 py-1 font-semibold ${tone}`}>
        {pipeStatusLine(pipe)}
      </p>
      {blank && (
        <div className="space-y-1 rounded-lg border border-tm-red/40 bg-tm-tint-red px-2 py-1.5" data-blank-flag="">
          <p className="flex items-center gap-1 font-bold text-tm-red">
            <AlertTriangle aria-hidden size={12} /> {blank}
          </p>
          {(pipe.blank ?? []).filter(mayReject).map((item) => (
            <button
              key={item}
              type="button"
              disabled={busy}
              onClick={() => void rejectBlank(item)}
              className="inline-flex min-h-[36px] w-full items-center justify-center gap-1 rounded-lg border border-tm-red bg-white px-2 font-bold text-tm-red disabled:opacity-50"
            >
              <X aria-hidden size={12} /> {BLANK_REJECT_LABEL}
              {(pipe.blank ?? []).length > 1 ? ` (${BLANK_NAME[item]})` : ''}
            </button>
          ))}
        </div>
      )}
      {pipe.stage === 'paid' && <PaidWelcomeActions memberId={memberId} welcome={pipe.welcome} badge={pipe.badge} />}
      {pipe.noMobile && <p className="font-semibold text-gray-600">{NO_MOBILE_LINE}</p>}
      {pipe.notInterested && <p className="font-semibold text-gray-600">Marked Not interested — no follow-ups.</p>}

      {followable && follow && !pipe.noMobile && (
        <p className={`font-semibold ${due ? 'text-tm-red' : 'text-tm-green-deep'}`}>
          {pipe.section === 'done' ? sentLine(follow, formatDate) : dueLine(follow)}
          {due && follow.sent > 0 && pipe.lastContact ? ` · last ${formatDate(pipe.lastContact.at)}${pipe.lastContact.by ? ` by ${pipe.lastContact.by}` : ''}` : ''}
        </p>
      )}

      {!readOnly && due && follow && !pipe.noMobile && (
        <div className="flex flex-wrap gap-2">
          {follow.nextKind !== 'voice' && links.waHref && (
            <a
              href={links.waHref}
              target="_blank"
              rel="noopener noreferrer"
              onClick={() => void record('whatsapp')}
              aria-disabled={busy}
              className={`${BTN} bg-tm-green-deep text-white hover:bg-tm-green-deep-hover`}
            >
              <MessageCircle aria-hidden size={13} /> WhatsApp
            </a>
          )}
          {follow.nextKind === 'voice' && links.chatHref && (
            <>
              <a href={links.chatHref} target="_blank" rel="noopener noreferrer" className={`${BTN} border border-tm-green-deep text-tm-green-deep hover:bg-tm-tint-green`}>
                <Mic aria-hidden size={13} /> Open chat
              </a>
              <button type="button" disabled={busy} onClick={() => void record('voice')} className={`${BTN} bg-tm-green-deep text-white hover:bg-tm-green-deep-hover disabled:opacity-50`}>
                <Check aria-hidden size={13} /> Voice note sent
              </button>
            </>
          )}
          {follow.nextKind === 'either' && links.telHref && (
            <>
              <a href={links.telHref} className={`${BTN} border border-gray-200 text-slate-700 hover:border-tm-navy`}>
                <Phone aria-hidden size={13} /> Call
              </a>
              <button type="button" disabled={busy} onClick={() => void record('call')} className={`${BTN} border border-tm-navy text-tm-navy hover:bg-tm-tint-navy disabled:opacity-50`}>
                <Check aria-hidden size={13} /> Call done
              </button>
            </>
          )}
        </div>
      )}
    </div>
  )
}

/** The card's small "⋯" menu: "Not interested" and its Undo (owner, 9 Nov 2026). */
export function PipelineMoreMenu({ memberId, pipe }: { memberId: string; pipe: PipeCard }) {
  const readOnly = useAdminReadOnly()
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!open) return
    const onDown = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as Node)) setOpen(false)
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false)
    }
    document.addEventListener('mousedown', onDown)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])
  if (readOnly || !isFollowStage(pipe.stage)) return null
  return (
    <div ref={ref} className="relative shrink-0">
      <button
        type="button"
        aria-label="More actions"
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
        className="grid h-9 w-9 place-items-center rounded-lg border border-transparent text-gray-500 hover:border-gray-200 hover:text-tm-navy"
      >
        <MoreHorizontal aria-hidden size={16} />
      </button>
      {open && (
        <div role="menu" className="absolute right-0 top-10 z-20 min-w-[190px] rounded-xl border border-gray-200 bg-white p-2 shadow-lg">
          <NotInterestedButton memberId={memberId} marked={pipe.notInterested} onDone={() => setOpen(false)} />
        </div>
      )}
    </div>
  )
}
