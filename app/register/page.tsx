'use client'

import { useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'

// The single registration page. /tutor/register and /parent/signup are server
// redirects here.
//
// Schools and academies register as ordinary parent accounts -- no separate
// label anywhere, per the final parent model.
//
// The profiles row (and tutor_profiles row for tutors) is NOT written here.
// With "Confirm email" ON, signUp returns no session and a client-side insert
// would be refused by RLS. role and full_name travel in the signUp metadata
// and the on_auth_user_created trigger creates the rows. See
// supabase/migrations/14_handle_new_user.sql.
//
// NOTE: "Confirm email" is currently OFF on this Supabase project, so signUp
// returns a live session. This page handles both settings -- see the
// data.session branch below -- so turning it on needs no code change.

type Role = 'tutor' | 'parent'

// Two choices, and the word "school" appears on neither. Schools and academies
// register as parents -- the account is identical -- and saying so on the signup
// form makes somebody stop and wonder which one they are. The FAQ is where that
// question gets answered, not a form somebody is trying to finish.
const ROLES: { value: Role; label: string }[] = [
  { value: 'tutor', label: 'Tutor' },
  { value: 'parent', label: 'Parent' },
]

export default function RegisterPage() {
  const [role, setRole] = useState<Role>('parent')
  const [fullName, setFullName] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [acceptedTerms, setAcceptedTerms] = useState(false)
  const [loading, setLoading] = useState(false)
  const [errorMsg, setErrorMsg] = useState('')
  const [sent, setSent] = useState(false)
  const [resendMsg, setResendMsg] = useState('')

  const router = useRouter()
  const supabase = createClient()

  const handleRegister = async (e: React.FormEvent) => {
    e.preventDefault()
    setLoading(true)
    setErrorMsg('')

    const destination = role === 'tutor' ? '/tutor/complete-profile' : '/parent/dashboard'

    const { data, error } = await supabase.auth.signUp({
      email,
      password,
      options: {
        // Read by the on_auth_user_created trigger. 'admin' is rejected there.
        // City -- and every other detail -- is collected during profile
        // completion. Asking here lengthens the one form standing between
        // somebody and an account, to fill a column the completion flow asks
        // for again anyway.
        data: { role, full_name: fullName },
        emailRedirectTo: `${window.location.origin}/api/auth/callback?next=${encodeURIComponent(
          destination,
        )}`,
      },
    })

    if (error) {
      setErrorMsg(
        error.message.toLowerCase().includes('already registered')
          ? 'An account with this email already exists. Try signing in instead.'
          : error.message,
      )
      setLoading(false)
      return
    }

    // Works under either Supabase setting. With "Confirm email" ON there is no
    // session yet, so show the check-your-inbox screen; the link comes back
    // through /api/auth/callback. With it OFF the user is already signed in,
    // so sending them to an inbox they need not check would strand them.
    if (data.session) {
      router.push(destination)
      router.refresh()
      return
    }

    setSent(true)
    setLoading(false)
  }

  const handleResend = async () => {
    setResendMsg('')
    const { error } = await supabase.auth.resend({ type: 'signup', email })
    setResendMsg(error ? `Could not resend: ${error.message}` : 'Sent again — check your inbox.')
  }

  if (sent) {
    return (
      <main className="min-h-screen bg-tm-bg flex items-center justify-center p-4 sm:p-6 text-slate-700">
        <div className="w-full max-w-md bg-white p-6 sm:p-8 rounded-3xl shadow-xl border border-gray-200 space-y-5 text-center">
          <span className="text-3xl p-3 bg-tm-tint-green rounded-2xl inline-block">📬</span>
          <h1 className="text-xl font-black text-tm-navy">Check your inbox</h1>
          <p className="text-xs text-gray-600 leading-relaxed">
            We sent a confirmation link to <span className="font-bold text-tm-navy">{email}</span>.
            Click it to activate your account and finish signing up.
          </p>
          {resendMsg && (
            <p className="text-xs font-bold text-tm-green-deep bg-tm-tint-green border border-tm-green-deep/30 rounded-xl p-3">
              {resendMsg}
            </p>
          )}
          <button
            onClick={handleResend}
            className="w-full min-h-[44px] py-3 bg-tm-black hover:bg-tm-green-deep text-white font-bold text-xs uppercase tracking-wider rounded-xl transition-colors"
          >
            Resend confirmation email
          </button>
          <Link href="/login" className="block text-xs font-bold text-gray-500 hover:text-tm-navy">
            ← Back to sign in
          </Link>
        </div>
      </main>
    )
  }

  return (
    <main className="min-h-screen bg-tm-bg flex items-center justify-center p-4 sm:p-6 text-slate-700">
      <div className="w-full max-w-md bg-white p-6 sm:p-8 rounded-3xl shadow-xl border border-gray-200 space-y-6">
        <div className="text-center space-y-2">
          <Link href="/" className="inline-flex min-h-[44px] items-center justify-center text-xl font-black text-tm-navy">
            Tutor<span className="text-tm-red">Mint</span>
          </Link>
          <h1 className="text-xl font-black text-tm-navy">Create your account</h1>
          <p className="text-xs text-gray-500">Free to join. Browsing is always free.</p>
        </div>

        {errorMsg && (
          <div className="p-3 bg-tm-tint-red border border-tm-red/30 text-tm-red text-xs font-bold rounded-xl text-center">
            {errorMsg}
          </div>
        )}

        <form onSubmit={handleRegister} className="space-y-4">
          {/*
            Radio inputs rather than buttons carrying aria-pressed. A radio
            group is exactly what this is, so arrow keys move between the two
            options and a screen reader announces "1 of 2" without any of it
            being simulated.
          */}
          <fieldset>
            <legend className="mb-2 text-xs font-bold text-tm-navy">I am a…</legend>
            <div className="grid grid-cols-2 gap-2">
              {ROLES.map((r) => (
                <label
                  key={r.value}
                  className={`flex min-h-[44px] cursor-pointer items-center gap-2 rounded-xl border-2 p-3 transition-all ${
                    role === r.value
                      ? 'border-tm-red bg-tm-tint-red'
                      : 'border-gray-200 bg-tm-bg hover:border-gray-300'
                  }`}
                >
                  <input
                    type="radio"
                    name="role"
                    value={r.value}
                    checked={role === r.value}
                    onChange={() => setRole(r.value)}
                    className="h-4 w-4 shrink-0 accent-tm-red"
                  />
                  <span className="text-xs font-black text-tm-navy">{r.label}</span>
                </label>
              ))}
            </div>
          </fieldset>

          <div className="space-y-1">
            <label htmlFor="fullName" className="text-xs font-bold text-tm-navy">
              Full Name
            </label>
            <input
              id="fullName"
              required
              value={fullName}
              onChange={(e) => setFullName(e.target.value)}
              placeholder="Your name"
              className="w-full min-h-[44px] p-3 bg-tm-bg border border-gray-200 rounded-xl text-sm outline-none focus:border-tm-navy focus:bg-white"
            />
          </div>

          <div className="space-y-1">
            <label htmlFor="email" className="text-xs font-bold text-tm-navy">
              Email Address
            </label>
            <input
              id="email"
              type="email"
              required
              autoComplete="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="name@example.com"
              className="w-full min-h-[44px] p-3 bg-tm-bg border border-gray-200 rounded-xl text-sm outline-none focus:border-tm-navy focus:bg-white"
            />
          </div>

          <div className="space-y-1">
            <label htmlFor="password" className="text-xs font-bold text-tm-navy">
              Password
            </label>
            <input
              id="password"
              type="password"
              required
              minLength={8}
              autoComplete="new-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="At least 8 characters"
              className="w-full min-h-[44px] p-3 bg-tm-bg border border-gray-200 rounded-xl text-sm outline-none focus:border-tm-navy focus:bg-white"
            />
          </div>

          {/*
            Terms, with the photo-use consent spelled out rather than left to a
            link nobody opens. TutorMint puts tutor photographs in promotional
            posts; consenting to that by implication, through a "terms" link, is
            not consent anybody would recognise as having given. One tick still
            covers both -- the clause IS in the terms -- but the sentence is on
            the screen where the decision is made.
          */}
          <label className="flex min-h-[44px] cursor-pointer items-start gap-3 rounded-xl border border-gray-200 bg-tm-bg p-3">
            <input
              type="checkbox"
              required
              checked={acceptedTerms}
              onChange={(e) => setAcceptedTerms(e.target.checked)}
              className="mt-0.5 h-5 w-5 shrink-0"
            />
            <span className="text-[11px] leading-relaxed text-slate-700">
              I accept the{' '}
              <Link href="/terms" className="font-bold text-tm-red underline">
                Terms of Service
              </Link>{' '}
              and{' '}
              <Link href="/privacy" className="font-bold text-tm-red underline">
                Privacy Policy
              </Link>
              {role === 'tutor' ? (
                <>
                  , and I agree that TutorMint may use my profile photo and public profile details
                  to promote the platform. This never includes my phone number, CNIC or address, and
                  I can withdraw it at any time.
                </>
              ) : (
                '.'
              )}
            </span>
          </label>

          <button
            type="submit"
            disabled={loading || !acceptedTerms}
            className="w-full min-h-[44px] py-3.5 bg-tm-red hover:bg-tm-red-hover text-white font-bold text-xs uppercase tracking-wider rounded-xl shadow-md transition-all disabled:opacity-50"
          >
            {loading ? 'Creating account…' : 'Create Account'}
          </button>
        </form>

        <p className="text-center text-xs text-gray-500">
          Already have an account?{' '}
          <Link href="/login" className="text-tm-red font-bold hover:underline">
            Sign in
          </Link>
        </p>
      </div>
    </main>
  )
}
