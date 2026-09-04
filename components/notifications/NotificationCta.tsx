'use client'

import { ArrowRight, Eye, RefreshCw } from 'lucide-react'
import Link from 'next/link'

import UpgradeTrigger from '@/components/upgrade/UpgradeTrigger'
import { ctaFor, type NotificationCta as Cta } from '@/lib/notificationActions'
import { isPlanEnding } from '@/lib/feedGrouping'

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

  // A plan that has ended, or is about to, gets the SOLID red button. It is the
  // only notification on the platform whose subject is something the member has
  // already lost, and a quiet outlined control beside that sentence reads as an
  // optional extra. Everything else stays secondary on purpose -- a list where
  // every row shouts is a list nobody reads.
  const urgent = isPlanEnding(row.kind) || row.kind === 'plan_expiring'

  const style =
    `relative z-10 inline-flex min-h-[36px] items-center justify-center gap-1.5 rounded-lg px-3 text-[11px] font-black transition-colors ${className}`

  if (cta.kind === 'upgrade') {
    return (
      <UpgradeTrigger reason={cta.reason} className={`${style} bg-tm-gold text-tm-navy hover:opacity-90`}>
        <Eye aria-hidden size={12} />
        {cta.label}
      </UpgradeTrigger>
    )
  }

  const Icon = urgent ? RefreshCw : ArrowRight

  return (
    <Link
      href={cta.href}
      onClick={(e) => e.stopPropagation()}
      className={`${style} ${
        urgent
          ? 'bg-tm-red text-white hover:bg-tm-red-hover'
          : 'border border-gray-200 bg-white text-tm-navy hover:border-tm-navy'
      }`}
    >
      <Icon aria-hidden size={12} />
      {cta.label}
    </Link>
  )
}
