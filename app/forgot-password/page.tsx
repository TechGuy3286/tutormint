'use client'

import { useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'

// Password reset, two ways in.
//
// MOBILE (the default). Most members register with a number and no email, so
// there is no inbox to send a link to. A code goes to the handset and the new
// password is set on this page. /api/auth/reset does the work.
//
// EMAIL. For members who gave an address. The reset link lands on
// /api/auth/callback, which exchanges the code for a session and forwards to
// /account/password -- the form that already exists for replacing a temporary
// password. One screen, two ways of arriving at it.
//
// NEITHER PATH SAYS WHETHER THE ACCOUNT EXISTS. A reset form that answers "no
// account with that number" is a way to test whether somebody is a TutorMint
// member, one identifier at a time, and /api/auth/login goes to some trouble
// not to be exactly that. The mobile path returns the same message either way;
// the email path never surfaces its error.
//
// Email delivery depends on SMTP being configured on the Supabase project. It
// is not yet -- see PRODUCTION_CHECKLIST.md -- which is the other reason the
// mobile path is the default rather than the alternative.

type Mode = 'mobile' | 'email'

export default function ForgotPasswordPage() {
  const router = useRouter()

  const [mode, setMode] = useState<Mode>('mobile')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  // email path
  const [email, setEmail] = useState('')
  const [emailSent, setEmailSent] = useState(false)

  // mobile path
  const [mobile, setMobile] = useState('')
  const [codeRequested, setCodeRequested] = useState(false)
  const [code, setCode] = useState('')
  const [password, setPassword] = useState('')
  const [done, setDone] = useState(false)

  async function submitEmail(e: React.FormEvent) {
    e.preventDefault()
    setBusy(true)

    const supabase = createClient()
    await supabase.auth.resetPasswordForEmail(email.trim(), {
      redirectTo: `${window.location.origin}/api/auth/callback?next=${encodeURIComponent('/account/password')}`,
    })

    // The error is deliberately not surfaced. Rate limiting and unknown
    // addresses both come back as errors, and showing either tells the caller
    // something about the address they typed.
    setEmailSent(true)
    setBusy(false)
  }

  async function requestCode(e: React.FormEvent) {
    e.preventDefault()
    setBusy(true)
    setError('')

    const res = await fetch('/api/auth/reset', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'request', mobile }),
    })
    const data = await res.json().catch(() => ({}))

    if (!res.ok) {
      // Only transport and rate-limit failures reach here; the route itself
      // answers the same way for a known and an unknown number.
      setError(data.error ?? 'Could not send a code right now.')
      setBusy(false)
      return
    }

    setCodeRequested(true)
    setBusy(false)
  }

  async function confirmReset(e: React.FormEvent) {
    e.preventDefault()
    setBusy(true)
    setError('')

    const res = await fetch('/api/auth/reset', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'confirm', mobile, code, password }),
    })
    const data = await res.json().catch(() => ({}))

    if (!res.ok) {
      setError(data.error ?? 'That code was not accepted.')
      setBusy(false)
      return
    }

    setDone(true)
    setBusy(false)
  }

  const inputClass =
    'min-h-[44px] w-full rounded-xl border border-gray-200 bg-tm-bg p-3 text-sm outline-none focus:border-tm-navy focus:bg-white'

  return (
    <main className="flex min-h-screen items-center justify-center bg-tm-bg p-4 text-slate-700 sm:p-6">
      <div className="w-full max-w-md space-y-6 rounded-3xl border border-gray-200 bg-white p-6 shadow-xl sm:p-8">
        <div className="space-y-2 text-center">
          <Link
            href="/"
            className="inline-flex min-h-[44px] items-center justify-center text-xl font-black text-tm-navy"
          >
            Tutor<span className="text-tm-red">Mint</span>
          </Link>
          <h1 className="text-xl font-black text-tm-navy">Reset your password</h1>
        </div>

        {error && (
          <p className="rounded-xl border border-tm-red/30 bg-tm-tint-red p-3 text-center text-xs font-bold text-tm-red">
            {error}
          </p>
        )}

        {done ? (
          <div className="space-y-4">
            <p className="rounded-xl border border-tm-green-deep/30 bg-tm-tint-green p-4 text-xs leading-relaxed text-tm-green-deep">
              Your password has been changed. You can sign in with it now.
            </p>
            <button
              type="button"
              onClick={() => router.push('/login')}
              className="flex min-h-[44px] w-full items-center justify-center rounded-xl bg-tm-red px-4 text-xs font-bold uppercase tracking-wider text-white hover:bg-tm-red-hover"
            >
              Go to sign in
            </button>
          </div>
        ) : emailSent ? (
          <div className="space-y-4">
            <p className="rounded-xl border border-tm-green-deep/30 bg-tm-tint-green p-4 text-xs leading-relaxed text-tm-green-deep">
              If there is an account for <strong>{email}</strong>, a reset link is on its way. It is
              valid for one hour.
            </p>
            <button
              type="button"
              onClick={() => {
                setEmailSent(false)
                setMode('mobile')
              }}
              className="flex min-h-[44px] w-full items-center justify-center rounded-xl border border-gray-200 px-4 text-xs font-bold text-tm-navy hover:border-tm-navy"
            >
              Use my mobile number instead
            </button>
            <Link
              href="/login"
              className="flex min-h-[44px] items-center justify-center text-xs font-bold text-gray-500 hover:text-tm-navy"
            >
              Back to sign in
            </Link>
          </div>
        ) : (
          <>
            <div className="grid grid-cols-2 gap-2" role="tablist" aria-label="Reset method">
              {(['mobile', 'email'] as Mode[]).map((m) => (
                <button
                  key={m}
                  type="button"
                  role="tab"
                  aria-selected={mode === m}
                  onClick={() => {
                    setMode(m)
                    setError('')
                  }}
                  className={`min-h-[44px] rounded-xl border-2 px-3 text-xs font-black transition-colors ${
                    mode === m
                      ? 'border-tm-red bg-tm-tint-red text-tm-red'
                      : 'border-gray-200 bg-tm-bg text-tm-navy hover:border-gray-300'
                  }`}
                >
                  {m === 'mobile' ? 'By mobile' : 'By email'}
                </button>
              ))}
            </div>

            {mode === 'email' ? (
              <form onSubmit={submitEmail} className="space-y-4">
                <p className="text-xs leading-relaxed text-gray-500">
                  Enter the email address you registered with and we will send you a link to set a
                  new password.
                </p>
                <div className="space-y-1">
                  <label htmlFor="email" className="text-xs font-bold text-tm-navy">
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
                    className={inputClass}
                  />
                </div>
                <button
                  type="submit"
                  disabled={busy}
                  className="min-h-[44px] w-full rounded-xl bg-tm-red py-3.5 text-xs font-bold uppercase tracking-wider text-white shadow-md transition-colors hover:bg-tm-red-hover disabled:opacity-50"
                >
                  {busy ? 'Sending…' : 'Send reset link'}
                </button>
              </form>
            ) : !codeRequested ? (
              <form onSubmit={requestCode} className="space-y-4">
                <p className="text-xs leading-relaxed text-gray-500">
                  Enter the mobile number you registered with. We will send you a code.
                </p>
                <div className="space-y-1">
                  <label htmlFor="mobile" className="text-xs font-bold text-tm-navy">
                    Mobile number
                  </label>
                  <input
                    id="mobile"
                    required
                    inputMode="tel"
                    autoComplete="tel"
                    value={mobile}
                    onChange={(e) => setMobile(e.target.value)}
                    placeholder="0300 1234567"
                    className={inputClass}
                  />
                </div>
                <button
                  type="submit"
                  disabled={busy}
                  className="min-h-[44px] w-full rounded-xl bg-tm-red py-3.5 text-xs font-bold uppercase tracking-wider text-white shadow-md transition-colors hover:bg-tm-red-hover disabled:opacity-50"
                >
                  {busy ? 'Sending…' : 'Send code'}
                </button>
              </form>
            ) : (
              <form onSubmit={confirmReset} className="space-y-4">
                <p className="rounded-xl border border-gray-200 bg-tm-bg p-3 text-xs leading-relaxed text-gray-600">
                  If that number has an account, a code is on its way. Enter it below with your new
                  password.
                </p>

                <div className="space-y-1">
                  <label htmlFor="code" className="text-xs font-bold text-tm-navy">
                    6-digit code
                  </label>
                  <input
                    id="code"
                    required
                    inputMode="numeric"
                    autoComplete="one-time-code"
                    value={code}
                    onChange={(e) => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
                    placeholder="000000"
                    className={`${inputClass} text-center text-xl font-black tracking-[0.35em]`}
                  />
                </div>

                <div className="space-y-1">
                  <label htmlFor="newPassword" className="text-xs font-bold text-tm-navy">
                    New password
                  </label>
                  <input
                    id="newPassword"
                    type="password"
                    required
                    minLength={8}
                    autoComplete="new-password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    placeholder="At least 8 characters"
                    className={inputClass}
                  />
                </div>

                <button
                  type="submit"
                  disabled={busy || code.length < 6}
                  className="min-h-[44px] w-full rounded-xl bg-tm-red py-3.5 text-xs font-bold uppercase tracking-wider text-white shadow-md transition-colors hover:bg-tm-red-hover disabled:opacity-50"
                >
                  {busy ? 'Setting…' : 'Set new password'}
                </button>

                <button
                  type="button"
                  onClick={() => {
                    setCodeRequested(false)
                    setCode('')
                    setError('')
                  }}
                  className="flex min-h-[44px] w-full items-center justify-center text-xs font-bold text-gray-500 hover:text-tm-navy"
                >
                  Use a different number
                </button>
              </form>
            )}

            <Link
              href="/login"
              className="flex min-h-[44px] items-center justify-center text-xs font-bold text-gray-500 hover:text-tm-navy"
            >
              Back to sign in
            </Link>
          </>
        )}
      </div>
    </main>
  )
}
