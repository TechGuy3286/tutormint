import Link from 'next/link'
import { Activity } from 'lucide-react'

import ActivityCard from '@/components/dashboard/ActivityCard'
import EmptyState from '@/components/EmptyState'
import { groupFeed, type FeedItem } from '@/lib/feedGrouping'

// The second band: what has happened, newest first.
//
// A GRID OF CARDS, not a list of lines. The previous version was a bordered
// list of one-line rows -- identical weight, identical shape, no colour -- and
// on a laptop it was one narrow column of text down the middle of the page. It
// read as a log file, which is a thing people skip. One column at 390, two at
// 768, three at 1280, so the same eight events take a third of the height on a
// laptop and stay one-per-line on a phone.
//
// Every row is a real row from `notifications` or `user_activity_log`. Nothing
// here is synthesised from state -- "your profile is 60% complete" is a fact
// about now, not an event, and it belongs in the band above.
//
// Runs of the same event on the same day collapse into one card with a count
// and expand to every row behind it. See groupFeed for the invariant.
//
// MESSAGES ARE THE EXCEPTION, and collapse across the WHOLE band rather than
// per day. A member with a live conversation generates more message events
// than everything else put together, and per-day grouping turned that into
// three cards on a nine-card band -- so "you were hired" was below the fold
// because somebody had written on Tuesday and again on Thursday. One card
// says how many and how recent, and goes to the inbox. Every other event type
// keeps per-day grouping, because two job posts on different days genuinely
// are two things that happened.

export default function ActivityBand({
  items,
  emptyHint,
  inboxHref,
  emptyAction,
}: {
  items: FeedItem[]
  emptyHint: string
  /** Where the single messages card points. Role-specific, so it is passed in. */
  inboxHref: string
  /** The one thing to do when the timeline is empty. Role-specific. */
  emptyAction?: { label: string; href: string }
}) {
  const groups = groupFeed(items, { messages: 'all', inboxHref })

  return (
    <section aria-labelledby="activity" className="space-y-2">
      <div className="flex items-center justify-between gap-2">
        <h2 id="activity" className="text-[11px] font-black uppercase tracking-wider text-gray-500">
          Activity
        </h2>
        {items.length > 0 && (
          <Link
            href="/account/notifications"
            className="-mr-2 flex min-h-[44px] items-center px-2 text-[11px] font-bold text-tm-red hover:underline"
          >
            See all
          </Link>
        )}
      </div>

      {groups.length === 0 ? (
        <EmptyState icon={<Activity aria-hidden size={18} />} title={emptyHint} action={emptyAction} />
      ) : (
        <ul className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
          {groups.map((g) => (
            <ActivityCard key={g.key} group={g} />
          ))}
        </ul>
      )}
    </section>
  )
}
