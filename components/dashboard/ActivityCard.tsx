import Link from 'next/link'
import { ChevronRight, CreditCard, MessageSquare, ShieldAlert, Sparkles } from 'lucide-react'

import { familyFor, groupedLabel, type Family } from '@/lib/activityFamily'
import { isPlanEnding, type FeedGroup } from '@/lib/feedGrouping'
import { formatDateTime } from '@/lib/datetime'
import TimeAgo from '@/components/TimeAgo'

// One row in the ACTIVITY list (owner PR2 §4.3).
//
// The band this replaced was a grid of square tiles that read as decoration. A
// row now says, in one scannable line, what happened and when — the exact thing
// (the text comes from dashboardFeed, which names the CNIC/degree/selfie rather
// than "a document") and a chevron into it.
//
// GROUPING IS KEPT, NEVER LOSSY. Four plan changes on one day collapse into
// "Your plan changed 4 times" — the count is `items.length`, so the number in
// the sentence and the rows behind it cannot disagree. A grouped run links to
// the itemised timeline (/account/notifications) rather than to any one of the
// run; a card that stands for ONE thing links straight to that thing.

const ICONS = {
  message: MessageSquare,
  money: CreditCard,
  progress: Sparkles,
  shield: ShieldAlert,
} as const

// Each family's icon disc, using an existing registered tint/ink contrast pair
// (scanning aid only — the words carry the meaning).
const FAMILY_CHIP: Record<Family, string> = {
  messages: 'bg-tm-tint-navy text-tm-navy',
  money: 'bg-tm-tint-gold text-tm-gold-ink',
  progress: 'bg-tm-tint-green text-tm-green-deep',
  moderation: 'bg-tm-tint-red text-tm-red',
}

export default function ActivityCard({
  group,
  unreadMessages,
}: {
  group: FeedGroup
  /**
   * The authoritative unread-messages count (unreadMessageCount) for the
   * dashboard's single all-messages card. When supplied, that card shows THIS
   * number rather than a count of the message rows that happen to be in the
   * feed window — so it says exactly what the Messages tile, the header icon
   * and the dock badge say (§3). Absent on the notifications page, where the
   * per-thread cards keep their own in-window counts.
   */
  unreadMessages?: number
}) {
  const family = familyFor(group.type)
  const Icon = ICONS[
    ({ messages: 'message', money: 'money', progress: 'progress', moderation: 'shield' } as const)[
      family
    ]
  ]

  const collapsedMessages = !!group.collapsedAcrossDays
  const planEnd = isPlanEnding(group.type)
  const grouped = group.count > 1 && !collapsedMessages && !planEnd

  // The dashboard all-messages card speaks the ONE unread definition
  // (unreadMessageCount): a run of read, sent and received rows must never read
  // "3 new messages" beside a tile saying "2". With nothing unread it is just
  // "Messages".
  const authoritativeMessages = collapsedMessages && unreadMessages !== undefined
  // "N new messages" is right for waiting and wrong for already-read, and a
  // collapsed messages card is the one place a member sees a count of messages
  // they have already opened — so it words itself from the group's unread state.
  const isMessages = family === 'messages' && group.count > 1
  const title = authoritativeMessages
    ? (unreadMessages as number) > 0
      ? `${unreadMessages} new message${unreadMessages === 1 ? '' : 's'}`
      : 'Messages'
    : isMessages
      ? `${group.count} ${group.unread ? 'new ' : ''}messages`
      : group.count > 1 && !planEnd
        ? groupedLabel(group.type, group.count, group.head.text)
        : group.head.text

  // The unread dot on the authoritative card follows the same count, so a card
  // reading "Messages" (nothing unread) does not still wear the red dot.
  const showUnread = authoritativeMessages ? (unreadMessages as number) > 0 : group.unread

  // A grouped run has several destinations behind it, so it goes to the itemised
  // timeline; everything else links to its own written href, falling back to the
  // timeline when it names none.
  const href = grouped ? '/account/notifications' : (group.href ?? '/account/notifications')

  return (
    <li>
      <Link
        href={href}
        className="flex items-center gap-3 px-4 py-3 transition-colors hover:bg-gray-50"
      >
        <span
          className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-full ${FAMILY_CHIP[family]}`}
        >
          <Icon aria-hidden size={16} />
        </span>
        <span className="min-w-0 flex-1">
          <span className="flex items-center gap-2">
            <span className="truncate text-xs font-bold text-tm-navy">{title}</span>
            {showUnread && (
              <span aria-hidden className="h-1.5 w-1.5 shrink-0 rounded-full bg-tm-red" />
            )}
          </span>
          <span className="block text-[10px] text-gray-500" title={formatDateTime(group.head.at)}>
            {collapsedMessages && group.count > 1 ? 'latest ' : ''}
            <TimeAgo iso={group.head.at} />
          </span>
        </span>
        <ChevronRight aria-hidden size={15} className="shrink-0 text-gray-500" />
      </Link>
    </li>
  )
}
