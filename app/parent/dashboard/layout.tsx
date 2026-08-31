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

  const role = session.profile?.role

  if (role !== 'parent' && role !== 'academy') {
    redirect(homeForRole(role))
  }

  return <>{children}</>
}
