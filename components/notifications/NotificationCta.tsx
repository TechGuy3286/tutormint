'use client'

import Link from 'next/link'

import UpgradeTrigger from '@/components/upgrade/UpgradeTrigger'
import { ctaFor, type NotificationCta as Cta } from '@/lib/notificationActions'

// The button on a notification card, drawn once for all three surfaces.
//
// A client component because half of it is: an `upgrade` action opens the
// sheet, which fetches the plan and the price on the press. The `link` half
// could have been a server component, and having two would mean two sets of
// styling for one control.
//
// SMALL AND SECONDARY, deliberately. This sits inside a card that is itself
// usually a link, so a full-width primary button would be two competing
// targets in the same box. `relative z-10` for the same reason a TutorCard's
// buttons carry it — without it the card's own link swallows the press.

export default function NotificationCta({
  row,
  className = '',
}: {
  row: { kind: string; href: string | null }
  className?: string
}) {
  const cta: Cta | null = ctaFor(row)
  if (!cta) return null

  const style =
    `relative z-10 inline-flex min-h-[36px] items-center justify-center rounded-lg px-3 text-[11px] font-black transition-colors ${className}`

  if (cta.kind === 'upgrade') {
    return (
      <UpgradeTrigger reason={cta.reason} className={`${style} bg-tm-gold text-tm-navy hover:opacity-90`}>
        {cta.label}
      </UpgradeTrigger>
    )
  }

  return (
    <Link
      href={cta.href}
      onClick={(e) => e.stopPropagation()}
      className={`${style} border border-gray-200 bg-white text-tm-navy hover:border-tm-navy`}
    >
      {cta.label}
    </Link>
  )
}
