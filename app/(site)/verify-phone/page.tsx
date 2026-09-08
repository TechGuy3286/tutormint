import Breadcrumbs from '@/components/Breadcrumbs'
import type { Metadata } from 'next'
import { redirect } from 'next/navigation'
import { MessageCircle, Mail } from 'lucide-react'
import { createClient } from '@/lib/supabase/server'
import { homeForRole, nextForRole, type Role } from '@/lib/authRoutes'
import { formatPkMobile } from '@/lib/phone'
import { getSupportContact, whatsappHref } from '@/lib/support'
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

  // No 'parent' default (owner, 9 Sep): a gated account has a role, and quietly
  // treating a role-less one as a parent is the bug we are removing. A missing
  // role means a broken profile — homeForRole throws and it surfaces.
  const role = (profile?.role as Role | null) ?? null
  const home = homeForRole(role)

  // Already done, or never gated in the first place (an imported tutor, or an
  // account that predates mobile-first signup). Either way there is nothing to
  // do here.
  if (profile?.phone_verified_at || !profile?.phone_gate_required) {
    redirect(nextForRole(next, role) ?? home)
  }

  const mobile = (profile.phone_number as string) || ''

  // The fallback (owner, Part 6). Until a real SMS provider exists, a member who
  // cannot receive a code has no route forward — /verify-phone would be a dead
  // end. The same pattern /support uses: WhatsApp + email from app_settings with
  // env fallbacks, never hardcoded, and a channel with nothing configured is not
  // offered. No invented delivery time. This block comes out when the provider
  // lands (there will be a working code path then).
  const support = await getSupportContact()
  const waHref = whatsappHref(
    support.whatsapp,
    "Assalam-o-Alaikum, I'm not receiving my TutorMint verification code. Please help me verify my number.",
  )

  return (
    <main className="flex min-h-screen flex-col bg-tm-bg p-4 text-slate-700 sm:p-6">
      <Breadcrumbs items={[{ label: 'Verify your number' }]} />
      <div className="flex flex-1 items-center justify-center">
      <div className="w-full max-w-md space-y-6 rounded-3xl border border-gray-200 bg-white p-6 shadow-xl sm:p-8">
        <div className="space-y-2 text-center">
          <span className="inline-block rounded-2xl bg-tm-tint-green p-3 text-3xl">📱</span>
          <h1 className="text-xl font-black text-tm-navy">Verify your mobile number</h1>
          <p className="text-xs leading-relaxed text-gray-500">
            We sent a 6-digit code on{' '}
            <span className="font-bold text-tm-green-deep">WhatsApp</span> to{' '}
            <span className="font-bold text-tm-navy">{formatPkMobile(mobile)}</span>. Enter it to
            finish setting up your account.
          </p>
        </div>

        <VerifyPhoneForm
          mobile={mobile}
          home={nextForRole(next, role) ?? home}
        />

        {/* Not a dead end. Only rendered when a channel is actually configured —
            a wa.me/ or mailto: with nothing behind it is worse than no button. */}
        {(waHref || support.email) && (
          <div className="space-y-2 rounded-2xl border border-gray-200 bg-tm-bg p-4">
            <p className="text-xs font-bold text-tm-navy">No WhatsApp on this number?</p>
            <p className="text-[11px] leading-relaxed text-gray-500">
              If the code hasn&rsquo;t arrived on WhatsApp, message us and we&rsquo;ll verify you.
            </p>
            <div className="flex flex-col gap-2 sm:flex-row">
              {waHref && (
                <a
                  href={waHref}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex min-h-[44px] flex-1 items-center justify-center gap-2 rounded-xl bg-tm-green-deep px-4 text-xs font-bold text-white transition-colors hover:bg-tm-green-deep-hover"
                >
                  <MessageCircle aria-hidden size={14} />
                  WhatsApp us
                </a>
              )}
              {support.email && (
                <a
                  href={`mailto:${support.email}?subject=${encodeURIComponent('Not receiving my TutorMint verification code')}`}
                  className="inline-flex min-h-[44px] flex-1 items-center justify-center gap-2 rounded-xl border border-gray-200 px-4 text-xs font-bold text-tm-navy transition-colors hover:border-tm-navy"
                >
                  <Mail aria-hidden size={14} />
                  Email us
                </a>
              )}
            </div>
          </div>
        )}
      </div>
      </div>
    </main>
  )
}
