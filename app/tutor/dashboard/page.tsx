import Link from 'next/link'
import { getSessionUser } from '@/lib/auth'
import { createClient } from '@/lib/supabase/server'

// Minimal real dashboard. The previous version was entirely mock data
// ("Sir Bilal Ahmed", fake leads, fake ratings) and granted itself a session
// by writing tm_logged_in/tm_email to localStorage when none was found.
//
// This is deliberately small: it exists to prove the auth spine works end to
// end. The real dashboard -- completion widget, plan, quota, matching jobs --
// is T4.

export default async function TutorDashboardPage() {
  // The layout has already guaranteed a tutor session.
  const session = await getSessionUser()
  const supabase = await createClient()

  const { data: tutorProfile } = await supabase
    .from('tutor_profiles')
    .select('headline, city, area, verification_status, video_status')
    .eq('id', session!.user.id)
    .maybeSingle()

  const completion = session?.profile?.profile_completion ?? 0
  const firstName = (session?.profile?.full_name ?? 'there').split(' ')[0]

  return (
    <main className="min-h-screen bg-[#F8FAFC] py-8 px-4 sm:px-6 lg:px-8 text-[#334155]">
      <div className="max-w-4xl mx-auto space-y-6">
        <header className="bg-white p-6 rounded-3xl shadow-sm border border-gray-200 space-y-1">
          <h1 className="text-xl sm:text-2xl font-black text-[#0F172A]">
            Welcome back, {firstName}
          </h1>
          <p className="text-xs text-gray-500">
            Signed in as {session?.user.email}
            {tutorProfile?.city ? ` · ${tutorProfile.city}` : ''}
          </p>
        </header>

        <section className="bg-white p-6 rounded-3xl shadow-sm border border-gray-200 space-y-3">
          <div className="flex items-baseline justify-between gap-3">
            <h2 className="text-sm font-bold text-[#0F172A]">Profile completion</h2>
            <span className="text-sm font-black text-[#0F172A]">{completion}%</span>
          </div>
          <div className="h-2 w-full bg-gray-100 rounded-full overflow-hidden">
            <div
              className="h-full bg-[#059669] rounded-full transition-all"
              style={{ width: `${Math.min(Math.max(completion, 0), 100)}%` }}
            />
          </div>
          <p className="text-xs text-gray-500 leading-relaxed">
            You need 100% before your profile is listed in the tutor directory.
          </p>
          <Link
            href="/tutor/complete-profile"
            className="inline-flex items-center justify-center min-h-[44px] px-5 py-2.5 bg-[#0F172A] hover:bg-[#059669] text-white font-bold text-xs uppercase tracking-wider rounded-xl transition-colors"
          >
            Complete your profile
          </Link>
        </section>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <section className="bg-white p-6 rounded-3xl shadow-sm border border-gray-200 space-y-1">
            <h2 className="text-xs font-bold uppercase tracking-wider text-gray-400">Your plan</h2>
            <p className="text-base font-black text-[#0F172A]">No active plan</p>
            <p className="text-xs text-gray-500">Packages arrive in a later release.</p>
          </section>

          <section className="bg-white p-6 rounded-3xl shadow-sm border border-gray-200 space-y-1">
            <h2 className="text-xs font-bold uppercase tracking-wider text-gray-400">
              Verification
            </h2>
            <p className="text-base font-black text-[#0F172A] capitalize">
              {tutorProfile?.verification_status ?? 'pending'}
            </p>
            <p className="text-xs text-gray-500">
              Video: {tutorProfile?.video_status ?? 'none'}
            </p>
          </section>
        </div>

        <section className="bg-white p-6 rounded-3xl shadow-sm border border-gray-200 space-y-2">
          <h2 className="text-sm font-bold text-[#0F172A]">Matching tuition jobs</h2>
          <div className="py-8 text-center space-y-2">
            <p className="text-xs font-bold text-gray-500">No matching jobs yet</p>
            <p className="text-xs text-gray-400 max-w-sm mx-auto leading-relaxed">
              Once your profile lists the subjects and levels you teach, open jobs that match will
              appear here.
            </p>
            <Link
              href="/browse/tuitions"
              className="inline-flex items-center justify-center min-h-[44px] px-5 py-2.5 mt-1 bg-[#F8FAFC] hover:bg-gray-100 border border-gray-200 text-[#334155] font-bold text-xs rounded-xl transition-colors"
            >
              Browse all tuitions
            </Link>
          </div>
        </section>
      </div>
    </main>
  )
}
