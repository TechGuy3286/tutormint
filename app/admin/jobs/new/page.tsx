import Link from 'next/link'
import { requireAdminRole, SCREEN_ACCESS } from '@/lib/adminAuth'
import { teamParentId } from '@/lib/teamAccount'
import AdminJobForm from './AdminJobForm'

// Post a tuition on the team-operated TutorMint account (owner, 9 Sep 2026).
//
// Manager + support (SCREEN_ACCESS.jobsPost). The page refuses — with a plain
// explanation, never an invented recipient — when the team account has not been
// provisioned yet: an admin-posted job MUST belong to a real parent_featured
// account so applications, threads and hiring work through the ordinary flow.

export const dynamic = 'force-dynamic'

export default async function AdminPostJobPage() {
  await requireAdminRole(...SCREEN_ACCESS.jobsPost)

  const teamId = await teamParentId()

  return (
    <div className="max-w-2xl space-y-4">
      <header className="space-y-1">
        <h1 className="text-lg font-black text-tm-navy">Post a tuition</h1>
        <p className="text-xs text-gray-500">
          A trusted team tuition, posted on the official TutorMint account and marked{' '}
          &ldquo;Posted by TutorMint&rdquo; everywhere it appears.
        </p>
      </header>

      {teamId ? (
        <AdminJobForm />
      ) : (
        <div className="space-y-2 rounded-2xl border border-tm-gold/40 bg-tm-tint-gold p-4 text-xs leading-relaxed text-tm-gold-ink">
          <p className="font-black">The team account is not set up yet.</p>
          <p>
            Admin-posted tuitions belong to a real, team-operated parent account (granted the
            Featured parent plan) so that applications, messages and hiring work through the
            ordinary parent flow. That account has not been provisioned on this database yet.
          </p>
          <p>
            An owner needs to run <code className="font-mono">scripts/provision-team-parent.ts</code>{' '}
            once (it creates the account on a team-controlled email or mobile and grants the plan).
            Until then, posting is disabled here rather than pointed at an invented recipient.
          </p>
          <p>
            <Link href="/admin/jobs" className="font-bold underline">
              Back to tuitions
            </Link>
          </p>
        </div>
      )}
    </div>
  )
}
