import Breadcrumbs from '@/components/Breadcrumbs'
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
        .select('must_change_password, role, admin_role')
        .eq('id', session.user.id)
        .maybeSingle()
    : { data: null }

  if (profile && !profile.must_change_password) {
    redirect(next ?? homeForRole(session.profile?.role))
  }

  // An invited staff member arriving from their link is choosing a FIRST
  // password, not replacing a temporary one somebody read to them — so the copy
  // says what is actually happening rather than mentioning a password they never
  // saw.
  const isStaffInvite = profile?.role === 'admin'
  const heading = isStaffInvite
    ? 'Welcome to the TutorMint team'
    : 'Choose your own password'
  const subtext = isStaffInvite
    ? `Set a password to finish setting up your ${(profile?.admin_role as string) ?? 'staff'} account. Once you do, you go straight to the admin panel.`
    : 'You signed in with a temporary password that somebody else generated. Replace it now — it stops working once you do.'

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
    <main className="flex min-h-screen flex-col bg-tm-bg p-4 text-slate-700 sm:p-6">
      <Breadcrumbs items={[{ label: 'Change your password' }]} />
      <div className="flex flex-1 items-center justify-center">
      <div className="w-full max-w-md space-y-5 rounded-3xl border border-gray-200 bg-white p-6 shadow-xl sm:p-8">
        <div className="space-y-2 text-center">
          <p className="text-xl font-black text-tm-navy">
            Tutor<span className="text-tm-red">Mint</span>
          </p>
          <h1 className="text-lg font-black text-tm-navy">{heading}</h1>
          <p className="text-xs leading-relaxed text-gray-500">{subtext}</p>
        </div>

        <PasswordForm next={isImportedTutor ? '/tutor/claim' : (next ?? null)} />
      </div>
      </div>
    </main>
  )
}
