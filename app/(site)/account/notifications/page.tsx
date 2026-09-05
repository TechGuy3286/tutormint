import { List, Bell } from 'lucide-react'
import type { Metadata } from 'next'
import Link from 'next/link'
import { redirect } from 'next/navigation'

import Breadcrumbs from '@/components/Breadcrumbs'
import { getSessionUser } from '@/lib/auth'
import { notificationPage, unreadCount, type NotificationGroup } from '@/lib/notificationFeed'

import ActivityCard from '@/components/dashboard/ActivityCard'
import { groupFeed } from '@/lib/feedGrouping'
import { notificationsToFeed } from '@/lib/notificationsToFeed'

import MoreNotifications from './MoreNotifications'
import MarkAllReadButton from '@/components/notifications/MarkAllReadButton'

// Everything the platform has told this member.
//
// The rows have existed since T5 — applications, hires, demos, moderation
// outcomes and plan changes all write one — and until now there was no screen
// that read them. 49 real notifications were sitting in the table unread
// because nothing in the product could display one.
//
// A server component: the first window is real HTML, and the filters are links
// rather than client state, so a filtered view is a URL a member can bookmark
// or send to support.

export const dynamic = 'force-dynamic'

export const metadata: Metadata = {
  title: 'Notifications | TutorMint',
  robots: { index: false, follow: false },
}

const PAGE_SIZE = 20

const FILTERS: { key: NotificationGroup; label: string }[] = [
  { key: 'all', label: 'All' },
  { key: 'unread', label: 'Unread' },
  { key: 'jobs', label: 'Jobs' },
  { key: 'messages', label: 'Messages' },
  { key: 'demos', label: 'Demos' },
  { key: 'account', label: 'Account' },
]

export default async function NotificationsPage({
  searchParams,
}: {
  searchParams: Promise<{ group?: string }>
}) {
  const session = await getSessionUser()
  if (!session) redirect(`/login?next=${encodeURIComponent('/account/notifications')}`)

  const { group: raw } = await searchParams
  const group = (FILTERS.find((f) => f.key === raw)?.key ?? 'all') as NotificationGroup

  const [{ rows, nextCursor }, unread] = await Promise.all([
    notificationPage({ group, limit: PAGE_SIZE }),
    unreadCount(),
  ])

  const role = session.profile?.role ?? null

  return (
    <main className="mx-auto w-full max-w-2xl space-y-4 p-4 sm:p-6">
      <Breadcrumbs items={[{ label: 'Notifications' }]} />

      <header className="flex flex-wrap items-baseline justify-between gap-2">
        <div className="space-y-1">
          <h1 className="text-xl font-black text-tm-navy sm:text-2xl">Notifications</h1>
          <p className="text-xs text-gray-500">
            {unread > 0 ? `${unread} unread` : 'All caught up'}
          </p>
        </div>
        <div className="flex items-center gap-3">
          {unread > 0 && <MarkAllReadButton />}
          <Link
            href="/account/notifications/settings"
            className="inline-flex min-h-[44px] items-center text-xs font-bold text-tm-red hover:underline"
          >
            Email settings
          </Link>
        </div>
      </header>

      <nav aria-label="Filter notifications" className="flex flex-wrap gap-2">
        {FILTERS.map((f) => (
          <Link
            key={f.key}
            href={f.key === 'all' ? '/account/notifications' : `/account/notifications?group=${f.key}`}
            aria-current={group === f.key ? 'page' : undefined}
            className={`inline-flex min-h-[44px] items-center rounded-xl px-4 text-xs font-bold ${
              group === f.key
                ? 'bg-tm-black text-white'
                : 'border border-gray-200 bg-white text-slate-700 hover:border-tm-navy'
            }`}
          >
            {f.label}
          </Link>
        ))}
      </nav>

      {rows.length === 0 ? (
        <EmptyState role={role} group={group} />
      ) : (
        <>
          {/* The same card and the same grid as the dashboard band — one
              implementation, so the two surfaces cannot drift into looking
              like different products.
              
              THE GROUPING DIFFERS, on purpose. The band collapses every
              message into one card because it is a summary and its job is to
              stop a conversation burying a hire. This IS the list, so it
              collapses per CONVERSATION instead: eleven messages from three
              people are three rows, each opening its own thread, rather than
              eleven rows or one. */}
          <ul className="grid gap-2 sm:grid-cols-2">
            {groupFeed(notificationsToFeed(rows), { messages: 'byThread' }).map((g) => (
              <ActivityCard key={g.key} group={g} />
            ))}
          </ul>
          <MoreNotifications group={group} initialCursor={nextCursor} serverCount={rows.length} />
        </>
      )}
    </main>
  )
}

/**
 * An empty state that does work.
 *
 * "No notifications" explains nothing and offers nothing. What a member wants
 * to know is why it is empty and what would fill it, so each case names the
 * next real step: a tutor becomes findable by finishing their profile, a parent
 * starts a conversation by finding somebody.
 *
 * A filtered empty is a different situation from a genuinely empty inbox —
 * there the useful action is clearing the filter, not completing a profile.
 */
function EmptyState({ role, group }: { role: string | null; group: NotificationGroup }) {
  if (group !== 'all') {
    return (
      <div className="space-y-3 rounded-2xl border border-gray-200 bg-white p-8 text-center">
        <p className="text-xs font-bold text-tm-navy">Nothing under this filter</p>
        <p className="mx-auto max-w-sm text-xs leading-relaxed text-gray-500">
          You have notifications, just not of this kind yet.
        </p>
        <Link
          href="/account/notifications"
          className="gap-1.5 inline-flex min-h-[44px] items-center justify-center rounded-xl bg-tm-black px-4 text-xs font-bold text-white transition-colors hover:bg-tm-navy"
        >
          <List aria-hidden size={14} />
          Show all notifications
        </Link>
      </div>
    )
  }

  // Each role's next real step, not one apology reused three times. An admin
  // is not a parent, and telling them notifications arrive "when a tutor
  // applies to your job" is describing somebody else's product to them.
  const copy =
    role === 'tutor'
      ? {
          hint: 'Complete your profile to start appearing in searches. Notifications arrive when parents apply, message you or book a demo.',
          primary: { label: 'Complete your profile', href: '/tutor/complete-profile' },
          secondary: { label: 'Find tuitions', href: '/browse/tuitions' },
        }
      : role === 'admin'
        ? {
            hint: 'Your own account has nothing waiting. Member reports and moderation queues live in the admin panel.',
            primary: { label: 'Open the admin panel', href: '/admin' },
            secondary: { label: 'Email settings', href: '/account/notifications/settings' },
          }
        : {
            hint: 'Notifications arrive when a tutor applies to your job, replies to you, or accepts a demo.',
            primary: { label: 'Browse tutors', href: '/browse/tutors' },
            secondary: { label: 'Post a job', href: '/parent/dashboard/post-job' },
          }

  return (
    <div className="space-y-3 rounded-2xl border border-gray-200 bg-white p-8 text-center">
      <div className="mx-auto flex h-10 w-10 items-center justify-center rounded-full bg-tm-bg text-gray-500">
        <Bell aria-hidden size={18} />
      </div>
      <p className="text-xs font-bold text-tm-navy">No notifications yet</p>
      <p className="mx-auto max-w-sm text-xs leading-relaxed text-gray-500">{copy.hint}</p>
      <div className="mx-auto flex max-w-xs flex-col gap-2">
        <Link
          href={copy.primary.href}
          className="flex min-h-[44px] items-center justify-center rounded-xl bg-tm-black px-4 text-xs font-bold text-white transition-colors hover:bg-tm-navy"
        >
          {copy.primary.label}
        </Link>
        <Link
          href={copy.secondary.href}
          className="flex min-h-[44px] items-center justify-center rounded-xl border border-gray-200 px-4 text-xs font-bold text-tm-navy transition-colors hover:border-tm-navy"
        >
          {copy.secondary.label}
        </Link>
      </div>
    </div>
  )
}
