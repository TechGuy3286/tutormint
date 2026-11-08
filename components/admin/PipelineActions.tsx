'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Check, Mic, MessageCircle, Phone } from 'lucide-react'

import { adminFetch } from '@/components/admin/adminFetch'
import NotInterestedButton from '@/components/admin/NotInterestedButton'
import { useAdminReadOnly } from '@/components/admin/ReadOnly'
import { useToast } from '@/components/ui/Toast'
import { formatDate } from '@/lib/datetime'
import { UNDO_MS } from '@/lib/tutorFollowUpTabsCore'
import { dueLine, isFollowStage, KIND_LABEL, sentLine, type PipeKind } from '@/lib/tutorPipelineCore'
import type { PipeCard } from '@/lib/tutorPipelineCardCore'

// People → Tutors (owner, 8 Nov 2026): the pipeline block on a tutor card.
// It says what is missing / rejected / pending and where the follow-ups stand,
// and offers the ONE follow-up that is due:
//   Follow-up 1   WhatsApp — opens the ready message, logged on tap.
//   Follow-up 2   voice note — opens the chat; staff record it in WhatsApp,
//                 then tap "Voice note sent" to log it.
//   Follow-up 3+  WhatsApp (logged on tap) or a call ("Call done" logs it).
// Every log has a 10-second Undo; the card moves to Followed up at once.

export type PipeLinks = {
  /** The stage's ready message (number and staff ref already in it). */
  waHref: string | null
  /** The chat with no message, for the voice note. */
  chatHref: string | null
  telHref: string | null
}

const BTN = 'inline-flex min-h-[44px] flex-1 items-center justify-center gap-1.5 rounded-xl px-2 text-[11px] font-bold'

export default function PipelineActions({ memberId, pipe, links }: { memberId: string; pipe: PipeCard; links: PipeLinks }) {
  const router = useRouter()
  const toast = useToast()
  const readOnly = useAdminReadOnly()
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

  const follow = pipe.follow
  const followable = isFollowStage(pipe.stage) && !pipe.notInterested
  const due = followable && pipe.section === 'not'

  return (
    <div className="space-y-2 text-[11px]" data-pipe-stage={pipe.stage}>
      {pipe.stage === 'missing' && pipe.missing.length > 0 && (
        <p className="rounded-lg bg-tm-tint-gold px-2 py-1 font-semibold text-tm-gold-ink">Missing: {pipe.missing.join(', ')}</p>
      )}
      {pipe.stage === 'rejected' && (
        <div className="space-y-1 rounded-lg bg-tm-tint-red px-2 py-1 font-semibold text-tm-red">
          {pipe.rejected.map((r) => (
            <p key={r.name}>
              Rejected: {r.name}
              {r.reason ? ` — ${r.reason}` : ''}
            </p>
          ))}
          <p className={pipe.informed ? 'text-tm-green-deep' : 'text-tm-red'}>Informed: {pipe.informed ? 'yes' : 'no'}</p>
        </div>
      )}
      {pipe.stage === 'approved' && <p className="rounded-lg bg-tm-tint-green px-2 py-1 font-semibold text-tm-green-deep">Documents approved · fee pending</p>}
      {pipe.notInterested && <p className="font-semibold text-gray-600">Marked Not interested — no follow-ups.</p>}

      {followable && follow && (
        <p className={`font-semibold ${due ? 'text-tm-red' : 'text-tm-green-deep'}`}>
          {pipe.section === 'done' ? sentLine(follow, formatDate) : dueLine(follow)}
          {due && follow.sent > 0 && pipe.lastContact ? ` · last ${formatDate(pipe.lastContact.at)}${pipe.lastContact.by ? ` by ${pipe.lastContact.by}` : ''}` : ''}
        </p>
      )}

      {!readOnly && due && follow && (
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
          {!links.waHref && !links.chatHref && <p className="text-gray-500">No mobile number on file.</p>}
        </div>
      )}
      {!readOnly && isFollowStage(pipe.stage) && <NotInterestedButton memberId={memberId} marked={pipe.notInterested} />}
    </div>
  )
}
