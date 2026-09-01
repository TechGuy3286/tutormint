import type { Metadata } from 'next'
import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { homeForRole, nextForRole, type Role } from '@/lib/authRoutes'
import { formatPkMobile } from '@/lib/phone'
import VerifyPhoneForm from './VerifyPhoneForm'

// The gate screen.
//
// proxy.ts sends every gated request here while an account created through
// mobile-first signup has no verified number. This page is the only
// authenticated page such an account can reach, so it has to be able to finish
// the job on its own: enter the code, get another one, or correct the number.
//
// It is also its own guard. Someone who has already verified and types the URL
// is bounced to their dashboard rather than shown a form for a thing that is
// done — and someone signed out goes to /login, because an unauthenticated
// visitor has no number to verify.

export const metadata: Metadata = {
  title: 'Verify your mobile number | TutorMint',
  robots: { index: false, follow: false },
}

export default async function VerifyPhonePage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string }>
}) {
  const { next } = await searchParams
  const supabase = await createClient()

  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) {
    const target = next ? `/verify-phone?next=${encodeURIComponent(next)}` : '/verify-phone'
    redirect(`/login?next=${encodeURIComponent(target)}`)
  }

  const { data: profile } = await supabase
    .from('profiles')
    .select('role, phone_number, phone_verified_at, phone_gate_required')
    .eq('id', user.id)
    .maybeSingle()

  const role = (profile?.role as Role) ?? 'parent'
  const home = homeForRole(role)

  // Already done, or never gated in the first place (an imported tutor, or an
  // account that predates mobile-first signup). Either way there is nothing to
  // do here.
  if (profile?.phone_verified_at || !profile?.phone_gate_required) {
    redirect(nextForRole(next, role) ?? home)
  }

  const mobile = (profile.phone_number as string) || ''

  return (
    <main className="flex min-h-screen items-center justify-center bg-tm-bg p-4 text-slate-700 sm:p-6">
      <div className="w-full max-w-md space-y-6 rounded-3xl border border-gray-200 bg-white p-6 shadow-xl sm:p-8">
        <div className="space-y-2 text-center">
          <span className="inline-block rounded-2xl bg-tm-tint-green p-3 text-3xl">📱</span>
          <h1 className="text-xl font-black text-tm-navy">Verify your mobile number</h1>
          <p className="text-xs leading-relaxed text-gray-500">
            We sent a 6-digit code to{' '}
            <span className="font-bold text-tm-navy">{formatPkMobile(mobile)}</span>. Enter it to
            finish setting up your account.
          </p>
        </div>

        <VerifyPhoneForm
          mobile={mobile}
          home={nextForRole(next, role) ?? home}
        />
      </div>
    </main>
  )
}
