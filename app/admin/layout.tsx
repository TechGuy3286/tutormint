import { redirect } from 'next/navigation'
import { getSessionUser } from '@/lib/auth'

// Server gate for the whole /admin subtree. Every admin page is private, so
// unlike /tutor and /parent this layout gates at the top level.
//
// Replaces the client-side password prompt in app/admin/dashboard/page.tsx
// (which compared against literals shipped in the browser bundle and was
// bypassable by setting localStorage.adminAuth = "true") and the hardcoded
// email comparison in app/admin/social-share/page.tsx.
//
// role='admin' is set by SQL only -- 14_handle_new_user.sql refuses to mint an
// admin from signup metadata, so this cannot be self-assigned.
//
// A non-admin gets redirect('/') rather than a 403: the existence of the admin
// area is not worth advertising.

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const session = await getSessionUser()

  if (!session) {
    redirect(`/login?next=${encodeURIComponent('/admin/dashboard')}`)
  }

  if (session.profile?.role !== 'admin') {
    redirect('/')
  }

  return <>{children}</>
}
