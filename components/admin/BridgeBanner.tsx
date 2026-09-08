import { AlertTriangle } from 'lucide-react'

import { bridgeStatus, bridgeBanner } from '@/lib/sms'

// The BRIDGE_OTP leash banner (owner, Part 5; countdown added Part 6). While the
// shared bridge code is active it shows the days remaining, so a deadline does
// not arrive silently and close signup silently now that the public pages are
// indexed. Once expired it stays up with different copy rather than
// disappearing — a dead bridge with no SMS provider means new signups cannot
// verify at all, which admins need told. It is absent only when a bridge was
// never configured. Server component — bridgeStatus() reads env, so this ships
// no secret to the browser.

export default function BridgeBanner() {
  const banner = bridgeBanner(bridgeStatus())
  if (!banner.show) return null

  return (
    <div
      role="status"
      className={`flex items-start gap-2 border-b px-4 py-2 sm:px-6 ${
        banner.expired
          ? 'border-tm-red/40 bg-tm-tint-red text-tm-red'
          : 'border-tm-gold/40 bg-tm-tint-gold text-tm-gold-ink'
      }`}
    >
      <AlertTriangle aria-hidden size={16} className="mt-0.5 shrink-0" />
      <p className="text-[11px] font-bold leading-relaxed">
        {banner.message}
        {!banner.expired && (
          <>
            {' '}
            Bridge-verified accounts hold no plan and no badge until they re-verify with a real code.
          </>
        )}
      </p>
    </div>
  )
}
