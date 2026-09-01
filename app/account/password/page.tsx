import { redirect } from 'next/navigation'
import { getSessionUser, homeForRole } from '@/lib/auth'
import { createAdminClient } from '@/lib/supabase/admin'
import PasswordForm from './PasswordForm'

// Replace a temporary password. The first screen an imported tutor or a newly
// invited staff member sees.
//
// Not skippable by typing the next URL: everything downstream still works
// because the flag is on the profile, and the claim flow checks it too. But it
// is also not a trap — a member who has already changed their password is sent
// on rather than shown a form they do not need.

export const dynamic = 'force-dynamic'

export default async function PasswordPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string }>
}) {
  const { next } = await searchParams
  const session = await getSessionUser()
  if (!session) redirect(`/login?next=${encodeURIComponent('/account/password')}`)

  const admin = createAdminClient()
  const { data: profile } = admin
    ? await admin
        .from('profiles')
        .select('must_change_password, role')
        .eq('id', session.user.id)
        .maybeSingle()
    : { data: null }

  if (profile && !profile.must_change_password) {
    redirect(next ?? homeForRole(session.profile?.role))
  }

  // An imported tutor goes on to claim their profile; anyone else (staff) goes
  // to their dashboard.
  const isImportedTutor = admin
    ? !!(
        await admin
          .from('tutor_profiles')
          .select('id')
          .eq('id', session.user.id)
          .eq('imported', true)
          .is('claimed_at', null)
          .maybeSingle()
      ).data
    : false

  return (
    <main className="flex min-h-screen items-center justify-center bg-tm-bg p-4 text-slate-700 sm:p-6">
      <div className="w-full max-w-md space-y-5 rounded-3xl border border-gray-200 bg-white p-6 shadow-xl sm:p-8">
        <div className="space-y-2 text-center">
          <p className="text-xl font-black text-tm-navy">
            Tutor<span className="text-tm-red">Mint</span>
          </p>
          <h1 className="text-lg font-black text-tm-navy">Choose your own password</h1>
          <p className="text-xs leading-relaxed text-gray-500">
            You signed in with a temporary password that somebody else generated. Replace it now —
            it stops working once you do.
          </p>
        </div>

        <PasswordForm next={isImportedTutor ? '/tutor/claim' : (next ?? null)} />
      </div>
    </main>
  )
}
