import { MessageCircle } from 'lucide-react'

import MaskedContact from '@/components/admin/MaskedContact'
import { maskPhoneDisplay } from '@/lib/contactMaskCore'
import { whatsappTarget } from '@/lib/tutorWhatsapp'
import { adminWhatsAppRoute, type WhatsAppFrom } from '@/lib/adminWhatsAppCore'
import AdminWhatsAppLink from '@/components/admin/AdminWhatsAppLink'

// PR86 — a staff-only "Chat on WhatsApp" button (opens wa.me/92… in a new tab,
// with a message pre-filled from the member's state — owner, 20 Oct 2026).
// Rendered only inside admin pages that already gate on a role that can see
// contact details, so no extra permission logic here. Never appears on any
// public or member surface.
//
//   * a real WhatsApp number → the button + the formatted number,
//   * no WhatsApp but a verified mobile → the same button on the mobile, with a
//     small "No WhatsApp number — using mobile" note,
//   * nothing usable → renders nothing.

export default function WhatsappChatButton({
  memberId,
  from,
  whatsapp,
  whatsappNumber,
  phone,
  compact = false,
  className = '',
}: {
  /** The member: the server builds the pre-filled message from their state. */
  memberId: string
  from: WhatsAppFrom
  whatsapp?: string | null
  whatsappNumber?: string | null
  phone?: string | null
  /** Row variant: just the button, no number line or note. */
  compact?: boolean
  className?: string
}) {
  const target = whatsappTarget({ whatsapp, whatsappNumber, phone })
  const href = target.msisdn ? adminWhatsAppRoute(memberId, from) : null
  if (!href || !target.msisdn) return null

  const button = (
    <AdminWhatsAppLink
      memberId={memberId}
      from={from}
      className="inline-flex min-h-[36px] items-center gap-1.5 rounded-xl bg-tm-green-deep px-3 text-[11px] font-bold text-white transition-colors hover:bg-tm-green-deep-hover"
    >
      <MessageCircle aria-hidden size={13} />
      Chat on WhatsApp
    </AdminWhatsAppLink>
  )

  if (compact) return <span className={className}>{button}</span>

  return (
    <div className={`space-y-1 ${className}`}>
      <div className="flex flex-wrap items-center gap-2">
        {/* Masked, with a logged Show (owner, 27 Oct 2026); the button still opens the chat. */}
        <span className="text-xs font-bold text-tm-navy">
          <MaskedContact memberId={memberId} field="whatsapp" masked={maskPhoneDisplay(target.msisdn) ?? '••••'} />
        </span>
        {button}
      </div>
      {!target.isWhatsapp && (
        <p className="text-[11px] text-gray-500">No WhatsApp number — using mobile</p>
      )}
    </div>
  )
}
