// PURE (scripts/test-push3.ts). The signed-in header, as the browser receives
// it from /api/session/header (push 3, owner 1 Nov 2026). No server-only import:
// the header component reads these types and rules in the browser.

import type { MenuItem } from '@/lib/userMenu'

export type HeaderSession =
  | { signedIn: false }
  | {
      signedIn: true
      userId: string
      role: string | null
      name: string
      avatarUrl: string | null
      gender: string | null
      unread: number
      messagesUnread: number
      items: MenuItem[]
      /** "View as" (owner, 26 Oct 2026): the member the Owner is viewing. */
      viewAsName: string | null
    }

/**
 * Is there a Supabase sign-in cookie in this browser? (@supabase/ssr keeps the
 * session in `sb-<project>-auth-token`, split into `.0`, `.1` … when long, and
 * it is readable by script.) No cookie = a guest for certain, so the header
 * shows Join free / Login with no request at all. A cookie that has expired is
 * settled by the route, which answers signedIn: false.
 */
export function hasAuthCookie(cookieHeader: string | null | undefined): boolean {
  return /(?:^|;\s*)sb-[^=;]+-auth-token(?:\.\d+)?=[^;]/.test(cookieHeader ?? '')
}

export type MemberRole = 'tutor' | 'parent'

export function isMemberRole(role: string | null | undefined): role is MemberRole {
  return role === 'tutor' || role === 'parent'
}

/** Where tapping the avatar or name goes. Admins land on the admin panel. */
export function dashboardHrefFor(role: string | null | undefined): string {
  return role === 'tutor' ? '/tutor/dashboard' : role === 'parent' ? '/parent/dashboard' : '/admin'
}

/** What the notifications panel says when it is empty — the next useful step
 *  for this kind of account (moved unchanged from the server Navbar). */
export function emptyNotificationsFor(role: string | null | undefined): { hint: string; action: { label: string; href: string } } {
  if (role === 'tutor')
    return {
      hint: 'Notifications arrive when parents apply to your tuitions, message you or book a demo.',
      action: { label: 'Complete your profile', href: '/tutor/complete-profile' },
    }
  if (role === 'admin')
    return {
      hint: 'Your account has nothing waiting. Member reports and queues live in the admin panel.',
      action: { label: 'Open the admin panel', href: '/admin' },
    }
  return {
    hint: 'Notifications arrive when a tutor applies to your job, replies to you, or accepts a demo.',
    action: { label: 'Browse tutors', href: '/browse/tutors' },
  }
}

export const MESSAGES_BASE_PATH: Record<MemberRole, string> = {
  tutor: '/tutor/dashboard/messages',
  parent: '/parent/dashboard/messages',
}
