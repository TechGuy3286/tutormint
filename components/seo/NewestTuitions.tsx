import Link from 'next/link'

import type { TuitionLink } from '@/lib/newestTuitionsCore'

// "Newest tuitions" (owner, 16 Oct 2026): the latest live tuitions in a scope,
// linked by title. Server component; renders nothing when the list is empty.
// `variant="row"` is the homepage's compact link row; "list" a hub's box.

export default function NewestTuitions({
  links,
  heading = 'Newest tuitions',
  variant = 'list',
}: {
  links: TuitionLink[]
  heading?: string
  variant?: 'list' | 'row'
}) {
  if (links.length === 0) return null
  if (variant === 'row') {
    return (
      <nav aria-label={heading} className="flex flex-wrap items-center justify-center gap-x-2 gap-y-1 text-[11px] text-gray-500">
        <span className="font-bold text-tm-navy">{heading}:</span>
        {links.map((l, i) => (
          <span key={l.id} className="inline-flex min-w-0 max-w-full items-center gap-2">
            {i > 0 && <span aria-hidden>·</span>}
            <Link href={l.href} className="inline-flex min-h-[32px] min-w-0 items-center font-semibold text-tm-navy hover:underline">
              <span className="truncate">{l.title}</span>
            </Link>
          </span>
        ))}
      </nav>
    )
  }
  return (
    <nav aria-label={heading} className="space-y-1.5 rounded-2xl border border-gray-200 bg-white p-4 sm:p-5">
      <h2 className="text-xs font-black text-tm-navy">{heading}</h2>
      <ul className="space-y-0.5">
        {links.map((l) => (
          <li key={l.id}>
            <Link href={l.href} className="inline-flex min-h-[32px] items-center text-xs font-semibold text-tm-navy hover:underline">
              {l.title}
            </Link>
          </li>
        ))}
      </ul>
    </nav>
  )
}
