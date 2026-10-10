import Link from 'next/link'

import Avatar from '@/components/Avatar'
import MemberHeaderNav from '@/components/MemberHeaderNav'
import HeaderMessages from '@/components/messages/HeaderMessages'
import NotificationBell from '@/components/notifications/NotificationBell'
import { MEMBER_SETTINGS_HREF } from '@/lib/memberNav'

// The right-hand side of the signed-in TUTOR / PARENT header (owner, 9 Oct
// 2026): avatar + first name as a plain dashboard link, then Messages,
// Notifications, Settings and Logout. Navbar resolves the session and counts
// and wraps this in its Shell; this file holds no server-only import, so
// scripts/test-member-header.ts can render it for every kind of member.

export default function MemberHeader({
  role,
  name,
  avatarUrl,
  gender = null,
  userId,
  messagesUnread,
  unread,
  empty,
}: {
  role: 'tutor' | 'parent'
  name: string
  avatarUrl: string | null
  /** A tutor's gender, for the default avatar; a parent has none. */
  gender?: string | null
  userId: string
  messagesUnread: number
  unread: number
  empty: { hint: string; action: { label: string; href: string } }
}) {
  const firstName = name.trim().split(/\s+/)[0] || name
  return (
    <>
      <Link
        href={role === 'tutor' ? '/tutor/dashboard' : '/parent/dashboard'}
        aria-label="Open your dashboard"
        className="flex min-h-[44px] items-center gap-2 rounded-xl px-0.5 text-xs font-bold text-tm-navy hover:underline sm:px-1"
      >
        <Avatar
          name={name}
          src={avatarUrl}
          gender={gender}
          decorative
          ring="border border-gray-200"
          className="h-8 w-8 text-[10px]"
        />
        {firstName && <span className="hidden max-w-[10ch] truncate sm:inline">{firstName}</span>}
      </Link>
      <HeaderMessages
        href={role === 'tutor' ? '/tutor/dashboard/messages' : '/parent/dashboard/messages'}
        initialUnread={messagesUnread}
      />
      <NotificationBell
        userId={userId}
        initialUnread={unread}
        emptyHint={empty.hint}
        emptyAction={empty.action}
        compact
      />
      <MemberHeaderNav settingsHref={MEMBER_SETTINGS_HREF[role]} />
    </>
  )
}
