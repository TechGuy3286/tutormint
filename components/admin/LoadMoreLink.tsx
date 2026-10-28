'use client'

// "Load more" for admin lists (owner, 28 Oct 2026) — see lib/adminPagingCore.
// A link to the same address with `?n=` raised by 25: the server filters,
// searches and counts the whole list and sends 25 more rows. The page does not
// jump to the top (scroll={false}) and the button shows a spinner while the next
// rows load (useLinkStatus).

import Link, { useLinkStatus } from 'next/link'
import { usePathname, useSearchParams } from 'next/navigation'
import { Loader2 } from 'lucide-react'
import { ADMIN_PAGE_SIZE, shownLine } from '@/lib/adminPagingCore'

function Spinner() {
  const { pending } = useLinkStatus()
  return pending ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : null
}

export default function LoadMoreLink({
  shown,
  total,
  noun = 'items',
  size = ADMIN_PAGE_SIZE,
  param = 'n',
}: {
  shown: number
  total: number
  noun?: string
  size?: number
  /** The address parameter that holds the count (a page with two lists uses two). */
  param?: string
}) {
  const path = usePathname()
  const sp = useSearchParams()
  const more = Math.max(0, total - shown)
  const next = new URLSearchParams(sp?.toString() ?? '')
  next.set(param, String(shown + size))
  return (
    <div className="flex flex-col items-center gap-2 pt-3" data-load-more>
      <p className="text-xs text-gray-500">{shownLine({ shown, total }, noun)}</p>
      {more > 0 && (
        <Link
          href={`${path}?${next.toString()}`}
          scroll={false}
          prefetch={false}
          className="inline-flex min-h-[44px] items-center gap-2 rounded-xl border border-gray-300 bg-white px-5 text-sm font-bold text-tm-navy hover:border-tm-navy"
        >
          <Spinner />
          Load {Math.min(size, more)} more
        </Link>
      )}
    </div>
  )
}
