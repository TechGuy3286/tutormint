'use client'

import { Lock, MessageCircle } from 'lucide-react'
import {
  MEMBER_LOCK_LINE,
  SUPPORT_WHATSAPP_DISPLAY,
  memberLockWhatsappHref,
  type MemberLockField,
} from '@/lib/memberLocksCore'

// The one locked box on Edit Profile (owner, 4 Nov 2026): Mobile number, CNIC
// and Email only. The current value (masked), one English line and the
// WhatsApp support button. No Urdu line.

export default function MemberLockBox({
  field,
  value,
  className = '',
}: {
  field: MemberLockField
  /** The current value, already masked. Omitted when there is nothing to show. */
  value?: string | null
  className?: string
}) {
  return (
    <div data-member-lock={field} className={`space-y-2 rounded-xl border border-gray-200 bg-tm-bg p-3 ${className}`}>
      {value && (
        <p className="flex items-center gap-1.5 text-xs font-bold text-tm-navy">
          <Lock aria-hidden size={13} className="shrink-0" />
          <span dir="ltr">{value}</span>
        </p>
      )}
      <p className="text-[11px] font-semibold text-gray-700">{MEMBER_LOCK_LINE[field]}</p>
      <a
        href={memberLockWhatsappHref(field)}
        target="_blank"
        rel="noopener noreferrer"
        className="inline-flex min-h-[40px] items-center gap-1.5 rounded-lg border border-tm-green-deep/30 bg-white px-3 text-[11px] font-bold text-tm-green-deep"
      >
        <MessageCircle aria-hidden size={13} /> WhatsApp {SUPPORT_WHATSAPP_DISPLAY}
      </a>
    </div>
  )
}
