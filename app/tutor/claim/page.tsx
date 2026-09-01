import { redirect } from 'next/navigation'
import { getSessionUser } from '@/lib/auth'
import { createAdminClient } from '@/lib/supabase/admin'
import { formatPkMobile, normalisePkMobile } from '@/lib/phone'
import ClaimFlow from './ClaimFlow'

// "Is this you?" — the screen an imported tutor lands on after replacing their
// temporary password.
//
// It shows them the profile that was created FOR them before asking them to
// stand behind it. An admin typed those details off a spreadsheet; the tutor
// is entitled to see exactly what the platform is about to say publicly in
// their name before they accept the terms that make it theirs.

export const dynamic = 'force-dynamic'

export default async function ClaimPage() {
  const session = await getSessionUser()
  if (!session) redirect(`/login?next=${encodeURIComponent('/tutor/claim')}`)

  const admin = createAdminClient()
  if (!admin) {
    return (
      <main className="min-h-screen bg-tm-bg p-6 text-center text-xs font-bold text-tm-red">
        The server is not configured. Please contact support.
      </main>
    )
  }

  const userId = session.user.id

  const [{ data: tutor }, { data: profile }] = await Promise.all([
    admin
      .from('tutor_profiles')
      .select('id, slug, full_name, headline, city, area, subjects, imported, claimed_at, terms_accepted_at')
      .eq('id', userId)
      .maybeSingle(),
    admin
      .from('profiles')
      .select('phone_number, phone_verified_at, must_change_password, profile_completion')
      .eq('id', userId)
      .maybeSingle(),
  ])

  // Not an imported profile, or already claimed: nothing to do here.
  if (!tutor?.imported || tutor.claimed_at) redirect('/tutor/dashboard')
  if (profile?.must_change_password) redirect('/account/password')

  const msisdn = normalisePkMobile(profile?.phone_number as string)

  return (
    <main className="min-h-screen bg-tm-bg px-4 py-6 text-slate-700 sm:px-6 sm:py-10">
      <div className="mx-auto max-w-lg space-y-4">
        <header className="space-y-1 text-center">
          <p className="text-xl font-black text-tm-navy">
            Tutor<span className="text-tm-red">Mint</span>
          </p>
          <h1 className="text-lg font-black text-tm-navy">Is this you?</h1>
          <p className="text-xs leading-relaxed text-gray-500">
            We created this profile from details we were given. Check it over, then claim it — until
            you do, it does not appear in search.
          </p>
        </header>

        <section className="space-y-2 rounded-2xl border border-gray-200 bg-white p-4 sm:p-5">
          <Row label="Name" value={(tutor.full_name as string) ?? '—'} />
          <Row label="Mobile" value={msisdn ? formatPkMobile(msisdn) : ((profile?.phone_number as string) ?? '—')} />
          <Row label="City" value={(tutor.city as string) ?? '—'} />
          <Row label="Area" value={(tutor.area as string) ?? '—'} />
          <Row label="Subjects" value={((tutor.subjects as string[]) ?? []).join(', ') || '—'} />
          <Row label="Profile address" value={`/tutor/${tutor.slug}`} />
        </section>

        <ClaimFlow
          termsAccepted={!!tutor.terms_accepted_at}
          phoneVerified={!!profile?.phone_verified_at}
          phone={msisdn ? formatPkMobile(msisdn) : ((profile?.phone_number as string) ?? '')}
          rawPhone={(profile?.phone_number as string) ?? ''}
        />

        <p className="text-center text-[11px] leading-relaxed text-gray-400">
          Something wrong above? Claim the profile first, then correct anything you like from your
          dashboard. If this is not you at all, contact support and we will remove it.
        </p>
      </div>
    </main>
  )
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex flex-wrap items-baseline justify-between gap-2 border-b border-gray-100 pb-2 last:border-0">
      <dt className="text-[11px] font-bold uppercase tracking-wide text-gray-400">{label}</dt>
      <dd className="text-right text-xs font-semibold text-tm-navy">{value}</dd>
    </div>
  )
}
