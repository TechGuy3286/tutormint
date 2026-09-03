'use client'

import { useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'

import Breadcrumbs from '@/components/Breadcrumbs'
import SubmitEscape from '@/components/SubmitEscape'
import { createClient } from '@/lib/supabase/client'
import { homeForRole, nextForRole, type Role } from '@/lib/authRoutes'
import { armEscape, STUCK_MESSAGE, submitError, submitJson } from '@/lib/submit'

// The sign-in form. /parent/login and /tutor/login redirect to this route, and
// a member who already has a session never reaches it -- page.tsx sends them
// to their dashboard before this renders.
//
// Accepts an email address OR a Pakistani mobile number. Imported tutors were
// created from a spreadsheet with no email of their own and sign in with their
// number and a temporary password; everyone else uses the address they
// registered with. The mapping is done by /api/auth/login, on the server --
// resolving a number to an account needs a lookup a browser must not make, and
// keeping it server-side is also what lets every failure return the same
// message instead of confirming which numbers are registered.
//
// THE BUTTON ALWAYS HAS AN EXIT. It used to have exactly one: an error. The
// success path called router.push and left `loading` true on the assumption
// that the page was about to be replaced -- so any push that did not take the
// page away (a same-URL target, a destination that redirected back, an RSC
// fetch that never returned) left "SIGNING IN…" on screen with nothing to
// press and nothing to read. Now the request is bounded at ten seconds, every
// response shape lands in a branch, and the navigation itself has a deadline
// after which the member is given a link and their button back.

export default function LoginForm({ next }: { next: string | null }) {
  const [identifier, setIdentifier] = useState('')
  const [password, setPassword] = useState('')
  const [loading, setLoading] = useState(false)
  const [errorMsg, setErrorMsg] = useState('')
  const [stuckHref, setStuckHref] = useState<string | null>(null)
  const [needsConfirm, setNeedsConfirm] = useState<string | null>(null)
  const [resendMsg, setResendMsg] = useState('')

  const router = useRouter()

  const go = (href: string) => {
    // The escape is armed BEFORE the push, not after: if the push throws
    // synchronously there is still a deadline running, and if it succeeds the
    // component unmounts and the timer's setState is a no-op.
    armEscape(() => {
      setLoading(false)
      setStuckHref(href)
      setErrorMsg(STUCK_MESSAGE)
    })
    router.push(href)
    router.refresh()
  }

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault()
    setLoading(true)
    setErrorMsg('')
    setResendMsg('')
    setStuckHref(null)
    setNeedsConfirm(null)

    const { ok, data, error } = await submitJson<{
      role?: string | null
      suspended?: boolean
      mustChangePassword?: boolean
      needsConfirm?: boolean
      email?: string
    }>('/api/auth/login', { identifier, password })

    if (!ok || !data) {
      setErrorMsg(error ?? 'Could not sign you in.')
      if (data?.needsConfirm) setNeedsConfirm(data.email ?? identifier)
      setLoading(false)
      return
    }

    if (data.suspended) return go('/suspended')

    if (data.mustChangePassword) {
      // A temporary password is good for exactly one sign-in.
      const after = nextForRole(next, (data.role as Role | null) ?? null)
      return go(`/account/password${after ? `?next=${encodeURIComponent(after)}` : ''}`)
    }

    const role = (data.role as Role | null) ?? null
    return go(nextForRole(next, role) ?? homeForRole(role))
  }

  const handleResend = async () => {
    setResendMsg('')
    try {
      const supabase = createClient()
      const { error } = await supabase.auth.resend({
        type: 'signup',
        email: needsConfirm ?? identifier,
      })
      setResendMsg(
        error ? `Could not resend: ${error.message}` : 'Confirmation email sent — check your inbox.',
      )
    } catch (e) {
      setResendMsg(submitError(e, 'Could not resend the confirmation email.'))
    }
  }

  return (
    <main className="flex min-h-screen flex-col bg-tm-bg p-4 text-slate-700 sm:p-6">
      <Breadcrumbs items={[{ label: 'Sign in' }]} />
      <div className="flex flex-1 items-center justify-center">
        <div className="w-full max-w-md space-y-6 rounded-3xl border border-gray-200 bg-white p-6 shadow-xl sm:p-8">
          <div className="space-y-2 text-center">
            <Link
              href="/"
              className="inline-flex min-h-[44px] items-center justify-center text-xl font-black text-tm-navy"
            >
              Tutor<span className="text-tm-red">Mint</span>
            </Link>
            <h1 className="text-xl font-black text-tm-navy">Sign in to your account</h1>
            <p className="text-xs text-gray-500">Tutors, parents and schools all sign in here.</p>
          </div>

          {errorMsg && (
            <div
              role="alert"
              className="space-y-2 rounded-xl border border-tm-red/30 bg-tm-tint-red p-3 text-center text-xs font-bold text-tm-red"
            >
              <p>{errorMsg}</p>
              {stuckHref && <SubmitEscape href={stuckHref} />}
              {needsConfirm && (
                <button
                  type="button"
                  onClick={handleResend}
                  className="min-h-[44px] w-full rounded-xl bg-tm-black px-4 py-2 text-xs font-bold text-white transition-colors hover:bg-tm-green-deep"
                >
                  Resend confirmation email
                </button>
              )}
            </div>
          )}

          {resendMsg && (
            <div className="rounded-xl border border-tm-green-deep/30 bg-tm-tint-green p-3 text-center text-xs font-bold text-tm-green-deep">
              {resendMsg}
            </div>
          )}

          <form onSubmit={handleLogin} className="space-y-4">
            <div className="space-y-1">
              <label htmlFor="identifier" className="text-xs font-bold text-tm-navy">
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
                className="min-h-[44px] w-full rounded-xl border border-gray-200 bg-tm-bg p-3 text-sm outline-none focus:border-tm-navy focus:bg-white"
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
                autoComplete="current-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="••••••••"
                className="min-h-[44px] w-full rounded-xl border border-gray-200 bg-tm-bg p-3 text-sm outline-none focus:border-tm-navy focus:bg-white"
              />
            </div>

            <button
              type="submit"
              disabled={loading}
              className="min-h-[44px] w-full rounded-xl bg-tm-red py-3.5 text-xs font-bold uppercase tracking-wider text-white shadow-md transition-all hover:bg-tm-red-hover disabled:opacity-50"
            >
              {loading ? 'Signing in…' : 'Sign in'}
            </button>
          </form>

          <div className="space-y-2 text-center">
            <Link
              href="/forgot-password"
              className="flex min-h-[44px] items-center justify-center text-xs font-bold text-tm-navy hover:underline"
            >
              Forgot your password?
            </Link>
            <p className="text-xs text-gray-500">
              New to TutorMint?{' '}
              {/* `next` travels on, so a guest who was interrupted mid-action and
                  chose to create an account instead of signing in still lands
                  back on what they were doing -- through signup AND through the
                  phone gate. */}
              <Link
                href={next ? `/register?next=${encodeURIComponent(next)}` : '/register'}
                className="font-bold text-tm-red hover:underline"
              >
                Create an account
              </Link>
            </p>
          </div>
        </div>
      </div>
    </main>
  )
}
