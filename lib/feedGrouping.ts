// Feed shapes and grouping — PURE, and separate from dashboardFeed.ts for one
// concrete reason: ActivityCard and MoreNotifications are client components and
// need groupFeed, while dashboardFeed.ts imports the cookie-backed Supabase
// client and therefore next/headers. Importing the value across that line is a
// build error ("This API is only available in Server Components"), and a type
// import alone was not enough because groupFeed is a function, not a type.
//
// Nothing in this file touches the network, the database or the request.

import { pkDayKey } from '@/lib/datetime'
import { familyFor } from '@/lib/activityFamily'

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
  /**
   * True for the single card that stands for every message in the band.
   *
   * It renders as a link rather than a disclosure: the rows behind it belong
   * to different conversations, and the place to read them is the inbox. The
   * losslessness invariant is unaffected -- `items` still holds all of them,
   * and the count on the card is `items.length`.
   */
  collapsedAcrossDays?: boolean
  /**
   * Where the card goes.
   *
   * Normally the head row's own destination. A collapsed messages card is the
   * exception: six messages across three conversations have no single thread
   * to open, so the card points at the inbox and the reader picks.
   */
  href: string | null
}

/**
 * How message events collapse.
 *
 *   'none'      what everything else does: consecutive, same type, same day.
 *   'all'       ONE card for every message in the band, whatever the day.
 *   'byThread'  one row per conversation.
 *
 * The two modes exist because the two surfaces answer different questions. A
 * dashboard band is a summary and its job is to stop nine message cards
 * pushing a hire off the screen -- there, all messages are one line that says
 * how many and how recent. The notifications list IS the list, and a member
 * scanning it wants to know which conversations are waiting, not that eleven
 * messages arrived.
 */
export type MessageCollapse = 'none' | 'all' | 'byThread'

/** The conversation an href points at, or null when it names no thread. */
export function threadKeyOf(href: string | null): string | null {
  if (!href) return null
  const m = /\/messages\/([^/?#]+)/.exec(href)
  return m ? m[1] : null
}

function isMessage(item: FeedItem): boolean {
  return familyFor(item.type) === 'messages'
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
 * notification had existed. The assertion holds for the message modes too --
 * they change which group a row joins, never whether it joins one.
 */
export function groupFeed(
  items: FeedItem[],
  options: { messages?: MessageCollapse; inboxHref?: string | null } = {},
): FeedGroup[] {
  const { messages = 'none', inboxHref = null } = options
  const groups: FeedGroup[] = []

  // A collapsed messages group is placed where its FIRST (newest) member
  // appeared, so the band still reads newest-first -- pulling it to the top or
  // the bottom would reorder the story around it.
  const collapsed = new Map<string, FeedGroup>()

  for (const item of items) {
    // ---------------------------------------------------- messages, first --
    if (messages !== 'none' && isMessage(item)) {
      const bucket =
        messages === 'all' ? 'messages:all' : `messages:${threadKeyOf(item.href) ?? item.id}`
      const existing = collapsed.get(bucket)
      if (existing) {
        existing.items.push(item)
        existing.count = existing.items.length
        existing.unread = existing.unread || item.unread
        // The card's wording comes from its type, and a mixed run keyed on
        // whichever message happened to be newest would tell a member "you
        // sent 6 messages" when five of them arrived. Anything received wins:
        // that is the half they have to act on.
        if (item.type === 'message_received') existing.type = 'message_received'
        continue
      }
      const group: FeedGroup = {
        key: bucket,
        type: item.type,
        items: [item],
        head: item,
        count: 1,
        unread: item.unread,
        // One card covering several conversations cannot open any one of
        // them; the whole band's card goes to the inbox. A per-thread row
        // keeps its own conversation.
        href: messages === 'all' ? (inboxHref ?? item.href) : item.href,
        collapsedAcrossDays: messages === 'all',
      }
      collapsed.set(bucket, group)
      groups.push(group)
      continue
    }

    // -------------------------------------------------- everything else ----
    const last = groups[groups.length - 1]
    const sameRun =
      last &&
      !collapsed.has(last.key) &&
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
      href: item.href,
    })
  }

  const accounted = groups.reduce((n, g) => n + g.items.length, 0)
  if (accounted !== items.length) {
    // Unreachable as written; here because the invariant is the feature.
    throw new Error(`groupFeed dropped rows: ${accounted} of ${items.length}`)
  }

  return groups
}
