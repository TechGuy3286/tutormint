// Where a member's header Settings control points. A PLAIN module on purpose:
// it is read by the server Navbar, and a value exported from a 'use client'
// file is only a client reference on the server — reading a property of it
// gave `undefined`, and <Link href={undefined}> crashed every signed-in member
// page ("Cannot destructure property 'auth'", 9 Oct 2026).
export const MEMBER_SETTINGS_HREF = {
  tutor: '/tutor/dashboard/settings',
  parent: '/parent/dashboard/settings',
} as const

/**
 * The member's Team conversation — the final address, per role (owner, 13 Oct
 * 2026). /account/messages still redirects here for links already sent; nothing
 * new should point at the redirect.
 */
export function teamMessagesHref(role: string | null | undefined): string {
  return role === 'tutor' ? '/tutor/dashboard/messages/team' : '/parent/dashboard/messages/team'
}
