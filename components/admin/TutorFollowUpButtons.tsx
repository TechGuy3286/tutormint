'use client'

import { useState } from 'react'
import { MessageCircle, Phone } from 'lucide-react'

import { adminFetch } from '@/components/admin/adminFetch'
import { useAdminReadOnly } from '@/components/admin/ReadOnly'
import { useToast } from '@/components/ui/Toast'
import { UNDO_MS } from '@/lib/tutorFollowUpTabsCore'

// Follow-ups → Tutors (owner, 23 Oct 2026): the WhatsApp button opens the
// message picked for the tutor's reason, and records the tap (tutor, reason,
// template, progress, staff, time). A 10-second Undo, for the sender only.
// "Mark as followed up" records a contact made another way (a call). Both move
// the card to Sent; the page refreshes.

type Props = {
  memberId: string
  reason: string
  templateKey: string | null
  progress: string
  /** wa.me with the message, or null (no number, or waiting on us). */
  waHref: string | null
  telHref: string | null
  /** The card is in Sent: the button reads "Send again". */
  sent: boolean
  onChanged: () => void
}

const BTN = 'inline-flex min-h-[44px] items-center gap-1.5 rounded-xl px-4 text-xs font-bold'

export default function TutorFollowUpButtons(p: Props) {
  const readOnly = useAdminReadOnly()
  const toast = useToast()
  const [busy, setBusy] = useState(false)
  if (readOnly) return null

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

  const record = async (channel: 'whatsapp' | 'call') => {
    setBusy(true)
    const { ok, data } = await adminFetch<{ error?: string; id?: string }>('/api/admin/follow-ups/tutor', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'record', memberId: p.memberId, channel, reason: p.reason, templateKey: p.templateKey, progress: p.progress }),
    })
    setBusy(false)
    if (!ok || !data?.id) return void toast.error(data?.error ?? 'That did not save. Please try again.')
    const id = data.id
    p.onChanged()
    toast.success('Follow-up recorded — moved to Sent', { label: 'Undo', onClick: () => void undo(id), ms: UNDO_MS })
  }

  return (
    <>
      {p.waHref && (
        <a
          href={p.waHref}
          target="_blank"
          rel="noopener noreferrer"
          onClick={() => void record('whatsapp')}
          aria-disabled={busy}
          className={`${BTN} bg-tm-green-deep text-white hover:bg-tm-green-deep-hover`}
        >
          <MessageCircle aria-hidden size={13} /> {p.sent ? 'Send again' : 'WhatsApp'}
        </a>
      )}
      {p.telHref && (
        <a href={p.telHref} className={`${BTN} border border-gray-200 text-slate-700 hover:border-tm-navy`}>
          <Phone aria-hidden size={13} /> Call
        </a>
      )}
      <button
        type="button"
        onClick={() => void record('call')}
        disabled={busy}
        className="min-h-[44px] self-center px-1 text-[11px] font-bold text-tm-navy underline-offset-2 hover:underline disabled:opacity-50"
      >
        Mark as followed up
      </button>
    </>
  )
}
