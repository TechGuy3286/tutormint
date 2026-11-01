import { redirect } from 'next/navigation'
import { getSessionUser, homeForRole } from '@/lib/auth'
import ErasePendingBanner from '@/components/account/ErasePendingBanner'

// Server-side gate for /tutor/dashboard/*.
// proxy.ts already bounces anonymous requests here to /login?next=; this
// repeats the session check (defence in depth) and adds the role check, which
// proxy deliberately does not do because it would need a profiles read on
// every request.

// Personal / signed-in pages stay dynamic (push 3, owner 1 Nov 2026). They
// used to be dynamic only because the site header read the sign-in cookie;
// the header is now in the browser, so this says it on purpose.
export const dynamic = 'force-dynamic'

export default async function TutorDashboardLayout({ children }: { children: React.ReactNode }) {
  const session = await getSessionUser()

  if (!session) {
    redirect(`/login?next=${encodeURIComponent('/tutor/dashboard')}`)
  }

  // A suspended member keeps their account and their data -- nothing is
  // deleted -- but the transactional surface is closed to them. Sending them
  // to one page that says so beats a dashboard of buttons that all fail.
  if (session.profile?.is_suspended) {
    redirect('/suspended')
  }

  const role = session.profile?.role

  // A signed-in user whose role is not tutor goes to their own dashboard.
  // A missing profile is treated as "not a tutor" rather than trusted.
  if (role !== 'tutor') {
    redirect(homeForRole(role))
  }

  // While the account is set to be deleted (owner, 27 Oct 2026).
  return (
    <>
      <ErasePendingBanner userId={session.user.id} />
      {children}
    </>
  )
}
