import Breadcrumbs from '@/components/Breadcrumbs'
import type { Metadata } from 'next'
import { redirect } from 'next/navigation'
import { cookies } from 'next/headers'
import { MessageCircle, Mail } from 'lucide-react'
import { createClient } from '@/lib/supabase/server'
import { homeForRole, nextForRole, type Role } from '@/lib/authRoutes'
import { formatPkMobile } from '@/lib/phone'
import { getSupportContact, whatsappHref } from '@/lib/support'
import { needsPhoneGate } from '@/lib/phoneGate'
import { readPendingMobile, PENDING_COOKIE } from '@/lib/pendingSignup'
import { OTP_SMS_SENDER } from '@/lib/otpChannel'
import VerifyPhoneForm from './VerifyPhoneForm'
import PendingVerifyForm from './PendingVerifyForm'

// The mobile code-entry screen, in two modes.
//
// PENDING SIGNUP (owner, 11 Sep 2026 — nothing persisted until verified). A
// mobile signup creates no account; a pending_signups row holds the draft and
// the code, keyed by an httpOnly cookie. This page reads that cookie WITHOUT a
// session and lets the member enter the code — verifying it creates the account
// and signs them in. If the SMS never arrives the fallback is EMAIL SIGNUP (a
// free path that already works), not a resend: one SMS per number, and the code
// expires in ten minutes, after which starting over sends one new message.
//
// AUTHENTICATED GATE. A signed-in account still awaiting a number — a legacy
// mobile-first account, or a bridge-verified one told to re-verify once the real
// provider lands (login raises the gate) — lands here with a session and uses
// the signed-in code path. It is also its own guard: someone already verified is
// bounced to their dashboard, someone signed out with no pending draft to /login.

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

  // The support fallback (owner, Part 6), read once for whichever mode renders.
  // Never hardcoded — app_settings first, env fallback, and a channel with
  // nothing configured is not offered.
  const support = await getSupportContact()
  const waHref = whatsappHref(
    support.whatsapp,
    "Assalam-o-Alaikum, I'm not receiving my TutorMint verification code. Please help me verify my number.",
  )

  // ============================================ AUTHENTICATED GATE ==========
  if (user) {
    const { data: profile } = await supabase
      .from('profiles')
      .select('role, phone_number, phone_verified_at, phone_gate_required')
      .eq('id', user.id)
      .maybeSingle()

    const role = (profile?.role as Role | null) ?? null
    const home = homeForRole(role)

    // Already done, or never gated — a verified number, an email-path account,
    // an imported tutor, or an account predating mobile-first signup.
    if (!needsPhoneGate(profile)) {
      redirect(nextForRole(next, role) ?? home)
    }

    const mobile = (profile?.phone_number as string) || ''

    return (
      <Shell
        heading="Verify your number"
        title="Your account is created — verify your number"
        intro={
          <>
            Enter the 6-digit code we sent by <span className="font-bold text-tm-green-deep">SMS</span> to{' '}
            <span className="font-bold text-tm-navy">{formatPkMobile(mobile)}</span> (from{' '}
            <span className="font-bold text-tm-navy">{OTP_SMS_SENDER}</span>) to reach your dashboard.
          </>
        }
        support={support}
        waHref={waHref}
      >
        <VerifyPhoneForm mobile={mobile} home={nextForRole(next, role) ?? home} />
      </Shell>
    )
  }

  // ================================================ PENDING SIGNUP ==========
  const jar = await cookies()
  const pendingMobile = await readPendingMobile(jar.get(PENDING_COOKIE)?.value)

  if (!pendingMobile) {
    // No session and no live draft: nothing to verify here.
    redirect('/login')
  }

  return (
    <Shell
      heading="Verify your number"
      title="Enter your code to finish signing up"
      intro={
        <>
          We sent a 6-digit code by <span className="font-bold text-tm-green-deep">SMS</span> to{' '}
          <span className="font-bold text-tm-navy">{formatPkMobile(pendingMobile)}</span>. It comes from{' '}
          <span className="font-bold text-tm-navy">{OTP_SMS_SENDER}</span> — that short code is us. Your account
          is created the moment you enter it.
        </>
      }
      support={support}
      waHref={waHref}
    >
      <PendingVerifyForm next={next ?? null} />
    </Shell>
  )
}

// One shell for both modes: the card, the intro, and the human support fallback
// (WhatsApp + email), which both modes share and which is unrelated to how the
// code is delivered.
function Shell({
  heading,
  title,
  intro,
  children,
  support,
  waHref,
}: {
  heading: string
  title: string
  intro: React.ReactNode
  children: React.ReactNode
  support: { email: string | null }
  waHref: string | null
}) {
  return (
    <main className="flex min-h-screen flex-col bg-tm-bg p-4 text-slate-700 sm:p-6">
      <Breadcrumbs items={[{ label: heading }]} />
      <div className="flex flex-1 items-center justify-center">
        <div className="w-full max-w-md space-y-6 rounded-3xl border border-gray-200 bg-white p-6 shadow-xl sm:p-8">
          <div className="space-y-2 text-center">
            <span className="inline-block rounded-2xl bg-tm-tint-green p-3 text-3xl">📱</span>
            <h1 className="text-xl font-black text-tm-navy">{title}</h1>
            <p className="text-xs leading-relaxed text-gray-500">{intro}</p>
          </div>

          {children}

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
