'use client'

import { MessageCircle } from 'lucide-react'

import { PAYMENT_NOT_FINISHED_KEY } from '@/lib/startedPaymentCore'

// "Started, not paid" on the member page (owner, 20 Oct 2026): WhatsApp with the
// payment_not_finished message (Team inbox → Templates) already written. The tap
// is recorded as a follow-up, the same shared record every follow-up writes;
// the record never blocks the message.

export default function PaymentFollowUp({ memberId, href }: { memberId: string; href: string }) {
  const record = () => {
    try {
      void fetch('/api/admin/follow-ups', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'record', memberId, channel: 'whatsapp', templateKey: PAYMENT_NOT_FINISHED_KEY, source: 'unpaid' }),
        keepalive: true,
      })
    } catch {
      /* the record never blocks the message */
    }
  }
  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      onClick={record}
      className="mt-1 inline-flex min-h-[32px] items-center gap-1.5 rounded-lg border border-tm-green-deep/40 bg-tm-tint-green px-2.5 text-[11px] font-bold text-tm-green-deep"
    >
      <MessageCircle aria-hidden size={12} /> WhatsApp follow-up
    </a>
  )
}
