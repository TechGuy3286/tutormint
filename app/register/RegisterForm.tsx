'use client'

import { useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'

// The single registration page. /tutor/register and /parent/signup are server
// redirects here.
//
// MOBILE-FIRST. The mobile number is the required identifier and email is
// optional, because in Pakistan a great many members have a number they use
// daily and an address they do not. An account with no email signs in with the
// number, through the synthetic address the bulk import already uses.
//
// The account is NOT created in the browser. /api/auth/register does it,
// because deriving the synthetic address, checking for a duplicate number
// across all profiles, and creating the user with the email pre-confirmed all
// need the service role. It signs the member in and sends the first code, and
// this page then hands them to /verify-phone.
//
// Schools and academies register as ordinary parent accounts. The radio says
// "Parent / Institution" so an academy owner recognises themselves, and that
// is the only place the word appears: the account, its rights and its plans
// are identical to any other parent's.

type Role = 'tutor' | 'parent'

const ROLES: { value: Role; label: string; helper?: string }[] = [
  { value: 'tutor', label: 'Tutor' },
  {
    value: 'parent',
    label: 'Parent / Institution',
    helper: 'Parents, schools and academies looking for tutors.',
  },
]

export default function RegisterForm({ next }: { next?: string }) {
  const [role, setRole] = useState<Role>('parent')
  const [fullName, setFullName] = useState('')
  const [mobile, setMobile] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [acceptedTerms, setAcceptedTerms] = useState(false)
  const [loading, setLoading] = useState(false)
  const [errorMsg, setErrorMsg] = useState('')
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({})

  const router = useRouter()

  const handleRegister = async (e: React.FormEvent) => {
    e.preventDefault()
    setLoading(true)
    setErrorMsg('')
    setFieldErrors({})

    const res = await fetch('/api/auth/register', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        role,
        fullName,
        mobile,
        email: email.trim() || undefined,
        password,
        acceptedTerms,
      }),
    })

    const data = await res.json().catch(() => ({}))

    if (!res.ok) {
      setErrorMsg(data.error ?? 'Could not create your account.')
      setFieldErrors(data.fields ?? {})
      setLoading(false)
      return
    }

    // Straight to the gate. A member who was mid-action when they were asked
    // to sign up keeps their destination: /verify-phone hands it back once the
    // number is proved, so they land on the thing they were doing.
    const target = data.next === '/verify-phone' && next
      ? `/verify-phone?next=${encodeURIComponent(next)}`
      : (data.next ?? '/verify-phone')

    router.refresh()
    router.push(target)
  }

  const fieldClass = (name: string) =>
    `w-full min-h-[44px] p-3 bg-tm-bg border rounded-xl text-sm outline-none focus:bg-white ${
      fieldErrors[name] ? 'border-tm-red' : 'border-gray-200 focus:border-tm-navy'
    }`

  return (
    <main className="min-h-screen bg-tm-bg flex items-center justify-center p-4 sm:p-6 text-slate-700">
      <div className="w-full max-w-md bg-white p-6 sm:p-8 rounded-3xl shadow-xl border border-gray-200 space-y-6">
        <div className="text-center space-y-2">
          <Link
            href="/"
            className="inline-flex min-h-[44px] items-center justify-center text-xl font-black text-tm-navy"
          >
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

        <form onSubmit={handleRegister} className="space-y-4" noValidate>
          {/*
            Radio inputs rather than buttons carrying aria-pressed. A radio
            group is exactly what this is, so arrow keys move between the two
            options and a screen reader announces "1 of 2" without any of it
            being simulated.
          */}
          <fieldset>
            <legend className="mb-2 text-xs font-bold text-tm-navy">I am a…</legend>
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
              {ROLES.map((r) => (
                <label
                  key={r.value}
                  className={`flex min-h-[44px] cursor-pointer items-start gap-2 rounded-xl border-2 p-3 transition-all ${
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
                    className="mt-0.5 h-4 w-4 shrink-0 accent-tm-red"
                  />
                  <span>
                    <span className="block text-xs font-black text-tm-navy">{r.label}</span>
                    {r.helper && (
                      <span className="mt-0.5 block text-[11px] leading-snug text-gray-500">
                        {r.helper}
                      </span>
                    )}
                  </span>
                </label>
              ))}
            </div>
          </fieldset>

          <div className="space-y-1">
            <label htmlFor="fullName" className="text-xs font-bold text-tm-navy">
              Full name
            </label>
            <input
              id="fullName"
              required
              value={fullName}
              onChange={(e) => setFullName(e.target.value)}
              placeholder="Your name"
              autoComplete="name"
              className={fieldClass('fullName')}
            />
            {fieldErrors.fullName && (
              <p className="text-[11px] font-bold text-tm-red">{fieldErrors.fullName}</p>
            )}
          </div>

          <div className="space-y-1">
            <label htmlFor="mobile" className="text-xs font-bold text-tm-navy">
              Mobile number
            </label>
            <input
              id="mobile"
              required
              value={mobile}
              onChange={(e) => setMobile(e.target.value)}
              inputMode="tel"
              autoComplete="tel"
              placeholder="0300 1234567"
              className={fieldClass('mobile')}
            />
            <p className="text-[11px] text-gray-500">
              We send a code to confirm it. This is also how you sign in.
            </p>
            {fieldErrors.mobile && (
              <p className="text-[11px] font-bold text-tm-red">{fieldErrors.mobile}</p>
            )}
          </div>

          <div className="space-y-1">
            <label htmlFor="email" className="text-xs font-bold text-tm-navy">
              Email address <span className="font-normal text-gray-400">(optional)</span>
            </label>
            <input
              id="email"
              type="email"
              autoComplete="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="name@example.com"
              className={fieldClass('email')}
            />
            <p className="text-[11px] text-gray-500">For receipts and reminders.</p>
            {fieldErrors.email && (
              <p className="text-[11px] font-bold text-tm-red">{fieldErrors.email}</p>
            )}
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
              className={fieldClass('password')}
            />
            {fieldErrors.password && (
              <p className="text-[11px] font-bold text-tm-red">{fieldErrors.password}</p>
            )}
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
              className="mt-0.5 h-5 w-5 shrink-0 accent-tm-red"
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

