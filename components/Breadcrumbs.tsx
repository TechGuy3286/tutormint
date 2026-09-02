import { Fragment } from 'react'
import Link from 'next/link'
import { ChevronRight, Home } from 'lucide-react'

import { absoluteUrl } from '@/lib/siteUrl'

// The trail back. On every page except the homepage.
//
// Home is prepended here rather than passed in, so no caller can ship a trail
// with no way back to the start -- which is the one thing these are for.
//
// MOBILE. The trail must never wrap to a second line: a breadcrumb that
// reflows pushes the page's own heading down and is read as content rather
// than navigation. Below 640px the middle of the trail is replaced by an
// ellipsis, which leaves Home, the immediate parent and the current page --
// exactly the two destinations the rule asks for -- and the current label
// truncates rather than wrapping. The full trail returns at sm.
//
// JSON-LD. BreadcrumbList with absolute URLs on the canonical host, which is
// why lib/siteUrl.ts exists. The current page is included as the last item and
// carries no link, matching schema.org's own example. There is no other
// structured data on the site yet -- Organization, WebSite and the rest are
// T9's 9.2 -- so this emits its own <script> rather than extending something.

export type Crumb = {
  label: string
  /** Omitted on the current page, which is the last item and is never a link. */
  href?: string
}

export default function Breadcrumbs({ items }: { items: Crumb[] }) {
  const trail: Crumb[] = [{ label: 'Home', href: '/' }, ...items]

  // Everything between Home and the last two entries collapses on mobile.
  const lastIndex = trail.length - 1
  const collapsibleFrom = 1
  const collapsibleTo = lastIndex - 1 // exclusive of the parent
  const hasCollapsed = collapsibleTo > collapsibleFrom

  const jsonLd = {
    '@context': 'https://schema.org',
    '@type': 'BreadcrumbList',
    itemListElement: trail.map((c, i) => ({
      '@type': 'ListItem',
      position: i + 1,
      name: c.label,
      ...(c.href ? { item: absoluteUrl(c.href) } : {}),
    })),
  }

  return (
    <nav aria-label="Breadcrumb" className="mb-3 sm:mb-4">
      <ol className="flex items-center gap-1 overflow-hidden text-[11px] text-gray-500 sm:text-xs">
        {trail.map((c, i) => {
          const isLast = i === lastIndex
          const isCollapsed = hasCollapsed && i >= collapsibleFrom && i < collapsibleTo

          return (
            <Fragment key={`${c.label}-${i}`}>
              {hasCollapsed && i === collapsibleTo && (
                <li aria-hidden className="flex shrink-0 items-center gap-1 sm:hidden">
                  <ChevronRight aria-hidden size={12} className="text-gray-500" />
                  <span>&hellip;</span>
                </li>
              )}
              <li
                // Who gives up width first. Home never shrinks (it is an
                // icon on mobile and the one guaranteed destination); the
                // ancestors shrink freely; the CURRENT page shrinks last, at a
                // NOT at all: the ancestors absorb every pixel. Written the
                // other way round -- ancestors fixed, current truncating -- a
                // four-level trail on a phone rendered the parent's full title
                // and cut "Edit" to a single letter, which is the one label
                // that has to survive. The 65% cap is the backstop for a
                // current label that is long on its own, so it truncates
                // instead of pushing the trail off the screen.
                className={`items-center gap-1 ${isCollapsed ? 'hidden sm:flex' : 'flex'} ${
                  i === 0
                    ? 'shrink-0'
                    : isLast
                      ? 'min-w-0 max-w-[65%] shrink-0'
                      : 'min-w-0 shrink'
                }`}
              >
                {i > 0 && <ChevronRight aria-hidden size={12} className="shrink-0 text-gray-500" />}

                {isLast ? (
                  <span aria-current="page" className="truncate font-bold text-tm-navy">
                    {c.label}
                  </span>
                ) : (
                  <Link
                    href={c.href ?? '/'}
                    className="inline-flex min-h-[32px] min-w-0 items-center gap-1 whitespace-nowrap hover:text-tm-navy hover:underline"
                  >
                    {i === 0 ? (
                      <>
                        <Home aria-hidden size={13} />
                        <span className="sr-only sm:not-sr-only">{c.label}</span>
                      </>
                    ) : (
                      <span className="truncate">{c.label}</span>
                    )}
                  </Link>
                )}
              </li>
            </Fragment>
          )
        })}
      </ol>

      <script
        type="application/ld+json"
        // The content is built here from a typed literal; nothing user-entered
        // reaches it unescaped except the labels, which JSON.stringify escapes.
        dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }}
      />
    </nav>
  )
}
