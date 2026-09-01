import { redirect } from 'next/navigation'
import { getSessionUser, homeForRole } from '@/lib/auth'

// Server-side gate for /parent/dashboard/*.
// Parents and academies both live here: schools/academies are ordinary parent
// accounts with no separate label, per the final parent model.

export default async function ParentDashboardLayout({ children }: { children: React.ReactNode }) {
  const session = await getSessionUser()

  if (!session) {
    redirect(`/login?next=${encodeURIComponent('/parent/dashboard')}`)
  }

  // A suspended member keeps their account and their data -- nothing is
  // deleted -- but the transactional surface is closed to them. Sending them
  // to one page that says so beats a dashboard of buttons that all fail.
  if (session.profile?.is_suspended) {
    redirect('/suspended')
  }

  const role = session.profile?.role

  if (role !== 'parent' && role !== 'academy') {
    redirect(homeForRole(role))
  }

  return <>{children}</>
}
