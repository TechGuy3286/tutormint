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
import { useToast } from '@/components/ui/Toast'
import { armEscape, submitJson } from '@/lib/submit'
import { GENERIC_ERROR, supportWhatsappHref } from '@/lib/errorMessages'
import { SUPPORT_WHATSAPP_DISPLAY } from '@/lib/supportContacts'

// Password reset, two ways in.
//
// MOBILE (the default) — three screens (owner hotfix, 5 Oct 2026):
//   1. Mobile number → Send code
//   2. "Enter the code sent to your mobile" — the same code boxes as signup
//   3. New password + Confirm password → Save password
// After saving, /api/auth/reset signs the member in, signs out every other
// session, and this form lands them on their dashboard with "Password changed".
//
// EMAIL. For members who gave an address. The reset link lands on
// /api/auth/callback, which exchanges the code for a session and forwards to
// /account/password. Both options are always offered: the form cannot know
// which channels an account has without first being told who they are.
//
// NEITHER PATH SAYS WHETHER THE ACCOUNT EXISTS. Screen 2 appears for every
// number (a non-member number gets no SMS and a decoy code on the server), and
// every error — wrong code, expired, too many tries, daily limit — reads the
// same for a member and a stranger. The email path never surfaces its error.

type Mode = 'mobile' | 'email'
type Screen = 'number' | 'code' | 'password'

type Failure = { errorUr?: string; ref?: string; locked?: boolean; expired?: boolean; dailyLimit?: boolean; supportHref?: string }

export default function ForgotPasswordForm() {
  const router = useRouter()
  const toast = useToast()

  const [mode, setMode] = useState<Mode>('mobile')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [errorUr, setErrorUr] = useState<string | null>(null)
  const [errorRef, setErrorRef] = useState<string | null>(null)
  const [supportHref, setSupportHref] = useState<string | null>(null)

  const clearError = () => {
    setError('')
    setErrorUr(null)
    setErrorRef(null)
    setSupportHref(null)
  }

  // Show a failure with its Urdu line, the reference code (transport failures)
  // and, for the daily limit, the support WhatsApp link.
  function showFailure(failed: string | null | undefined, data: Failure | null, fallback: string) {
    setError(failed ?? fallback)
    setErrorUr(data?.errorUr ?? (data?.ref ? GENERIC_ERROR.ur : null))
    setErrorRef(data?.ref ?? null)
    setSupportHref(data?.supportHref ?? null)
  }

  // email path
  const [email, setEmail] = useState('')
  const [emailSent, setEmailSent] = useState(false)

  // mobile path
  const [screen, setScreen] = useState<Screen>('number')
  const [mobile, setMobile] = useState('')
  const [code, setCode] = useState('')
  const [locked, setLocked] = useState(false)
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [fallbackLogin, setFallbackLogin] = useState(false)

  async function submitEmail(e: React.FormEvent) {
    e.preventDefault()
    setBusy(true)
    try {
      const supabase = createClient()
      await supabase.auth.resetPasswordForEmail(email.trim(), {
        redirectTo: `${window.location.origin}/api/auth/callback?next=${encodeURIComponent('/account/password')}`,
      })
    } catch {
      // Swallowed on purpose: a rate limit or an unknown address would both tell
      // the caller something about the address they typed.
    } finally {
      setEmailSent(true)
      setBusy(false)
    }
  }

  // Screen 1 → 2. The same next screen whether or not the number is a member's.
  async function requestCode(e: React.FormEvent) {
    e.preventDefault()
    setBusy(true)
    clearError()
    const { ok, data, error: failed } = await submitJson<Failure>('/api/auth/reset', { action: 'request', mobile })
    if (!ok) {
      showFailure(failed, data, 'Could not send a code right now.')
      setBusy(false)
      return
    }
    setCode('')
    setLocked(false)
    setScreen('code')
    setBusy(false)
  }

  // Screen 2 → 3. Checks the code without using it up.
  async function checkCode() {
    setBusy(true)
    clearError()
    const { ok, data, error: failed } = await submitJson<Failure>('/api/auth/reset', { action: 'check', mobile, code })
    if (!ok) {
      showFailure(failed, data, 'That code was not accepted.')
      if (data?.locked) setLocked(true)
      setBusy(false)
      return
    }
    setScreen('password')
    setBusy(false)
  }

  // Screen 3: save, then straight to the dashboard.
  async function savePassword(e: React.FormEvent) {
    e.preventDefault()
    clearError()
    if (password !== confirm) {
      setError('The two passwords do not match.')
      setErrorUr('دونوں پاس ورڈ ایک جیسے نہیں ہیں۔')
      return
    }
    setBusy(true)
    const { ok, data, error: failed } = await submitJson<Failure & { signedIn?: boolean; next?: string }>(
      '/api/auth/reset',
      { action: 'confirm', mobile, code, password },
    )
    if (!ok) {
      showFailure(failed, data, 'Could not save the new password.')
      // A dead code sends them back to request a new one.
      if (data?.expired || data?.locked) {
        setScreen('number')
        setCode('')
      }
      setBusy(false)
      return
    }
    if (data?.signedIn && data.next) {
      toast.success('Password changed')
      armEscape(() => {
        setBusy(false)
        setFallbackLogin(true)
      })
      router.push(data.next)
      router.refresh()
      return
    }
    // The password is saved but no session could be minted: sign in with it.
    toast.success('Password changed')
    setFallbackLogin(true)
    setBusy(false)
  }

  const inputClass =
    'min-h-[44px] w-full rounded-xl border border-gray-200 bg-tm-bg p-3 text-sm outline-none focus:border-tm-navy focus:bg-white'

  const errorBlock = error ? (
    <div
      role="alert"
      className="space-y-2 rounded-xl border border-tm-red/30 bg-tm-tint-red p-3 text-center text-xs font-bold text-tm-red"
    >
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
      {supportHref && (
        <a
          href={supportHref}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex min-h-[44px] w-full items-center justify-center rounded-xl bg-tm-black px-4 text-xs font-bold text-white hover:bg-tm-navy"
        >
          Contact support · {SUPPORT_WHATSAPP_DISPLAY}
        </a>
      )}
    </div>
  ) : null

  const supportExtra = supportHref ? (
    <a
      href={supportHref}
      target="_blank"
      rel="noopener noreferrer"
      className="inline-flex min-h-[44px] w-full items-center justify-center rounded-xl bg-tm-black px-4 text-xs font-bold text-white hover:bg-tm-navy"
    >
      Contact support · {SUPPORT_WHATSAPP_DISPLAY}
    </a>
  ) : null

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
            <h1 className="text-xl font-black text-tm-navy">
              {mode === 'mobile' && screen === 'code'
                ? 'Enter the code sent to your mobile'
                : mode === 'mobile' && screen === 'password'
                  ? 'Choose a new password'
                  : 'Reset your password'}
            </h1>
          </div>

          {fallbackLogin ? (
            <div className="space-y-4">
              <p className="rounded-xl border border-tm-green-deep/30 bg-tm-tint-green p-4 text-xs leading-relaxed text-tm-green-deep">
                Your password has been changed. Sign in with it now.
              </p>
              <Link
                href="/login"
                className="flex min-h-[44px] w-full items-center justify-center rounded-xl bg-tm-red px-4 text-xs font-bold text-white hover:bg-tm-red-hover"
              >
                Go to sign in
              </Link>
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
              {/* Both options, always: by mobile (the default) and by email. */}
              {!(mode === 'mobile' && screen !== 'number') && (
                <div className="grid grid-cols-2 gap-2" role="tablist" aria-label="Reset method">
                  {(['mobile', 'email'] as Mode[]).map((m) => (
                    <button
                      key={m}
                      type="button"
                      role="tab"
                      aria-selected={mode === m}
                      onClick={() => {
                        setMode(m)
                        clearError()
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
              )}

              {mode === 'email' ? (
                <form onSubmit={submitEmail} className="space-y-4">
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
              ) : screen === 'number' ? (
                <form onSubmit={requestCode} className="space-y-4">
                  {errorBlock}
                  <div className="space-y-1">
                    <label htmlFor="mobile" className="text-xs font-bold text-tm-navy">
                      Mobile number
                    </label>
                    <MobileNumberInput id="mobile" required value={mobile} onChange={setMobile} className={inputClass} />
                  </div>
                  <button
                    type="submit"
                    disabled={busy}
                    className="min-h-[44px] w-full rounded-xl bg-tm-red py-3.5 text-xs font-bold text-white shadow-md transition-colors hover:bg-tm-red-hover disabled:opacity-50"
                  >
                    {busy ? 'Sending…' : 'Send code'}
                  </button>
                </form>
              ) : screen === 'code' ? (
                // The same tap-friendly code boxes as signup (OtpCodeEntry).
                <OtpCodeEntry
                  code={code}
                  onChange={setCode}
                  onVerify={() => void checkCode()}
                  busy={busy}
                  locked={locked}
                  busyLabel="Checking…"
                  verifyLabel="Continue"
                  error={error || null}
                  errorUr={errorUr}
                  errorRef={errorRef}
                  errorExtra={
                    supportExtra ?? (
                      (locked || error) && (
                        <button
                          type="button"
                          onClick={() => {
                            setScreen('number')
                            setCode('')
                            setLocked(false)
                            clearError()
                          }}
                          className="inline-flex min-h-[44px] w-full items-center justify-center rounded-xl bg-tm-black px-4 text-xs font-bold text-white hover:bg-tm-navy"
                        >
                          Request a new code
                        </button>
                      )
                    )
                  }
                  onDifferentNumber={() => {
                    setScreen('number')
                    setCode('')
                    setLocked(false)
                    clearError()
                  }}
                />
              ) : (
                <form onSubmit={savePassword} className="space-y-4">
                  {errorBlock}
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
                  <div className="space-y-1">
                    <label htmlFor="confirmPassword" className="text-xs font-bold text-tm-navy">
                      Confirm password
                    </label>
                    <PasswordInput
                      id="confirmPassword"
                      required
                      minLength={8}
                      autoComplete="new-password"
                      value={confirm}
                      onChange={(e) => setConfirm(e.target.value)}
                      placeholder="Type it again"
                      className={inputClass}
                    />
                  </div>
                  <button
                    type="submit"
                    disabled={busy}
                    className="min-h-[44px] w-full rounded-xl bg-tm-red py-3.5 text-xs font-bold text-white shadow-md transition-colors hover:bg-tm-red-hover disabled:opacity-50"
                  >
                    {busy ? 'Saving…' : 'Save password'}
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
      </div>
    </main>
  )
}
