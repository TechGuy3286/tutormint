import Link from 'next/link'
import Breadcrumbs from '@/components/Breadcrumbs'
import { Mail } from 'lucide-react'
import ResendEmail from './ResendEmail'

// The email-path landing after signup (owner, Sunday 6 Sep; email path live
// again Part 8, 9 Sep). An account created with an email address is UNconfirmed
// and has no session — Supabase sends a confirmation link over Resend
// (noreply@tutormint.org) and the member finishes by clicking it. This page is
// the "check your inbox" screen; the mail genuinely sends now that SMTP is
// configured, and a Resend button re-sends it (Supabase caps this to one every
// 60s per user, and the button surfaces that wait rather than failing quietly).

export const dynamic = 'force-dynamic'

export default async function VerifyEmailPage({
  searchParams,
}: {
  searchParams: Promise<{ to?: string }>
}) {
  const { to } = await searchParams
  const address = (to ?? '').trim()

  return (
    <main className="flex min-h-screen flex-col bg-tm-bg p-4 text-slate-700 sm:p-6">
      <Breadcrumbs items={[{ label: 'Confirm your email' }]} />
      <div className="flex flex-1 items-center justify-center">
        <div className="w-full max-w-md space-y-5 rounded-3xl border border-gray-200 bg-white p-6 text-center shadow-xl sm:p-8">
          <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-full bg-tm-tint-green">
            <Mail aria-hidden size={26} className="text-tm-green-deep" />
          </div>
          <h1 className="text-xl font-black text-tm-navy">Check your email</h1>
          <p className="text-sm leading-relaxed text-slate-700">
            We’ve sent a confirmation link
            {address ? (
              <>
                {' '}to <span className="font-bold text-tm-navy">{address}</span>
              </>
            ) : null}
            . Open it to finish creating your account, then sign in.
          </p>
          <p className="text-[11px] leading-relaxed text-gray-500">
            The link can take a few minutes to arrive. Check your spam folder if you don’t see it.
            You can also sign up with a mobile number instead — that confirms with a code on WhatsApp.
          </p>
          {address && <ResendEmail address={address} />}
          <div className="flex flex-col gap-2">
            <Link
              href="/login"
              className="inline-flex min-h-[44px] items-center justify-center rounded-xl bg-tm-red px-5 text-xs font-bold text-white hover:bg-tm-red-hover"
            >
              Go to sign in
            </Link>
            <Link
              href="/register"
              className="inline-flex min-h-[44px] items-center justify-center rounded-xl border border-gray-200 px-5 text-xs font-bold text-tm-navy hover:border-tm-navy"
            >
              Use a mobile number instead
            </Link>
          </div>
        </div>
      </div>
    </main>
  )
}
