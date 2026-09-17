import Link from 'next/link'
import { ArrowRight, ListChecks, Briefcase, Info, Activity, CheckCircle2 } from 'lucide-react'

import ActivityCard from '@/components/dashboard/ActivityCard'
import StatTile from '@/components/dashboard/StatTile'
import OnlineSuitableChip from '@/components/OnlineSuitableChip'
import { groupFeed, type FeedItem } from '@/lib/feedGrouping'
import type { WeekJob } from '@/lib/funnel'
import ApplyFromStrip from '@/app/(site)/tutor/dashboard/ApplyFromStrip'

// The tutor dashboard's cards (PR18 §2). Each is a bordered white card with its
// own plain-English title inside — no loose text on the page. Phone-first: the
// whole page is a single narrow column at every width, and the count tiles are a
// fixed two-column grid.

const CARD = 'space-y-3 rounded-2xl border border-gray-200 bg-white p-4'
const TITLE = 'flex items-center gap-2 text-sm font-black text-tm-navy'

/** §2.1(2) — the real to-dos. Always shown (a positive line when there are none). */
export function WhatToDoNextCard({ items }: { items: { key: string; label: string; href: string }[] }) {
  return (
    <section className={CARD}>
      <h2 className={TITLE}>
        <ListChecks aria-hidden size={16} className="text-tm-red" />
        What to do next
      </h2>
      {items.length === 0 ? (
        <p className="flex items-center gap-2 text-xs font-semibold text-tm-green-deep">
          <CheckCircle2 aria-hidden size={15} />
          Your profile is complete. Nothing to do right now.
        </p>
      ) : (
        <ul className="space-y-2">
          {items.map((f) => (
            <li key={f.key}>
              <Link
                href={f.href}
                className="flex min-h-[44px] items-center justify-between gap-2 rounded-xl border border-gray-200 px-3 text-xs font-bold text-tm-navy transition-colors hover:border-tm-navy"
              >
                {f.label}
                <ArrowRight aria-hidden size={15} className="shrink-0 text-tm-navy" />
              </Link>
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}

/** §2.1(3) — the small count tiles, two to a row, each tappable. */
export type CountTile = {
  key: string
  icon: React.ReactNode
  value: number
  label: string
  href: string
  tone: 'navy' | 'green' | 'red' | 'gold' | 'mint'
  highlight?: boolean
}

export function CountGrid({ tiles }: { tiles: CountTile[] }) {
  return (
    <ul className="grid grid-cols-2 gap-3">
      {tiles.map((t) => (
        <StatTile
          key={t.key}
          href={t.href}
          prefetch={false}
          tone={t.highlight ? 'red' : t.tone}
          highlight={t.highlight}
          icon={t.icon}
          value={t.value}
          label={t.label}
        />
      ))}
    </ul>
  )
}

/** §2.1(4) — the matching tuitions and its empty state, always shown. */
export function TuitionsForYouCard({ jobs, canApply }: { jobs: WeekJob[]; canApply: boolean }) {
  return (
    <section className={CARD}>
      <h2 className={TITLE}>
        <Briefcase aria-hidden size={16} className="text-gray-500" />
        Tuitions for you
      </h2>
      {jobs.length === 0 ? (
        <p className="text-[11px] leading-relaxed text-gray-500">
          No new tuitions match your subjects and city yet.{' '}
          <Link href="/tutor/dashboard/jobs" className="font-bold text-tm-red hover:underline">
            See all open tuitions
          </Link>
        </p>
      ) : (
        <>
          <ul className="divide-y divide-gray-100">
            {jobs.slice(0, 5).map((j) => (
              <li key={j.id} className="flex items-center justify-between gap-3 py-2">
                <span className="min-w-0">
                  <Link href="/tutor/dashboard/jobs" className="block truncate text-[11px] font-bold text-tm-navy hover:underline">
                    {j.title}
                  </Link>
                  <span className="flex items-center gap-1.5 text-[10px] text-gray-500">
                    <span className="truncate">{[j.area, j.city].filter(Boolean).join(', ') || 'Pakistan'}</span>
                    {j.onlineSuitable && <OnlineSuitableChip />}
                  </span>
                  {j.matchReason && (
                    <span className="block truncate text-[10px] font-semibold text-tm-green-deep">{j.matchReason}</span>
                  )}
                </span>
                <ApplyFromStrip jobId={j.id} listed={canApply} />
              </li>
            ))}
          </ul>
          <Link href="/tutor/dashboard/jobs" className="inline-flex min-h-[32px] items-center text-[11px] font-bold text-tm-red hover:underline">
            See all open tuitions
          </Link>
        </>
      )}
    </section>
  )
}

/** §2.1(7) — the last 5 things that happened, news included. Always shown. */
export function RecentActivityCard({ items, unreadMessages }: { items: FeedItem[]; unreadMessages: number }) {
  const groups = groupFeed(items, { messages: 'all', inboxHref: '/tutor/dashboard/messages' }).slice(0, 5)
  return (
    <section className={CARD}>
      <h2 className={TITLE}>
        <Activity aria-hidden size={16} className="text-gray-500" />
        Recent activity
      </h2>
      {groups.length === 0 ? (
        <p className="text-[11px] leading-relaxed text-gray-500">
          Nothing has happened yet. Applications, parent replies and demo requests will show here.
        </p>
      ) : (
        <ul className="divide-y divide-gray-100 overflow-hidden rounded-xl border border-gray-200">
          {groups.map((g) => (
            <ActivityCard key={g.key} group={g} unreadMessages={unreadMessages} />
          ))}
        </ul>
      )}
    </section>
  )
}

/** §2.1(8) — the notes card: the "only Featured parents can hire" line and any
 *  other info lines, kept inside a card rather than loose on the page. */
export function NotesCard() {
  return (
    <section className={CARD}>
      <h2 className={TITLE}>
        <Info aria-hidden size={16} className="text-gray-500" />
        Good to know
      </h2>
      <p className="text-[11px] leading-relaxed text-gray-500">
        Only Featured parents can complete a hire. Every job card says which kind of parent posted it,
        so you know before you spend an application.
      </p>
    </section>
  )
}
