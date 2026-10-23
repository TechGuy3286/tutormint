'use client'

import { useState } from 'react'
import { MessageCircle, Phone, Receipt } from 'lucide-react'

import { adminFetch } from '@/components/admin/adminFetch'
import { useAdminReadOnly } from '@/components/admin/ReadOnly'
import { useToast } from '@/components/ui/Toast'
import { UNDO_MS } from '@/lib/tutorFollowUpTabsCore'
import { FU_FEE_REPLY_KEY } from '@/lib/followUpTemplatesCore'

// Follow-ups → Tutors (owner, 23 Oct 2026): the WhatsApp button opens the
// message picked for the tutor's reason, and records the tap (tutor, reason,
// template, progress, staff, time). A 10-second Undo, for the sender only.
// "Mark as followed up" records a contact made another way (a call). Both move
// the card to Followed up; the page refreshes.
//
// "Fee reply" (owner, 23 Oct 2026) opens the saved "About the Verification Fee"
// message — the answer to "Do I have to pay anything?" — and is recorded the
// same way: same Undo, and it counts as one of the 3 messages.

type Props = {
  memberId: string
  reason: string
  templateKey: string | null
  progress: string
  /** wa.me with the message, or null (no number, or waiting on us). */
  waHref: string | null
  telHref: string | null
  /** The "About the Verification Fee" message, or null with no number. */
  feeReplyHref?: string | null
  /** The card is in Followed up: the button reads "Send again". */
  sent: boolean
  onChanged: () => void
}

const BTN = 'inline-flex min-h-[44px] items-center gap-1.5 rounded-xl px-4 text-xs font-bold'

/** Records a follow-up, then offers the 10-second Undo. */
function useRecorder(p: Pick<Props, 'memberId' | 'reason' | 'progress' | 'onChanged'>) {
  const toast = useToast()
  const [busy, setBusy] = useState(false)

  const undo = async (id: string) => {
    const { ok, data } = await adminFetch<{ error?: string }>('/api/admin/follow-ups/tutor', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'undo', id }),
    })
    if (!ok) return void toast.error(data?.error ?? 'Could not undo that.')
    toast.success('Undone — the tutor is back where they were.')
    p.onChanged()
  }

  const record = async (channel: 'whatsapp' | 'call', templateKey: string | null) => {
    setBusy(true)
    const { ok, data } = await adminFetch<{ error?: string; id?: string }>('/api/admin/follow-ups/tutor', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'record', memberId: p.memberId, channel, reason: p.reason, templateKey, progress: p.progress }),
    })
    setBusy(false)
    if (!ok || !data?.id) return void toast.error(data?.error ?? 'That did not save. Please try again.')
    const id = data.id
    p.onChanged()
    toast.success('Follow-up recorded — moved to Followed up', { label: 'Undo', onClick: () => void undo(id), ms: UNDO_MS })
  }

  return { busy, record }
}

/** "Fee reply" on its own — used on cards that show no WhatsApp follow-up
 *  (waiting on us), so every row with a number has it. */
export function FeeReplyButton(p: Pick<Props, 'memberId' | 'reason' | 'progress' | 'feeReplyHref' | 'onChanged'>) {
  const readOnly = useAdminReadOnly()
  const { busy, record } = useRecorder(p)
  if (readOnly || !p.feeReplyHref) return null
  return (
    <a
      href={p.feeReplyHref}
      target="_blank"
      rel="noopener noreferrer"
      onClick={() => void record('whatsapp', FU_FEE_REPLY_KEY)}
      aria-disabled={busy}
      title="Send “About the Verification Fee” on WhatsApp"
      className={`${BTN} border border-tm-green-deep text-tm-green-deep hover:bg-tm-tint-green`}
    >
      <Receipt aria-hidden size={13} /> Fee reply
    </a>
  )
}

export default function TutorFollowUpButtons(p: Props) {
  const readOnly = useAdminReadOnly()
  const { busy, record } = useRecorder(p)
  if (readOnly) return null

  return (
    <>
      {p.waHref && (
        <a
          href={p.waHref}
          target="_blank"
          rel="noopener noreferrer"
          onClick={() => void record('whatsapp', p.templateKey)}
          aria-disabled={busy}
          className={`${BTN} bg-tm-green-deep text-white hover:bg-tm-green-deep-hover`}
        >
          <MessageCircle aria-hidden size={13} /> {p.sent ? 'Send again' : 'WhatsApp'}
        </a>
      )}
      <FeeReplyButton memberId={p.memberId} reason={p.reason} progress={p.progress} feeReplyHref={p.feeReplyHref} onChanged={p.onChanged} />
      {p.telHref && (
        <a href={p.telHref} className={`${BTN} border border-gray-200 text-slate-700 hover:border-tm-navy`}>
          <Phone aria-hidden size={13} /> Call
        </a>
      )}
      <button
        type="button"
        onClick={() => void record('call', null)}
        disabled={busy}
        className="min-h-[44px] self-center px-1 text-[11px] font-bold text-tm-navy underline-offset-2 hover:underline disabled:opacity-50"
      >
        Mark as followed up
      </button>
    </>
  )
}
