import Link from 'next/link'
import { redirect } from 'next/navigation'
import { ShieldAlert } from 'lucide-react'
import { getSessionUser } from '@/lib/auth'

// Where a suspended member lands.
//
// One page that says what happened, why, and what to do about it — instead of
// a dashboard whose every button returns 403. The reason shown is the one the
// moderator wrote, verbatim: a suspension nobody can understand is a support
// ticket that starts angry.
//
// Nothing has been deleted, and the page says so, because that is both true and
// the first thing anyone in this position wants to know.

export const dynamic = 'force-dynamic'

export default async function SuspendedPage() {
  const session = await getSessionUser()
  if (!session) redirect('/login')

  // Not suspended: nothing to see. Sending them home beats a page telling a
  // member in good standing about suspensions.
  if (!session.profile?.is_suspended) redirect('/')

  return (
    <main className="min-h-screen bg-[#F8FAFC] px-4 py-10 text-[#334155] sm:px-6">
      <div className="mx-auto max-w-md space-y-4">
        <section className="space-y-3 rounded-2xl border border-amber-200 bg-white p-5 text-center">
          <ShieldAlert size={40} className="mx-auto text-[#F59E0B]" />
          <h1 className="text-lg font-black text-[#0F172A]">Your account is suspended</h1>

          {session.profile.suspension_reason && (
            <p className="rounded-xl bg-[#FFFBEB] p-3 text-left text-xs leading-relaxed text-[#92400E]">
              {session.profile.suspension_reason}
            </p>
          )}

          <p className="text-xs leading-relaxed text-gray-500">
            Nothing has been deleted. Your profile, conversations, applications and posts are all
            still here, and they come back exactly as they were if the suspension is lifted.
          </p>
          <p className="text-xs leading-relaxed text-gray-500">
            If you think this is a mistake, write to us and a person will look at it.
          </p>
        </section>

        <div className="flex flex-col gap-2 sm:flex-row">
          <Link
            href="/support"
            className="inline-flex min-h-[44px] flex-1 items-center justify-center rounded-xl bg-[#0F172A] px-5 text-xs font-bold text-white"
          >
            Contact support
          </Link>
          <Link
            href="/"
            className="inline-flex min-h-[44px] flex-1 items-center justify-center rounded-xl border border-gray-200 bg-white px-5 text-xs font-bold text-[#334155]"
          >
            Back to TutorMint
          </Link>
        </div>
      </div>
    </main>
  )
}
