// Feed shapes and grouping — PURE, and separate from dashboardFeed.ts for one
// concrete reason: ActivityCard and MoreNotifications are client components and
// need groupFeed, while dashboardFeed.ts imports the cookie-backed Supabase
// client and therefore next/headers. Importing the value across that line is a
// build error ("This API is only available in Server Components"), and a type
// import alone was not enough because groupFeed is a function, not a type.
//
// Nothing in this file touches the network, the database or the request.

import { pkDayKey } from '@/lib/datetime'

export type FeedItem = {
  id: string
  source: 'notification' | 'activity'
  /** The raw event or notification kind — what grouping and colour key on. */
  type: string
  text: string
  href: string | null
  at: string
  unread: boolean
}

/**
 * A run of identical events from the same day, collapsed into one card.
 *
 * `items` ALWAYS holds every row in the run, including when there is only one,
 * so the rendering never has two shapes to reason about and the expansion can
 * never show fewer rows than the count claims. That is the invariant the brief
 * asked for in the words "nothing may be silently dropped": `count` is
 * `items.length` by construction rather than a number carried alongside it.
 */
export type FeedGroup = {
  key: string
  type: string
  items: FeedItem[]
  /** The newest row in the run — the one whose time the card shows. */
  head: FeedItem
  count: number
  /** True when any row in the run is unread. */
  unread: boolean
}


/**
 * Collapse CONSECUTIVE identical types from the same Karachi day.
 *
 * Consecutive, not "all of them": the feed is chronological, and pulling
 * scattered rows together would reorder the story. Four plan changes in a row
 * on Tuesday become one card; a plan change on Tuesday and another on Friday
 * with a hire between them stay three cards, because that is what happened.
 *
 * The day boundary is the KARACHI day (lib/datetime), not the server's. A run
 * that straddles midnight UTC is one evening to the person who lived it.
 *
 * TOTAL BY CONSTRUCTION: every input row lands in exactly one group's `items`,
 * and the function asserts it. A grouping that quietly swallowed a row would
 * be worse than no grouping at all -- the reader would have no way to know a
 * notification had existed.
 */
export function groupFeed(items: FeedItem[]): FeedGroup[] {
  const groups: FeedGroup[] = []

  for (const item of items) {
    const last = groups[groups.length - 1]
    const sameRun =
      last &&
      last.type === item.type &&
      pkDayKey(last.head.at) === pkDayKey(item.at)

    if (sameRun) {
      last.items.push(item)
      last.count = last.items.length
      last.unread = last.unread || item.unread
      continue
    }

    groups.push({
      key: item.id,
      type: item.type,
      items: [item],
      head: item,
      count: 1,
      unread: item.unread,
    })
  }

  const accounted = groups.reduce((n, g) => n + g.items.length, 0)
  if (accounted !== items.length) {
    // Unreachable as written; here because the invariant is the feature.
    throw new Error(`groupFeed dropped rows: ${accounted} of ${items.length}`)
  }

  return groups
}
