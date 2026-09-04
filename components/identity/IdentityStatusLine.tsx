import Link from 'next/link'
import { BadgeCheck, Clock, ShieldAlert, ArrowRight } from 'lucide-react'

// The compact identity line for the dashboards. The full identity card — CNIC
// front/back, selfie, "Request a change" — lives ONLY in Settings → Identity
// (tutor: /tutor/dashboard/settings; parent: /parent/verify). A dashboard shows
// one status line, never an upload form.
//
// A Verified account shows only "Verified". It never renders "FRONT Not
// uploaded · BACK Not uploaded": the documents are retained privately in the
// identity-docs bucket and there is nothing for a verified member to do, so
// there is no upload prompt to show.

export type IdentityLineState = 'approved' | 'submitted' | 'rejected' | 'none'

export default function IdentityStatusLine({
  state,
  settingsHref,
}: {
  state: IdentityLineState
  /** Where Settings → Identity lives for this role. */
  settingsHref: string
}) {
  if (state === 'approved') {
    return (
      <div className="flex min-h-[44px] items-center gap-2 rounded-2xl border border-tm-green-deep/30 bg-tm-tint-green px-4 text-xs font-bold text-tm-green-deep">
        <BadgeCheck aria-hidden size={16} className="shrink-0" />
        Identity: Verified
      </div>
    )
  }

  if (state === 'submitted') {
    return (
      <div className="flex min-h-[44px] items-center gap-2 rounded-2xl border border-tm-gold/40 bg-tm-tint-gold px-4 text-xs font-bold text-tm-gold-ink">
        <Clock aria-hidden size={16} className="shrink-0" />
        Identity: Pending review
      </div>
    )
  }

  // none | rejected — action needed. One line, one link into Settings.
  const label = state === 'rejected' ? 'Identity: Not accepted' : 'Identity: Not submitted'
  return (
    <Link
      href={settingsHref}
      className="flex min-h-[44px] items-center justify-between gap-2 rounded-2xl border border-gray-200 bg-white px-4 text-xs font-bold text-tm-navy transition-colors hover:border-tm-navy"
    >
      <span className="flex items-center gap-2">
        <ShieldAlert aria-hidden size={16} className="shrink-0 text-gray-500" />
        {label}
      </span>
      <span className="flex items-center gap-1 text-tm-red">
        Complete in Settings
        <ArrowRight aria-hidden size={13} />
      </span>
    </Link>
  )
}
