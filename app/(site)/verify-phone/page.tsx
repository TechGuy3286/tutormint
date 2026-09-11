import Breadcrumbs from '@/components/Breadcrumbs'
import type { Metadata } from 'next'
import { redirect } from 'next/navigation'
import { MessageCircle, Mail } from 'lucide-react'
import { createClient } from '@/lib/supabase/server'
import { homeForRole, nextForRole, type Role } from '@/lib/authRoutes'
import { formatPkMobile } from '@/lib/phone'
import { getSupportContact, whatsappHref } from '@/lib/support'
import { needsPhoneGate } from '@/lib/phoneGate'
import { OTP_SMS_SENDER } from '@/lib/otpChannel'
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

  // Already done, or never gated in the first place — a verified number, an
  // email-path account with no mobile, an imported tutor, or an account that
  // predates mobile-first signup. Same predicate the proxy gates with, so the
  // page cannot disagree with the redirect that sent someone here.
  if (!needsPhoneGate(profile)) {
    redirect(nextForRole(next, role) ?? home)
  }

  // Reached only when needsPhoneGate() was true, which requires a non-null
  // profile; the optional chain keeps the compiler happy without a bare `!`.
  const mobile = (profile?.phone_number as string) || ''

  // The fallback (owner, Part 6). The code is delivered by SMS (SendPK, short
  // code 8062050), but delivery is fire-and-forget — an SMS can still fail to
  // arrive and the system cannot tell — so a member who never receives one needs
  // a route forward or /verify-phone is a dead end. The same pattern /support
  // uses: WhatsApp + email from app_settings with env fallbacks, never
  // hardcoded, and a channel with nothing configured is not offered. The support
  // WhatsApp button below is how a member reaches a human — unrelated to how the
  // code itself is delivered. No invented delivery time.
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
          <h1 className="text-xl font-black text-tm-navy">Your account is created — verify your number</h1>
          <p className="text-xs leading-relaxed text-gray-500">
            We sent a 6-digit code by{' '}
            <span className="font-bold text-tm-green-deep">SMS</span> to{' '}
            <span className="font-bold text-tm-navy">{formatPkMobile(mobile)}</span>. It arrives from{' '}
            <span className="font-bold text-tm-navy">{OTP_SMS_SENDER}</span> — that short code is us.
            Enter it to verify your number and reach your dashboard — you can’t continue until you do.
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
            <p className="text-xs font-bold text-tm-navy">Code not arriving?</p>
            <p className="text-[11px] leading-relaxed text-gray-500">
              If the SMS hasn&rsquo;t arrived, message us and we&rsquo;ll verify you.
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
