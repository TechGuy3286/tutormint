import Link from 'next/link'

import { pageHref, pageLinkNumbers } from '@/lib/crawlLinksCore'

// Numbered page links (owner, 16 Nov 2026) — real <a href> to ?page=2, 3 … under
// a list, so a crawler reaches every open tuition without pressing "Load more".
// "Load more" stays for people. Server component; renders nothing for one page.

export default function PageLinks({
  path,
  page,
  pages,
  params,
  label = 'Pages',
}: {
  path: string
  page: number
  pages: number
  /** Other query parameters to keep on every link (Browse filters). */
  params?: Record<string, string | null | undefined>
  label?: string
}) {
  if (pages <= 1) return null
  const numbers = pageLinkNumbers(page, pages)
  return (
    <nav aria-label={label} className="flex flex-wrap items-center justify-center gap-1.5 pt-1 text-xs">
      {numbers.map((n, i) =>
        n === null ? (
          <span key={`gap-${i}`} aria-hidden className="px-1 text-gray-500">
            …
          </span>
        ) : n === page ? (
          <span
            key={n}
            aria-current="page"
            className="inline-flex min-h-[36px] min-w-[36px] items-center justify-center rounded-lg bg-tm-navy px-2 font-bold text-white"
          >
            {n}
          </span>
        ) : (
          <Link
            key={n}
            // ?page= is a dynamic twin (proxy.ts) — no prefetch of every page.
            prefetch={false}
            href={pageHref(path, n, params)}
            className="inline-flex min-h-[36px] min-w-[36px] items-center justify-center rounded-lg border border-gray-200 bg-white px-2 font-semibold text-tm-navy hover:border-tm-navy"
          >
            {n}
          </Link>
        ),
      )}
    </nav>
  )
}
