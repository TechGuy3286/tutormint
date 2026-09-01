'use client'

import { Suspense, useState } from 'react'
import Link from 'next/link'
import { useRouter, useSearchParams } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { homeForRole, nextForRole, type Role } from '@/lib/authRoutes'

// The single sign-in page. /parent/login and /tutor/login redirect here.
//
// Accepts an email address OR a Pakistani mobile number. Imported tutors were
// created from a spreadsheet with no email of their own and sign in with their
// number and a temporary password; everyone else uses the address they
// registered with. The mapping is done by /api/auth/login, on the server —
// resolving a number to an account needs a lookup a browser must not make, and
// keeping it server-side is also what lets every failure return the same
// message instead of confirming which numbers are registered.
//
// After sign-in there are three destinations and they are checked in order:
// a suspended account goes to the page that explains itself, a temporary
// password must be replaced before anything else, and otherwise the member
// goes to their own dashboard.

function LoginForm() {
  const [identifier, setIdentifier] = useState('')
  const [password, setPassword] = useState('')
  const [loading, setLoading] = useState(false)
  const [errorMsg, setErrorMsg] = useState('')
  const [needsConfirm, setNeedsConfirm] = useState<string | null>(null)
  const [resendMsg, setResendMsg] = useState('')

  const router = useRouter()
  const searchParams = useSearchParams()

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault()
    setLoading(true)
    setErrorMsg('')
    setResendMsg('')
    setNeedsConfirm(null)

    try {
      const res = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ identifier, password }),
      })
      const json = await res.json()

      if (!res.ok) {
        setErrorMsg(json.error ?? 'Could not sign you in.')
        if (json.needsConfirm) setNeedsConfirm(json.email ?? identifier)
        setLoading(false)
        return
      }

      if (json.suspended) {
        router.push('/suspended')
      } else if (json.mustChangePassword) {
        // A temporary password is good for exactly one sign-in.
        const next = nextForRole(searchParams.get('next'), json.role as Role | null)
        router.push(`/account/password${next ? `?next=${encodeURIComponent(next)}` : ''}`)
      } else {
        const role = (json.role as Role | null) ?? null
        router.push(nextForRole(searchParams.get('next'), role) ?? homeForRole(role))
      }
      router.refresh()
    } catch {
      setErrorMsg('Could not reach the server. Please try again.')
      setLoading(false)
    }
  }

  const handleResend = async () => {
    setResendMsg('')
    const supabase = createClient()
    const { error } = await supabase.auth.resend({
      type: 'signup',
      email: needsConfirm ?? identifier,
    })
    setResendMsg(
      error ? `Could not resend: ${error.message}` : 'Confirmation email sent — check your inbox.',
    )
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
          <h1 className="text-xl font-black text-[#0F172A]">Sign in to your account</h1>
          <p className="text-xs text-gray-500">Tutors, parents and schools all sign in here.</p>
        </div>

        {errorMsg && (
          <div className="space-y-2 rounded-xl border border-red-200 bg-red-50 p-3 text-center text-xs font-bold text-[#d60008]">
            <p>{errorMsg}</p>
            {needsConfirm && (
              <button
                type="button"
                onClick={handleResend}
                className="min-h-[44px] w-full rounded-xl bg-[#0F172A] px-4 py-2 text-xs font-bold text-white transition-colors hover:bg-[#059669]"
              >
                Resend confirmation email
              </button>
            )}
          </div>
        )}

        {resendMsg && (
          <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-3 text-center text-xs font-bold text-[#059669]">
            {resendMsg}
          </div>
        )}

        <form onSubmit={handleLogin} className="space-y-4">
          <div className="space-y-1">
            <label htmlFor="identifier" className="text-xs font-bold text-[#0F172A]">
              Email or mobile number
            </label>
            <input
              id="identifier"
              type="text"
              required
              autoComplete="username"
              value={identifier}
              onChange={(e) => setIdentifier(e.target.value)}
              placeholder="name@example.com or 0300 1234567"
              className="min-h-[44px] w-full rounded-xl border border-gray-200 bg-[#F8FAFC] p-3 text-sm outline-none focus:border-[#0F172A] focus:bg-white"
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
              className="min-h-[44px] w-full rounded-xl border border-gray-200 bg-[#F8FAFC] p-3 text-sm outline-none focus:border-[#0F172A] focus:bg-white"
            />
          </div>

          <button
            type="submit"
            disabled={loading}
            className="min-h-[44px] w-full rounded-xl bg-[#d60008] py-3.5 text-xs font-bold uppercase tracking-wider text-white shadow-md transition-all hover:bg-red-700 disabled:opacity-50"
          >
            {loading ? 'Signing in…' : 'Sign in'}
          </button>
        </form>

        <p className="text-center text-xs text-gray-500">
          New to TutorMint?{' '}
          <Link href="/register" className="font-bold text-[#d60008] hover:underline">
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
        <div className="flex min-h-screen items-center justify-center text-xs font-bold text-gray-500">
          Loading…
        </div>
      }
    >
      <LoginForm />
    </Suspense>
  )
}
