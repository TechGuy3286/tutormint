'use client'

import {
  ChevronDown,
  CreditCard,
  MessageSquare,
  ShieldAlert,
  Sparkles,
} from 'lucide-react'
import Link from 'next/link'
import { useState } from 'react'

import NotificationCta from '@/components/notifications/NotificationCta'
import { FAMILY_STYLE, familyFor, groupedLabel } from '@/lib/activityFamily'
import type { FeedGroup } from '@/lib/feedGrouping'
import { formatDateTime } from '@/lib/datetime'
import TimeAgo from '@/components/TimeAgo'

// One card in the ACTIVITY grid.
//
// The band this replaced was a flat bordered list of one-line rows and read
// like a log file: the same weight, the same colour and the same shape for
// "you were hired" and "you shortlisted a tutor". A card with a coloured disc
// lets somebody find the money row or the moderation row without reading every
// line -- the colour is a scanning aid, and it never carries meaning the words
// do not also carry.
//
// GROUPING IS EXPANDABLE, NEVER LOSSY. Four plan changes on one day collapse
// into "Your plan changed 4 times", and pressing it lists all four with their
// own times and links. The count is `items.length`, so the number on the card
// and the number of rows behind it cannot disagree.

const ICONS = {
  message: MessageSquare,
  money: CreditCard,
  progress: Sparkles,
  shield: ShieldAlert,
} as const

export default function ActivityCard({ group }: { group: FeedGroup }) {
  const [open, setOpen] = useState(false)
  const family = familyFor(group.type)
  const style = FAMILY_STYLE[family]
  const Icon = ICONS[style.icon]

  // A band-wide messages card is a LINK, not a disclosure: the rows behind it
  // are from different conversations, so there is no useful list to unfold --
  // the place to read them is the inbox, which is where it points.
  const collapsedMessages = !!group.collapsedAcrossDays
  const grouped = group.count > 1 && !collapsedMessages
  // "7 new messages" is right for seven waiting and wrong for seven already
  // read -- and a collapsed messages card is the one place a member sees a
  // count of messages they have already opened. The per-type phrasing in
  // lib/activityFamily has no way to know that, so any message count words
  // itself from the group's own unread state.
  const isMessages = family === 'messages' && group.count > 1
  const title = isMessages
    ? `${group.count} ${group.unread ? 'new ' : ''}messages`
    : group.count > 1
      ? groupedLabel(group.type, group.count, group.head.text)
      : group.head.text
  const href = group.href

  // The inline action. Only on a card that stands for ONE notification: a run
  // of four matched jobs collapsed into one card has four different tuitions
  // behind it, and a single "See the tuition" button would silently pick the
  // newest. Expanding the run gives each row its own link, which is the honest
  // answer for that case.
  const cta =
    group.count === 1 && group.head.source === 'notification' ? (
      <NotificationCta row={{ kind: group.type, href: group.head.href }} />
    ) : null

  const body = (
    <span className="flex min-w-0 items-start gap-3">
      <span
        aria-hidden
        className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-full ${style.className}`}
      >
        <Icon size={16} />
      </span>
      <span className="min-w-0 flex-1 space-y-0.5">
        <span className="flex items-start gap-1.5">
          {group.unread && (
            <span aria-hidden className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-tm-red" />
          )}
          <span
            className={`block text-xs leading-snug ${
              group.unread ? 'font-black' : 'font-semibold'
            } text-tm-navy`}
          >
            {title}
          </span>
        </span>
        <span className="block text-[11px] text-gray-500" title={formatDateTime(group.head.at)}>
          {/* "latest" only when the card stands for more than one thing --
              otherwise it would claim a run where there is a single event. */}
          {collapsedMessages && group.count > 1 ? 'latest ' : ''}
          <TimeAgo iso={group.head.at} />
        </span>
      </span>
    </span>
  )

  return (
    <li className="rounded-2xl border border-gray-200 bg-white shadow-xs transition-shadow hover:shadow-md">
      {grouped ? (
        <>
          <button
            type="button"
            onClick={() => setOpen((v) => !v)}
            aria-expanded={open}
            className="flex min-h-[44px] w-full items-center justify-between gap-2 p-3 text-left"
          >
            {body}
            <ChevronDown
              aria-hidden
              size={15}
              className={`shrink-0 text-gray-500 transition-transform ${open ? 'rotate-180' : ''}`}
            />
          </button>

          {open && (
            <ul className="space-y-0.5 border-t border-gray-100 px-3 pb-2 pt-2">
              {/* EVERY row in the run, not a sample. */}
              {group.items.map((item) => {
                const line = (
                  <span className="flex items-baseline justify-between gap-2">
                    <span className="truncate text-[11px] font-semibold text-slate-700">
                      {item.text}
                    </span>
                    <span className="shrink-0 text-[10px] text-gray-500">
                      <TimeAgo iso={item.at} />
                    </span>
                  </span>
                )
                return (
                  <li key={item.id}>
                    {item.href ? (
                      <Link
                        href={item.href}
                        className="flex min-h-[44px] items-center rounded-lg px-2 transition-colors hover:bg-tm-bg"
                      >
                        {line}
                      </Link>
                    ) : (
                      <span className="flex min-h-[44px] items-center px-2">{line}</span>
                    )}
                  </li>
                )
              })}
            </ul>
          )}
        </>
      ) : href ? (
        <div className="relative">
          <Link href={href} className="flex min-h-[44px] items-center p-3">
            {body}
          </Link>
          {cta && <div className="px-3 pb-3 pl-[60px]">{cta}</div>}
        </div>
      ) : (
        // Not every event has an honest destination; the card still renders.
        <div className="flex min-h-[44px] flex-col items-start p-3">
          {body}
          {cta && <div className="pl-[48px] pt-2">{cta}</div>}
        </div>
      )}
    </li>
  )
}
