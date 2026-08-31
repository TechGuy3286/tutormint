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
// would be refused by RLS. role/full_name/city travel in the signUp metadata
// and the on_auth_user_created trigger creates the rows. See
// supabase/migrations/14_handle_new_user.sql.
//
// NOTE: "Confirm email" is currently OFF on this Supabase project, so signUp
// returns a live session. This page handles both settings -- see the
// data.session branch below -- so turning it on needs no code change.

type Role = 'tutor' | 'parent'

const ROLES: { value: Role; label: string; blurb: string }[] = [
  { value: 'tutor', label: 'Tutor', blurb: 'Teach students and apply to tuition jobs' },
  { value: 'parent', label: 'Parent, School or Academy', blurb: 'Find and hire verified tutors' },
]

export default function RegisterPage() {
  const [role, setRole] = useState<Role>('parent')
  const [fullName, setFullName] = useState('')
  const [city, setCity] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
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
        data: { role, full_name: fullName, city },
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
      <main className="min-h-screen bg-[#F8FAFC] flex items-center justify-center p-4 sm:p-6 text-[#334155]">
        <div className="w-full max-w-md bg-white p-6 sm:p-8 rounded-3xl shadow-xl border border-gray-200 space-y-5 text-center">
          <span className="text-3xl p-3 bg-emerald-50 rounded-2xl inline-block">📬</span>
          <h1 className="text-xl font-black text-[#0F172A]">Check your inbox</h1>
          <p className="text-xs text-gray-600 leading-relaxed">
            We sent a confirmation link to <span className="font-bold text-[#0F172A]">{email}</span>.
            Click it to activate your account and finish signing up.
          </p>
          {resendMsg && (
            <p className="text-xs font-bold text-[#059669] bg-emerald-50 border border-emerald-200 rounded-xl p-3">
              {resendMsg}
            </p>
          )}
          <button
            onClick={handleResend}
            className="w-full min-h-[44px] py-3 bg-[#0F172A] hover:bg-[#059669] text-white font-bold text-xs uppercase tracking-wider rounded-xl transition-colors"
          >
            Resend confirmation email
          </button>
          <Link href="/login" className="block text-xs font-bold text-gray-500 hover:text-[#0F172A]">
            ← Back to sign in
          </Link>
        </div>
      </main>
    )
  }

  return (
    <main className="min-h-screen bg-[#F8FAFC] flex items-center justify-center p-4 sm:p-6 text-[#334155]">
      <div className="w-full max-w-md bg-white p-6 sm:p-8 rounded-3xl shadow-xl border border-gray-200 space-y-6">
        <div className="text-center space-y-2">
          <Link href="/" className="text-xl font-black text-[#0F172A] inline-block">
            Tutor<span className="text-[#d60008]">Mint</span>
          </Link>
          <h1 className="text-xl font-black text-[#0F172A]">Create your account</h1>
          <p className="text-xs text-gray-500">Free to join. Browsing is always free.</p>
        </div>

        {errorMsg && (
          <div className="p-3 bg-red-50 border border-red-200 text-[#d60008] text-xs font-bold rounded-xl text-center">
            {errorMsg}
          </div>
        )}

        <form onSubmit={handleRegister} className="space-y-4">
          <fieldset className="space-y-2">
            <legend className="text-xs font-bold text-[#0F172A] mb-2">I am a…</legend>
            <div className="grid grid-cols-1 gap-2">
              {ROLES.map((r) => (
                <button
                  key={r.value}
                  type="button"
                  onClick={() => setRole(r.value)}
                  aria-pressed={role === r.value}
                  className={`min-h-[44px] text-left p-3 rounded-xl border-2 transition-all ${
                    role === r.value
                      ? 'border-[#d60008] bg-red-50'
                      : 'border-gray-200 bg-[#F8FAFC] hover:border-gray-300'
                  }`}
                >
                  <span className="block text-xs font-black text-[#0F172A]">{r.label}</span>
                  <span className="block text-[11px] text-gray-500">{r.blurb}</span>
                </button>
              ))}
            </div>
          </fieldset>

          <div className="space-y-1">
            <label htmlFor="fullName" className="text-xs font-bold text-[#0F172A]">
              Full Name
            </label>
            <input
              id="fullName"
              required
              value={fullName}
              onChange={(e) => setFullName(e.target.value)}
              placeholder="Your name"
              className="w-full min-h-[44px] p-3 bg-[#F8FAFC] border border-gray-200 rounded-xl text-sm outline-none focus:border-[#0F172A] focus:bg-white"
            />
          </div>

          <div className="space-y-1">
            <label htmlFor="city" className="text-xs font-bold text-[#0F172A]">
              City
            </label>
            <input
              id="city"
              value={city}
              onChange={(e) => setCity(e.target.value)}
              placeholder="Lahore"
              className="w-full min-h-[44px] p-3 bg-[#F8FAFC] border border-gray-200 rounded-xl text-sm outline-none focus:border-[#0F172A] focus:bg-white"
            />
          </div>

          <div className="space-y-1">
            <label htmlFor="email" className="text-xs font-bold text-[#0F172A]">
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
              className="w-full min-h-[44px] p-3 bg-[#F8FAFC] border border-gray-200 rounded-xl text-sm outline-none focus:border-[#0F172A] focus:bg-white"
            />
          </div>

          <div className="space-y-1">
            <label htmlFor="password" className="text-xs font-bold text-[#0F172A]">
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
              className="w-full min-h-[44px] p-3 bg-[#F8FAFC] border border-gray-200 rounded-xl text-sm outline-none focus:border-[#0F172A] focus:bg-white"
            />
          </div>

          <button
            type="submit"
            disabled={loading}
            className="w-full min-h-[44px] py-3.5 bg-[#d60008] hover:bg-red-700 text-white font-bold text-xs uppercase tracking-wider rounded-xl shadow-md transition-all disabled:opacity-50"
          >
            {loading ? 'Creating account…' : 'Create Account'}
          </button>
        </form>

        <p className="text-center text-xs text-gray-500">
          Already have an account?{' '}
          <Link href="/login" className="text-[#d60008] font-bold hover:underline">
            Sign in
          </Link>
        </p>
      </div>
    </main>
  )
}
