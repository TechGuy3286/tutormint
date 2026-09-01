'use client'

import { useState } from 'react'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/client'

// Password reset.
//
// The reset link lands on /api/auth/callback, which exchanges the code for a
// session and forwards to /account/password -- the form that already exists for
// replacing a temporary password. One screen, two ways of arriving at it.
//
// The response is ALWAYS the same, whether or not that address has an account.
// A reset form that says "no account with that email" is a way to test whether
// somebody is a TutorMint member, one address at a time, and /api/auth/login
// goes to some trouble to avoid being exactly that.
//
// Delivery depends on SMTP being configured on the Supabase project. It is not
// yet; see PRODUCTION_CHECKLIST.md. Until it is, this form will report success
// and no email will arrive -- which is why the copy says "if there is an
// account" rather than "we have sent you an email".

export default function ForgotPasswordPage() {
  const [email, setEmail] = useState('')
  const [busy, setBusy] = useState(false)
  const [sent, setSent] = useState(false)

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    setBusy(true)

    const supabase = createClient()
    await supabase.auth.resetPasswordForEmail(email.trim(), {
      redirectTo: `${window.location.origin}/api/auth/callback?next=${encodeURIComponent('/account/password')}`,
    })

    // The error is deliberately not surfaced. Rate limiting and unknown
    // addresses both come back as errors, and showing either tells the caller
    // something about the address they typed.
    setSent(true)
    setBusy(false)
  }

  return (
    <main className="flex min-h-screen items-center justify-center bg-[#F8FAFC] p-4 text-[#334155] sm:p-6">
      <div className="w-full max-w-md space-y-6 rounded-3xl border border-gray-200 bg-white p-6 shadow-xl sm:p-8">
        <div className="space-y-2 text-center">
          <Link
            href="/"
            className="inline-flex min-h-[44px] items-center justify-center text-xl font-black text-[#0F172A]"
          >
            Tutor<span className="text-[#d60008]">Mint</span>
          </Link>
          <h1 className="text-xl font-black text-[#0F172A]">Reset your password</h1>
        </div>

        {sent ? (
          <div className="space-y-4">
            <p className="rounded-xl border border-emerald-200 bg-emerald-50 p-4 text-xs leading-relaxed text-[#059669]">
              If there is an account for <strong>{email}</strong>, a reset link is on its way. It is
              valid for one hour.
            </p>
            <p className="text-center text-xs leading-relaxed text-gray-500">
              Signed up with your mobile number rather than an email address?{' '}
              <Link href="/support" className="font-bold text-[#d60008] hover:underline">
                Message us
              </Link>{' '}
              from that number and we will help.
            </p>
            <Link
              href="/login"
              className="flex min-h-[44px] w-full items-center justify-center rounded-xl border border-gray-200 px-4 text-xs font-bold text-[#0F172A] hover:border-[#0F172A]"
            >
              Back to sign in
            </Link>
          </div>
        ) : (
          <form onSubmit={submit} className="space-y-4">
            <p className="text-xs leading-relaxed text-gray-500">
              Enter the email address you registered with and we will send you a link to set a new
              password.
            </p>

            <div className="space-y-1">
              <label htmlFor="email" className="text-xs font-bold text-[#0F172A]">
                Email address
              </label>
              <input
                id="email"
                type="email"
                required
                autoComplete="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="name@example.com"
                className="min-h-[44px] w-full rounded-xl border border-gray-200 bg-[#F8FAFC] p-3 text-sm outline-none focus:border-[#0F172A] focus:bg-white"
              />
            </div>

            <button
              type="submit"
              disabled={busy}
              className="min-h-[44px] w-full rounded-xl bg-[#d60008] py-3.5 text-xs font-bold uppercase tracking-wider text-white shadow-md transition-colors hover:bg-red-700 disabled:opacity-50"
            >
              {busy ? 'Sending…' : 'Send reset link'}
            </button>

            <Link
              href="/login"
              className="flex min-h-[44px] items-center justify-center text-xs font-bold text-gray-500 hover:text-[#0F172A]"
            >
              Back to sign in
            </Link>
          </form>
        )}
      </div>
    </main>
  )
}
