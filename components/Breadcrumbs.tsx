import { Fragment } from 'react'
import Link from 'next/link'
import { ArrowLeft, ChevronRight, Home } from 'lucide-react'

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
// carries no link, matching schema.org's own example.
//
// THE BACK CONTROL IS DERIVED FROM THIS TRAIL, not passed in beside it. That is
// the whole reason it lives here: a separate <BackLink href=…> prop would be a
// second statement of where "up" is, and the two would disagree the first time
// a page's trail changed and its back button did not. There is one answer and
// both the arrow and the crumb read it.
//
// It appears from two levels deep. One level -- /browse/tutors, /faq -- has
// nowhere to go but Home, which the trail's own first crumb already offers.
//
// IT IS A LINK TO THE PARENT, NEVER history.back(). A member who arrived on a
// job from a WhatsApp message has no history to go back to, and one who came
// via three filter changes would be sent to a filter, not up a level. The
// parent crumb is where "up" actually is.
//
// On a phone it is the PRIMARY way back: full 44px row above the trail, with
// the destination in the label. On a laptop it sits inline, left of the trail,
// where it reads as part of the same control.

export type Crumb = {
  label: string
  /** Omitted on the current page, which is the last item and is never a link. */
  href?: string
}

/**
 * The nearest ancestor with a destination.
 *
 * Walks back from the crumb before the current page, because a middle crumb
 * without an href is a label rather than a place -- skipping it lands on
 * somewhere that exists instead of nowhere.
 */
function nearestAncestor(trail: Crumb[]): Crumb | null {
  for (let i = trail.length - 2; i >= 0; i--) {
    if (trail[i].href) return trail[i]
  }
  return null
}

export default function Breadcrumbs({
  items,
  backFallbackHref,
}: {
  items: Crumb[]
  /**
   * Where "up" goes when no ancestor in the trail carries an href -- the role
   * dashboard, for a page that names its own parent without linking it. Every
   * trail on the platform today does link its ancestors, so this is a backstop
   * rather than a routine path; Home is the last resort.
   */
  backFallbackHref?: string
}) {
  const trail: Crumb[] = [{ label: 'Home', href: '/' }, ...items]

  // Everything between Home and the last two entries collapses on mobile.
  const lastIndex = trail.length - 1
  const collapsibleFrom = 1
  const collapsibleTo = lastIndex - 1 // exclusive of the parent
  const hasCollapsed = collapsibleTo > collapsibleFrom

  // Two or more levels deep: `items` excludes Home, so length >= 2 means the
  // current page has a real parent that is not the homepage.
  const parent = items.length >= 2 ? nearestAncestor(trail) : null
  const backHref = parent?.href ?? backFallbackHref ?? '/'
  const backLabel = parent?.label ?? 'Home'

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
      {/* Below sm the back control is a row of its own with the trail beneath
          it -- on a phone it is the primary way back and gets a full 44px
          target. From sm up the two share a line and it sits left of the
          trail, where it reads as one control. */}
      <div className="sm:flex sm:items-center sm:gap-2">
        {parent && (
          <Link
            href={backHref}
            className="inline-flex min-h-[44px] shrink-0 items-center gap-1.5 pr-3 text-xs font-bold text-tm-navy hover:underline sm:min-h-[32px] sm:pr-0"
          >
            <ArrowLeft aria-hidden size={16} className="shrink-0" />
            <span className="truncate">Back to {backLabel}</span>
          </Link>
        )}
        <ol className="flex min-w-0 items-center gap-1 overflow-hidden text-[11px] text-gray-500 sm:text-xs">
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
      </div>

      <script
        type="application/ld+json"
        // The content is built here from a typed literal; nothing user-entered
        // reaches it unescaped except the labels, which JSON.stringify escapes.
        dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }}
      />
    </nav>
  )
}
