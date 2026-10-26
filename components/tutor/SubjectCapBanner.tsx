import Link from 'next/link'

import { overCapBannerText } from '@/lib/subjectLimitCore'

// Shown on the tutor dashboard and in Settings to a tutor who has more than 15
// subjects (owner, 27 Oct 2026). Nothing is trimmed for them; the pickers only
// let them remove subjects until they are at 15 or fewer (lib/subjectLimitCore).

export default function SubjectCapBanner({ count, href }: { count: number; href?: string }) {
  const text = overCapBannerText(count)
  if (!text) return null
  return (
    <div role="status" data-subject-cap-banner className="rounded-2xl border border-tm-gold/40 bg-tm-tint-gold p-3 text-xs leading-relaxed text-tm-gold-ink">
      <p className="font-bold">{text}</p>
      {href && (
        <Link href={href} className="mt-1 inline-flex min-h-[36px] items-center font-bold text-tm-navy underline">
          Choose your top 15 subjects
        </Link>
      )}
    </div>
  )
}
