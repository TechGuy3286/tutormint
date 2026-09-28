import { MessageCircle } from 'lucide-react'

import { formatPkMobile } from '@/lib/phone'
import { whatsappTarget, waMeHref } from '@/lib/tutorWhatsapp'

// PR86 — a staff-only "Chat on WhatsApp" button (opens wa.me/92… in a new tab).
// Rendered only inside admin pages that already gate on a role that can see
// contact details, so no extra permission logic here. Never appears on any
// public or member surface.
//
//   * a real WhatsApp number → the button + the formatted number,
//   * no WhatsApp but a verified mobile → the same button on the mobile, with a
//     small "No WhatsApp number — using mobile" note,
//   * nothing usable → renders nothing.

export default function WhatsappChatButton({
  whatsapp,
  whatsappNumber,
  phone,
  compact = false,
  className = '',
}: {
  whatsapp?: string | null
  whatsappNumber?: string | null
  phone?: string | null
  /** Row variant: just the button, no number line or note. */
  compact?: boolean
  className?: string
}) {
  const target = whatsappTarget({ whatsapp, whatsappNumber, phone })
  const href = waMeHref(target)
  if (!href || !target.msisdn) return null

  const button = (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      className="inline-flex min-h-[36px] items-center gap-1.5 rounded-xl bg-tm-green-deep px-3 text-[11px] font-bold text-white transition-colors hover:bg-tm-green-deep-hover"
    >
      <MessageCircle aria-hidden size={13} />
      Chat on WhatsApp
    </a>
  )

  if (compact) return <span className={className}>{button}</span>

  return (
    <div className={`space-y-1 ${className}`}>
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-xs font-bold text-tm-navy">{formatPkMobile(target.msisdn)}</span>
        {button}
      </div>
      {!target.isWhatsapp && (
        <p className="text-[11px] text-gray-500">No WhatsApp number — using mobile</p>
      )}
    </div>
  )
}
