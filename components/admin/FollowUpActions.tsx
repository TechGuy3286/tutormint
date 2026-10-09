'use client'

import { useState } from 'react'
import { MessageCircle, Phone } from 'lucide-react'

import { useToast } from '@/components/ui/Toast'
import { useAdminReadOnly } from '@/components/admin/ReadOnly'
import { adminFetch } from '@/components/admin/adminFetch'
import type { FollowUpChannel, FollowUpSource } from '@/lib/followUpCore'

// One-tap follow-up (owner, 9 Oct 2026), shared by Overview "Stuck in
// onboarding", Unpaid signups and Abandoned signups:
//   WhatsApp  — opens wa.me with the template prefilled (staff send it by
//               hand) AND records a follow-up; the card moves to "Follow-up
//               sent", with an Undo toast. On the Follow-up sent tab it reads
//               "Send again" and records another.
//   Call      — still just dials.
//   "Mark as followed up" — records a Call follow-up and moves the card the
//               same way (also on cards with no number).
// A Partner (view-only) sees the card but none of these controls; the route
// refuses them anyway.

export type FollowUpProps = {
  memberId: string
  source: FollowUpSource
  templateKey: string | null
  /** wa.me link with the text prefilled, or null when there is no number. */
  waHref: string | null
  telHref: string | null
  /** Which tab the card is on. */
  tab: 'stuck' | 'sent'
  /** Called once a follow-up is recorded (move the card) and on Undo. */
  onMoved?: (memberId: string) => void
  onRestored?: (memberId: string) => void
  /** Class for the WhatsApp / Call buttons (matches the card's own buttons). */
  btnClass?: string
}

const BTN = 'inline-flex min-h-[44px] flex-1 items-center justify-center gap-1.5 rounded-xl px-2 text-[11px] font-bold'

export function useFollowUp({ memberId, source, templateKey, tab, onMoved, onRestored }: Pick<FollowUpProps, 'memberId' | 'source' | 'templateKey' | 'tab' | 'onMoved' | 'onRestored'>) {
  const toast = useToast()
  const [busy, setBusy] = useState(false)

  const undo = async (id: string) => {
    const { ok, data } = await adminFetch<{ error?: string }>('/api/admin/follow-ups', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'undo', id }),
    })
    if (!ok) {
      toast.error(data?.error ?? 'Could not undo that.')
      return
    }
    onRestored?.(memberId)
    toast.success('Follow-up undone.')
  }

  const record = async (channel: FollowUpChannel) => {
    setBusy(true)
    const { ok, data } = await adminFetch<{ error?: string; id?: string }>('/api/admin/follow-ups', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'record', memberId, channel, templateKey: channel === 'whatsapp' ? templateKey : null, source }),
    })
    setBusy(false)
    if (!ok || !data?.id) {
      toast.error(data?.error ?? 'That did not save. Please try again.')
      return
    }
    const id = data.id
    onMoved?.(memberId)
    toast.success(tab === 'sent' ? 'Follow-up recorded' : 'Moved to Follow-up sent', { label: 'Undo', onClick: () => void undo(id) })
  }

  return { record, busy }
}

export default function FollowUpActions(p: FollowUpProps) {
  const readOnly = useAdminReadOnly()
  const { record, busy } = useFollowUp(p)
  const btn = p.btnClass ?? BTN
  if (readOnly) return null
  return (
    <>
      {p.waHref && (
        <a
          href={p.waHref}
          target="_blank"
          rel="noopener noreferrer"
          // The link opens WhatsApp in a new tab (never blocked as a popup);
          // the follow-up is recorded alongside.
          onClick={() => void record('whatsapp')}
          aria-disabled={busy}
          className={`${btn} bg-tm-green-deep text-white hover:bg-tm-green-deep-hover`}
        >
          <MessageCircle aria-hidden size={13} /> {p.tab === 'sent' ? 'Send again' : 'WhatsApp'}
        </a>
      )}
      {p.telHref && (
        <a href={p.telHref} className={`${btn} border border-gray-200 text-slate-700 hover:border-tm-navy`}>
          <Phone aria-hidden size={13} /> Call
        </a>
      )}
    </>
  )
}

/** The small "Mark as followed up" text link under the buttons. */
export function MarkFollowedUp(p: Pick<FollowUpProps, 'memberId' | 'source' | 'templateKey' | 'tab' | 'onMoved' | 'onRestored'>) {
  const readOnly = useAdminReadOnly()
  const { record, busy } = useFollowUp(p)
  if (readOnly) return null
  return (
    <button
      type="button"
      onClick={() => void record('call')}
      disabled={busy}
      className="min-h-[32px] self-start text-[11px] font-bold text-tm-navy underline-offset-2 hover:underline disabled:opacity-50"
    >
      Mark as followed up
    </button>
  )
}
