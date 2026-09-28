'use client'

import { ArrowLeft, Smartphone } from 'lucide-react'

import Breadcrumbs from '@/components/Breadcrumbs'
import { useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import PasswordInput from '@/components/ui/PasswordInput'
import MobileNumberInput from '@/components/auth/MobileNumberInput'
import OtpCodeEntry from '@/components/auth/OtpCodeEntry'
import { submitJson } from '@/lib/submit'
import { GENERIC_ERROR, supportWhatsappHref } from '@/lib/errorMessages'

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
// Email delivery works: SMTP is configured on the Supabase project (Resend,
// owner Part 8, 9 Sep). The mobile path stays the DEFAULT because most members
// register with a number and no inbox — not because email cannot deliver.

type Mode = 'mobile' | 'email'

export default function ForgotPasswordForm() {
  const router = useRouter()

  const [mode, setMode] = useState<Mode>('mobile')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [errorUr, setErrorUr] = useState<string | null>(null)
  const [errorRef, setErrorRef] = useState<string | null>(null)

  // Show a failure with its Urdu line and reference code, the one shape every
  // auth screen uses (PR75 §2).
  function showFailure(
    failed: string | null | undefined,
    data: { errorUr?: string; ref?: string } | null,
    fallback: string,
  ) {
    setError(failed ?? fallback)
    setErrorUr(data?.errorUr ?? (data?.ref ? GENERIC_ERROR.ur : null))
    setErrorRef(data?.ref ?? null)
  }

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

    try {
      const supabase = createClient()
      await supabase.auth.resetPasswordForEmail(email.trim(), {
        redirectTo: `${window.location.origin}/api/auth/callback?next=${encodeURIComponent('/account/password')}`,
      })
    } catch {
      // Swallowed for the same reason the error below is: see the comment.
    } finally {
      // The error is deliberately not surfaced. Rate limiting and unknown
      // addresses both come back as errors, and showing either tells the caller
      // something about the address they typed. The `finally` is not about the
      // error -- it is about the button: a throw here used to leave it reading
      // "Sending…" with nothing to press.
      setEmailSent(true)
      setBusy(false)
    }
  }

  async function requestCode(e: React.FormEvent) {
    e.preventDefault()
    setBusy(true)
    setError(''); setErrorUr(null); setErrorRef(null)

    const { ok, data, error: failed } = await submitJson<{ errorUr?: string; ref?: string }>(
      '/api/auth/reset',
      { action: 'request', mobile },
    )

    if (!ok) {
      // Only transport and rate-limit failures reach here; the route itself
      // answers the same way for a known and an unknown number.
      showFailure(failed, data, 'Could not send a code right now.')
      setBusy(false)
      return
    }

    setCodeRequested(true)
    setBusy(false)
  }

  async function confirmReset() {
    setBusy(true)
    setError(''); setErrorUr(null); setErrorRef(null)

    const { ok, data, error: failed } = await submitJson<{ errorUr?: string; ref?: string }>(
      '/api/auth/reset',
      { action: 'confirm', mobile, code, password },
    )

    if (!ok) {
      showFailure(failed, data, 'That code was not accepted.')
      setBusy(false)
      return
    }

    setDone(true)
    setBusy(false)
  }

  const inputClass =
    'min-h-[44px] w-full rounded-xl border border-gray-200 bg-tm-bg p-3 text-sm outline-none focus:border-tm-navy focus:bg-white'

  return (
    <main className="flex min-h-screen flex-col bg-tm-bg p-4 text-slate-700 sm:p-6">
      <Breadcrumbs items={[{ label: 'Sign in', href: '/login' }, { label: 'Reset your password' }]} />
      <div className="flex flex-1 items-center justify-center">
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
          <div className="space-y-1.5 rounded-xl border border-tm-red/30 bg-tm-tint-red p-3 text-center text-xs font-bold text-tm-red">
            <p>{error}</p>
            {errorUr && (
              <p lang="ur" dir="rtl" className="leading-relaxed">
                {errorUr}
              </p>
            )}
            {errorRef && (
              <p className="text-[11px] font-normal text-tm-red/80">
                Ref: <span className="font-mono">{errorRef}</span>{' '}
                <a href={supportWhatsappHref(errorRef)} target="_blank" rel="noopener noreferrer" className="underline">
                  WhatsApp support
                </a>
              </p>
            )}
          </div>
        )}

        {done ? (
          <div className="space-y-4">
            <p className="rounded-xl border border-tm-green-deep/30 bg-tm-tint-green p-4 text-xs leading-relaxed text-tm-green-deep">
              Your password has been changed. You can sign in with it now.
            </p>
            <button
              type="button"
              onClick={() => router.push('/login')}
              className="flex min-h-[44px] w-full items-center justify-center rounded-xl bg-tm-red px-4 text-xs font-bold text-white hover:bg-tm-red-hover"
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
              className="flex min-h-[44px] w-full items-center justify-center gap-1.5 rounded-xl border border-gray-200 px-4 text-xs font-bold text-tm-navy hover:border-tm-navy"
            >
              <Smartphone aria-hidden size={14} />
              Use my mobile number instead
            </button>
            <Link
              href="/login"
              className="flex min-h-[44px] items-center justify-center gap-1.5 text-xs font-bold text-gray-500 hover:text-tm-navy"
            >
              <ArrowLeft aria-hidden size={14} />
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
                    setError(''); setErrorUr(null); setErrorRef(null)
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
                  className="min-h-[44px] w-full rounded-xl bg-tm-red py-3.5 text-xs font-bold text-white shadow-md transition-colors hover:bg-tm-red-hover disabled:opacity-50"
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
                  {/* Shared mobile input (PR82). */}
                  <MobileNumberInput
                    id="mobile"
                    required
                    value={mobile}
                    onChange={setMobile}
                    className={inputClass}
                  />
                </div>
                <button
                  type="submit"
                  disabled={busy}
                  className="min-h-[44px] w-full rounded-xl bg-tm-red py-3.5 text-xs font-bold text-white shadow-md transition-colors hover:bg-tm-red-hover disabled:opacity-50"
                >
                  {busy ? 'Sending…' : 'Send code'}
                </button>
              </form>
            ) : (
              <div className="space-y-4">
                <p className="rounded-xl border border-gray-200 bg-tm-bg p-3 text-xs leading-relaxed text-gray-600">
                  If that number has an account, a code is on its way. Enter it below with your new
                  password.
                </p>

                {/* Shared code entry (PR82); the reset's failure is shown by the
                    card's own top error block, so no error props here. The new
                    password sits inside the same form via children. */}
                <OtpCodeEntry
                  code={code}
                  onChange={setCode}
                  onVerify={() => void confirmReset()}
                  busy={busy}
                  busyLabel="Setting…"
                  verifyLabel="Set new password"
                  onDifferentNumber={() => {
                    setCodeRequested(false)
                    setCode('')
                    setError(''); setErrorUr(null); setErrorRef(null)
                  }}
                >
                  <div className="space-y-1">
                    <label htmlFor="newPassword" className="text-xs font-bold text-tm-navy">
                      New password
                    </label>
                    <PasswordInput
                      id="newPassword"
                      required
                      minLength={8}
                      autoComplete="new-password"
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      placeholder="At least 8 characters"
                      className={inputClass}
                    />
                  </div>
                </OtpCodeEntry>
              </div>
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
      </div>
    </main>
  )
}
