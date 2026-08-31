'use client'

import { Suspense, useState } from 'react'
import Link from 'next/link'
import { useRouter, useSearchParams } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'

// The single sign-in page. /parent/login and /tutor/login are server redirects
// here. After sign-in we read profiles.role exactly once and route on it --
// no probing several tables to guess who this is.

type Role = 'tutor' | 'parent' | 'academy' | 'admin'

function homeForRole(role: Role | null): string {
  if (role === 'admin') return '/admin/dashboard'
  if (role === 'tutor') return '/tutor/dashboard'
  return '/parent/dashboard'
}

/** Only honour ?next= when it is same-origin and matches the user's own area. */
function nextForRole(next: string | null, role: Role | null): string | null {
  if (!next || !next.startsWith('/') || next.startsWith('//')) return null
  const area = next.startsWith('/tutor')
    ? 'tutor'
    : next.startsWith('/parent')
      ? 'parent'
      : next.startsWith('/admin')
        ? 'admin'
        : null
  if (area === null) return next
  if (area === 'admin') return role === 'admin' ? next : null
  if (area === 'parent') return role === 'parent' || role === 'academy' ? next : null
  return area === role ? next : null
}

function LoginForm() {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [loading, setLoading] = useState(false)
  const [errorMsg, setErrorMsg] = useState('')
  const [needsConfirm, setNeedsConfirm] = useState(false)
  const [resendMsg, setResendMsg] = useState('')

  const router = useRouter()
  const searchParams = useSearchParams()
  const supabase = createClient()

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault()
    setLoading(true)
    setErrorMsg('')
    setResendMsg('')
    setNeedsConfirm(false)

    const { data, error } = await supabase.auth.signInWithPassword({ email, password })

    if (error) {
      const msg = error.message.toLowerCase()
      if (msg.includes('not confirmed') || msg.includes('confirm')) {
        setNeedsConfirm(true)
        setErrorMsg('Your email address has not been confirmed yet.')
      } else if (msg.includes('invalid login credentials')) {
        setErrorMsg('That email and password combination is not right. Please try again.')
      } else {
        setErrorMsg(error.message)
      }
      setLoading(false)
      return
    }

    // One role read, then route on it.
    const { data: profile } = await supabase
      .from('profiles')
      .select('role')
      .eq('id', data.user!.id)
      .maybeSingle()

    const role = (profile?.role as Role | undefined) ?? null
    const target = nextForRole(searchParams.get('next'), role) ?? homeForRole(role)

    router.push(target)
    router.refresh()
  }

  const handleResend = async () => {
    setResendMsg('')
    const { error } = await supabase.auth.resend({ type: 'signup', email })
    setResendMsg(
      error ? `Could not resend: ${error.message}` : 'Confirmation email sent — check your inbox.',
    )
  }

  return (
    <main className="min-h-screen bg-[#F8FAFC] flex items-center justify-center p-4 sm:p-6 text-[#334155]">
      <div className="w-full max-w-md bg-white p-6 sm:p-8 rounded-3xl shadow-xl border border-gray-200 space-y-6">
        <div className="text-center space-y-2">
          <Link href="/" className="text-xl font-black text-[#0F172A] inline-block">
            Tutor<span className="text-[#d60008]">Mint</span>
          </Link>
          <h1 className="text-xl font-black text-[#0F172A]">Sign In to Your Account</h1>
          <p className="text-xs text-gray-500">Tutors, parents and schools all sign in here.</p>
        </div>

        {errorMsg && (
          <div className="p-3 bg-red-50 border border-red-200 text-[#d60008] text-xs font-bold rounded-xl text-center space-y-2">
            <p>{errorMsg}</p>
            {needsConfirm && (
              <button
                type="button"
                onClick={handleResend}
                className="w-full min-h-[44px] px-4 py-2 bg-[#0F172A] hover:bg-[#059669] text-white rounded-xl text-xs font-bold transition-colors"
              >
                Resend confirmation email
              </button>
            )}
          </div>
        )}

        {resendMsg && (
          <div className="p-3 bg-emerald-50 border border-emerald-200 text-[#059669] text-xs font-bold rounded-xl text-center">
            {resendMsg}
          </div>
        )}

        <form onSubmit={handleLogin} className="space-y-4">
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
              autoComplete="current-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="••••••••"
              className="w-full min-h-[44px] p-3 bg-[#F8FAFC] border border-gray-200 rounded-xl text-sm outline-none focus:border-[#0F172A] focus:bg-white"
            />
          </div>

          <button
            type="submit"
            disabled={loading}
            className="w-full min-h-[44px] py-3.5 bg-[#d60008] hover:bg-red-700 text-white font-bold text-xs uppercase tracking-wider rounded-xl shadow-md transition-all disabled:opacity-50"
          >
            {loading ? 'Signing In…' : 'Sign In'}
          </button>
        </form>

        <p className="text-center text-xs text-gray-500">
          New to TutorMint?{' '}
          <Link href="/register" className="text-[#d60008] font-bold hover:underline">
            Create an account
          </Link>
        </p>
      </div>
    </main>
  )
}

export default function LoginPage() {
  return (
    <Suspense
      fallback={
        <div className="min-h-screen flex items-center justify-center text-xs font-bold text-gray-500">
          Loading…
        </div>
      }
    >
      <LoginForm />
    </Suspense>
  )
}
