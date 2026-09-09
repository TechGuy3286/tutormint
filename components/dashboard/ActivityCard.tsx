import { CreditCard, MessageSquare, ShieldAlert, Sparkles } from 'lucide-react'

import StatTile, { type TileTone } from '@/components/dashboard/StatTile'
import { familyFor, groupedLabel, type Family } from '@/lib/activityFamily'
import { isPlanEnding, type FeedGroup } from '@/lib/feedGrouping'
import { formatDateTime } from '@/lib/datetime'
import TimeAgo from '@/components/TimeAgo'

// One square tile in the ACTIVITY grid.
//
// The band this replaced was a wide row — icon left, text right — that read
// like a log file. Every event now wears the same square category tile the
// "Your things" grid uses (components/dashboard/StatTile): a coloured icon
// centred at the top, the event centred beneath it, the time under that. The
// colour is a scanning aid and never carries meaning the words do not.
//
// GROUPING IS KEPT, NEVER LOSSY. Four plan changes on one day collapse into
// "Your plan changed 4 times" — the count is `items.length`, so the number in
// the sentence and the rows behind it cannot disagree. The tile links to the
// itemised timeline (/account/notifications) rather than to any one of the run:
// a run of four matched jobs has four different tuitions behind it, and a single
// destination would silently pick the newest. A card that stands for ONE thing
// links straight to that thing.

const ICONS = {
  message: MessageSquare,
  money: CreditCard,
  progress: Sparkles,
  shield: ShieldAlert,
} as const

// The four activity families map onto four of the five tile tones. These are
// the same brand pairs the old discs used (lib/activityFamily FAMILY_STYLE),
// so nothing about the colour scanning-aid changed — only the card shape.
const FAMILY_TONE: Record<Family, TileTone> = {
  messages: 'navy',
  money: 'gold',
  progress: 'green',
  moderation: 'red',
}

export default function ActivityCard({ group }: { group: FeedGroup }) {
  const family = familyFor(group.type)
  const Icon = ICONS[
    ({ messages: 'message', money: 'money', progress: 'progress', moderation: 'shield' } as const)[
      family
    ]
  ]

  // A band-wide messages card stands for several conversations at once and
  // points at the inbox; a plan ending is one fact reported up to three ways
  // (expiry, revoke, cancel) and keeps its single written destination.
  const collapsedMessages = !!group.collapsedAcrossDays
  const planEnd = isPlanEnding(group.type)
  const grouped = group.count > 1 && !collapsedMessages && !planEnd

  // "N new messages" is right for waiting and wrong for already-read, and a
  // collapsed messages card is the one place a member sees a count of messages
  // they have already opened — so it words itself from the group's unread state.
  const isMessages = family === 'messages' && group.count > 1
  const title = isMessages
    ? `${group.count} ${group.unread ? 'new ' : ''}messages`
    : group.count > 1 && !planEnd
      ? groupedLabel(group.type, group.count, group.head.text)
      : group.head.text

  // A grouped run has several destinations behind it, so it goes to the
  // itemised timeline rather than to the newest row. Everything else links to
  // its own written href, falling back to the timeline when it names none.
  const href = grouped ? '/account/notifications' : (group.href ?? '/account/notifications')

  // A plan that has ended or is about to is the one thing here with a
  // consequence attached to ignoring it — it takes the red highlight.
  const urgent = planEnd || group.type === 'plan_expiring'

  const note = (
    <span title={formatDateTime(group.head.at)}>
      {collapsedMessages && group.count > 1 ? 'latest ' : ''}
      <TimeAgo iso={group.head.at} />
    </span>
  )

  return (
    <StatTile
      href={href}
      tone={FAMILY_TONE[family]}
      highlight={urgent}
      unread={group.unread}
      icon={<Icon aria-hidden size={22} />}
      label={title}
      note={note}
    />
  )
}
