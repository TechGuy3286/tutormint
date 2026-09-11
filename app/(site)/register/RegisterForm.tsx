'use client'

import Breadcrumbs from '@/components/Breadcrumbs'
import { useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { armEscape, STUCK_MESSAGE, submitJson } from '@/lib/submit'
import SubmitEscape from '@/components/SubmitEscape'
import PasswordInput from '@/components/ui/PasswordInput'

// The single registration page. /tutor/register is a server redirect here,
// kept because tutor referral links (?ref=) carry that path.
//
// ONE IDENTIFIER FIELD (owner, Sunday 6 Sep). "Mobile number or email": digits
// take the mobile path (an OTP to confirm the number), an address takes the
// email path (a confirmation link). The form does not decide which — it sends
// the raw identifier and /api/auth/register branches on it — but the helper
// text under the field updates as they type so a member knows what will happen.
// The other of the two can be added later in settings.
//
// The account is NOT created in the browser. /api/auth/register does it,
// because deriving the synthetic address, checking for a duplicate across all
// profiles, and creating the user all need the service role. On the mobile path
// it signs the member in and sends the first code and this page hands them to
// /verify-phone; on the email path it creates an unconfirmed account and hands
// them to /verify-email.
//
// Schools and academies register as ordinary parent accounts. The radio says
// "Parent / Institution" so an academy owner recognises themselves, and that
// is the only place the word appears: the account, its rights and its plans
// are identical to any other parent's.

type Role = 'tutor' | 'parent'

// Cheap, client-only shape guess purely for the helper text — the real
// decision (and the real validation) is the server's. Anything with an "@" is
// treated as heading down the email path; anything that is only digits and
// phone punctuation is the mobile path.
function identifierShape(v: string): 'mobile' | 'email' | 'unknown' {
  const t = v.trim()
  if (!t) return 'unknown'
  if (t.includes('@')) return 'email'
  if (/^[\d+\-\s()]+$/.test(t)) return 'mobile'
  return 'unknown'
}

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
  const [identifier, setIdentifier] = useState('')
  const [password, setPassword] = useState('')
  const [acceptedTerms, setAcceptedTerms] = useState(false)
  const [loading, setLoading] = useState(false)
  const [errorMsg, setErrorMsg] = useState('')
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({})
  const [stuckHref, setStuckHref] = useState<string | null>(null)

  const router = useRouter()
  const shape = identifierShape(identifier)

  const handleRegister = async (e: React.FormEvent) => {
    e.preventDefault()
    setLoading(true)
    setErrorMsg('')
    setFieldErrors({})

    const { ok, data, error: failed } = await submitJson<{
      next?: string
      fields?: Record<string, string>
    }>('/api/auth/register', {
      role,
      fullName,
      identifier,
      password,
      acceptedTerms,
    })

    if (!ok) {
      setErrorMsg(failed ?? 'Could not create your account.')
      setFieldErrors(data?.fields ?? {})
      setLoading(false)
      return
    }

    // The server tells us where to go: /verify-phone for the mobile path (the
    // account is signed in and a code is on its way), /verify-email for the
    // email path (an unconfirmed account, a link on its way). Only the mobile
    // path carries `next` forward — the email path breaks the session until the
    // link is clicked, so there is nothing to hand back yet.
    const target = data?.next === '/verify-phone' && next
      ? `/verify-phone?next=${encodeURIComponent(next)}`
      : (data?.next ?? '/verify-phone')

    // The account exists at this point. If the navigation does not take, the
    // member must not be left watching a spinner on a form they have already
    // successfully submitted -- pressing it again would only tell them the
    // number is taken, by themselves.
    armEscape(() => {
      setLoading(false)
      setStuckHref(target)
      setErrorMsg(STUCK_MESSAGE)
    })
    router.refresh()
    router.push(target)
  }

  const fieldClass = (name: string) =>
    `w-full min-h-[44px] p-3 bg-tm-bg border rounded-xl text-sm outline-none focus:bg-white ${
      fieldErrors[name] ? 'border-tm-red' : 'border-gray-200 focus:border-tm-navy'
    }`

  return (
    <main className="flex min-h-screen flex-col bg-tm-bg p-4 text-slate-700 sm:p-6">
      <Breadcrumbs items={[{ label: 'Create an account' }]} />
      <div className="flex flex-1 items-center justify-center">
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
          <div
            role="alert"
            className="space-y-2 p-3 bg-tm-tint-red border border-tm-red/30 text-tm-red text-xs font-bold rounded-xl text-center"
          >
            <p>{errorMsg}</p>
            {stuckHref && <SubmitEscape href={stuckHref} />}
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
            <label htmlFor="identifier" className="text-xs font-bold text-tm-navy">
              Mobile number or email
            </label>
            <input
              id="identifier"
              required
              value={identifier}
              onChange={(e) => setIdentifier(e.target.value)}
              inputMode="text"
              autoComplete="username"
              placeholder="0300 1234567 or name@example.com"
              className={fieldClass('identifier')}
            />
            {/* Adaptive helper: it says what will happen with what they have
                typed so far, so the mobile-vs-email choice is never a surprise
                after they submit. Both paths are live (owner, Part 8): a mobile
                number gets its code by SMS; an email gets a confirmation
                link. */}
            <p className="text-[11px] text-gray-500">
              {shape === 'mobile'
                ? 'We’ll send a code by SMS to confirm your number. This is also how you sign in.'
                : shape === 'email'
                  ? 'We’ll email you a confirmation link. Open it to finish signing up.'
                  : 'Use a mobile number or an email — either works. A mobile number gets its code by SMS.'}
            </p>
            {fieldErrors.identifier && (
              <p className="text-[11px] font-bold text-tm-red">{fieldErrors.identifier}</p>
            )}
          </div>

          <div className="space-y-1">
            <label htmlFor="password" className="text-xs font-bold text-tm-navy">
              Password
            </label>
            <PasswordInput
              id="password"
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
            className="w-full min-h-[44px] py-3.5 bg-tm-red hover:bg-tm-red-hover text-white font-bold text-xs rounded-xl shadow-md transition-all disabled:opacity-50"
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
      </div>
    </main>
  )
}

