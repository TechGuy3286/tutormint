import { AlertTriangle } from 'lucide-react'

import { bridgeStatus } from '@/lib/sms'
import { formatDate } from '@/lib/datetime'

// The BRIDGE_OTP leash banner (owner, Part 5). While the shared bridge code is
// active, every admin screen carries this amber strip so nobody forgets it is
// on: a shared code that verifies any signup is a fake-account risk on an
// indexed site, and it is meant to come off the day a real SMS provider lands.
// Server component — bridgeStatus() reads env, so this ships no secret to the
// browser and renders nothing at all when the bridge is off.

export default function BridgeBanner() {
  const status = bridgeStatus()
  if (!status.active) return null

  return (
    <div
      role="status"
      className="flex items-start gap-2 border-b border-tm-gold/40 bg-tm-tint-gold px-4 py-2 text-tm-gold-ink sm:px-6"
    >
      <AlertTriangle aria-hidden size={16} className="mt-0.5 shrink-0" />
      <p className="text-[11px] font-bold leading-relaxed">
        Bridge OTP is active — remove when the SMS provider lands.
        {status.expiresAt ? ` It expires on ${formatDate(status.expiresAt)}.` : ''}{' '}
        Bridge-verified accounts hold no plan and no badge until they re-verify with a real code.
      </p>
    </div>
  )
}
