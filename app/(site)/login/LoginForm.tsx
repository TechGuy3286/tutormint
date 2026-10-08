'use client'
import { Mail } from 'lucide-react'

import { useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'

import SubmitEscape from '@/components/SubmitEscape'
import PasswordInput from '@/components/ui/PasswordInput'
import RolePicker from '@/components/auth/RolePicker'
import { createClient } from '@/lib/supabase/client'
import { homeForRole, nextForRole, type Role } from '@/lib/authRoutes'
import { armEscape, STUCK_MESSAGE, submitError, submitJson } from '@/lib/submit'
import { whatsappHref, SUPPORT_WHATSAPP_FALLBACK } from '@/lib/supportContacts'
import { GENERIC_ERROR, supportWhatsappHref } from '@/lib/errorMessages'
import { useToast } from '@/components/ui/Toast'
import { WELCOME_BACK, WELCOME_BACK_UR } from '@/lib/selfPauseCore'

// The support WhatsApp link shown under the form (§3.4). The number is the one
// constant from lib/support(Contacts); a client component cannot read the
// app_settings/env override, and the constant is the number. Named distinctly
// from the `supportHref` STATE below (the banned-account "Contact support"
// link), so the always-on help link is never shadowed to null.
const helpWhatsappHref = whatsappHref(
  SUPPORT_WHATSAPP_FALLBACK,
  'Assalam-o-Alaikum, I need some help with TutorMint.',
)

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

export default function LoginForm({ next, role }: { next: string | null; role?: string | null }) {
  const [identifier, setIdentifier] = useState('')
  const [password, setPassword] = useState('')
  const [rememberMe, setRememberMe] = useState(true)
  const [loading, setLoading] = useState(false)
  const [errorMsg, setErrorMsg] = useState('')
  const [errorUr, setErrorUr] = useState<string | null>(null)
  const [errorRef, setErrorRef] = useState<string | null>(null)
  const [stuckHref, setStuckHref] = useState<string | null>(null)
  const [needsConfirm, setNeedsConfirm] = useState<string | null>(null)
  const [supportHref, setSupportHref] = useState<string | null>(null)
  const [resendMsg, setResendMsg] = useState('')
  const [choosing, setChoosing] = useState(false)

  const router = useRouter()
  const toast = useToast()

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
    setErrorUr(null)
    setErrorRef(null)
    setResendMsg('')
    setStuckHref(null)
    setNeedsConfirm(null)
    setSupportHref(null)

    const { ok, data, error } = await submitJson<{
      role?: string | null
      suspended?: boolean
      mustChangePassword?: boolean
      needsConfirm?: boolean
      email?: string
      banned?: boolean
      supportHref?: string
      reverify?: boolean
      needsPhoneVerify?: boolean
      restored?: boolean
      chooseRole?: boolean
      errorUr?: string
      ref?: string
    }>('/api/auth/login', { identifier, password, rememberMe })

    if (!ok || !data) {
      setErrorMsg(error ?? 'Could not sign you in.')
      // The Urdu line beside the English one (PR75 §2). Fall back to the generic
      // Urdu when a ref is present but the route sent no specific line.
      setErrorUr(data?.errorUr ?? (data?.ref ? GENERIC_ERROR.ur : null))
      setErrorRef(data?.ref ?? null)
      if (data?.needsConfirm) setNeedsConfirm(data.email ?? identifier)
      // A banned account is signed out server-side; there is no session to
      // route, so we stay on the form and show the message with a support link.
      if (data?.banned) setSupportHref(data.supportHref ?? '/support')
      setLoading(false)
      return
    }

    if (data.suspended) return go('/suspended')

    // A self-paused account was brought back by this sign-in (owner, 8 Oct
    // 2026). The toast is mounted at the root, so it survives the navigation.
    if (data.restored) toast.success(`${WELCOME_BACK}
${WELCOME_BACK_UR}`)

    // Verification before the dashboard (owner, 9 Sep): a mobile-first account
    // that has not verified its number — or a bridge number whose bridge was
    // removed — is held at /verify-phone, never landed on a dashboard first.
    if (data.needsPhoneVerify || data.reverify) return go('/verify-phone')

    // Two linked accounts on this mobile (owner, 8 Oct 2026): ask which role.
    if (data.chooseRole) {
      setLoading(false)
      setChoosing(true)
      return
    }

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

  if (choosing) {
    return (
      <main className="flex min-h-screen flex-col bg-tm-bg p-4 text-slate-700 sm:p-6">
        <div className="mx-auto mt-4 w-full max-w-sm rounded-3xl border border-gray-200 bg-white p-6 shadow-sm">
          <RolePicker onDone={(href) => go(href)} />
        </div>
      </main>
    )
  }

  return (
    // §3.1 no breadcrumb; §3.2 the card sits just below the header (top-aligned
    // with a little padding), not vertically centred.
    <main className="flex min-h-screen flex-col bg-tm-bg p-4 text-slate-700 sm:p-6">
      <div className="flex flex-1 items-start justify-center pt-2 sm:pt-4">
        <div className="w-full max-w-md space-y-6 rounded-3xl border border-gray-200 bg-white p-6 shadow-xl sm:p-8">
          <div className="space-y-2 text-center">
            <Link
              href="/"
              className="inline-flex min-h-[44px] items-center justify-center text-xl font-black text-tm-navy"
            >
              Tutor<span className="text-tm-red">Mint</span>
            </Link>
            <h1 className="text-xl font-black text-tm-navy">Sign in to your account</h1>
          </div>

          {errorMsg && (
            <div
              role="alert"
              className="space-y-2 rounded-xl border border-tm-red/30 bg-tm-tint-red p-3 text-center text-xs font-bold text-tm-red"
            >
              <p>{errorMsg}</p>
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
              {stuckHref && <SubmitEscape href={stuckHref} />}
              {supportHref && (
                <Link
                  href={supportHref}
                  className="inline-flex min-h-[44px] w-full items-center justify-center rounded-xl bg-tm-black px-4 py-2 text-xs font-bold text-white hover:bg-tm-navy"
                >
                  Contact support
                </Link>
              )}
              {needsConfirm && (
                <button
                  type="button"
                  onClick={handleResend}
                  className="inline-flex items-center gap-1.5 min-h-[44px] w-full rounded-xl bg-tm-black px-4 py-2 text-xs font-bold text-white transition-colors hover:bg-tm-green-deep"
                >
                  <Mail aria-hidden size={14} />
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
              <PasswordInput
                id="password"
                required
                autoComplete="current-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="••••••••"
                className="min-h-[44px] w-full rounded-xl border border-gray-200 bg-tm-bg p-3 text-sm outline-none focus:border-tm-navy focus:bg-white"
              />
              {/* Small link under the password field (owner hotfix, 5 Oct 2026). */}
              <div className="flex justify-end">
                <Link
                  href="/forgot-password"
                  className="inline-flex min-h-[32px] items-center text-[11px] font-bold text-tm-navy hover:underline"
                >
                  Forgot password?
                </Link>
              </div>
            </div>

            <label className="flex min-h-[44px] cursor-pointer items-center gap-2 text-xs font-bold text-tm-navy">
              <input
                type="checkbox"
                checked={rememberMe}
                onChange={(e) => setRememberMe(e.target.checked)}
                className="h-4 w-4 accent-tm-red"
              />
              Remember me on this device
            </label>

            <button
              type="submit"
              disabled={loading}
              className="min-h-[44px] w-full rounded-xl bg-tm-red py-3.5 text-xs font-bold text-white shadow-md transition-all hover:bg-tm-red-hover disabled:opacity-50"
            >
              {loading ? 'Signing in…' : 'Sign in'}
            </button>
          </form>

          <div className="space-y-4">
            {/* PR106-G §3: thin "or" divider, then a full-width outlined
                "Create an account" button (white, navy border + text). */}
            <div className="flex items-center gap-3">
              <span className="h-px flex-1 bg-gray-200" />
              <span className="text-[11px] font-bold text-gray-500">or</span>
              <span className="h-px flex-1 bg-gray-200" />
            </div>
            <Link
              href={(() => {
                // Forward BOTH `next` (the interrupted action) and `role` (the
                // sign-up default hint) to the sign-up page.
                const p = new URLSearchParams()
                if (next) p.set('next', next)
                if (role === 'parent' || role === 'tutor') p.set('role', role)
                const q = p.toString()
                return q ? `/register?${q}` : '/register'
              })()}
              className="flex min-h-[44px] w-full items-center justify-center rounded-xl border border-tm-navy bg-white text-xs font-bold text-tm-navy transition-colors hover:bg-tm-navy/5"
            >
              Create an account
            </Link>

            {/* PR106-G §3: the ONLY WhatsApp icon in signup/onboarding — a round
                green button opening WhatsApp with the existing prefilled greeting.
                Accessible label only (no visible text). */}
            {helpWhatsappHref && (
              <div className="flex justify-center">
                <a
                  href={helpWhatsappHref}
                  target="_blank"
                  rel="noopener noreferrer"
                  aria-label="Message us on WhatsApp"
                  className="inline-flex h-11 w-11 items-center justify-center rounded-full bg-tm-green-deep text-white transition-colors hover:bg-tm-green-deep-hover"
                >
                  <svg viewBox="0 0 24 24" width="22" height="22" fill="currentColor" aria-hidden>
                    <path d="M12.04 2c-5.46 0-9.91 4.45-9.91 9.91 0 1.75.46 3.45 1.32 4.95L2 22l5.25-1.38a9.87 9.87 0 0 0 4.79 1.22h.01c5.46 0 9.91-4.45 9.91-9.91 0-2.65-1.03-5.14-2.9-7.01A9.82 9.82 0 0 0 12.04 2zm0 1.8c2.17 0 4.2.85 5.74 2.38a8.06 8.06 0 0 1 2.38 5.73c0 4.48-3.65 8.12-8.12 8.12-1.46 0-2.89-.39-4.14-1.13l-.3-.18-3.11.82.83-3.04-.19-.31a8.06 8.06 0 0 1-1.25-4.32c0-4.47 3.64-8.11 8.11-8.11zm4.68 10.3c-.26-.13-1.52-.75-1.75-.83-.24-.09-.41-.13-.58.13-.17.26-.67.83-.82 1-.15.17-.3.19-.56.06-.26-.13-1.08-.4-2.06-1.27-.76-.68-1.28-1.52-1.43-1.78-.15-.26-.02-.4.11-.53.12-.12.26-.3.39-.46.13-.15.17-.26.26-.43.09-.17.04-.32-.02-.45-.06-.13-.58-1.4-.8-1.92-.21-.5-.42-.43-.58-.44l-.5-.01c-.17 0-.45.06-.68.32-.24.26-.9.88-.9 2.15 0 1.27.92 2.49 1.05 2.66.13.17 1.82 2.78 4.42 3.9.62.27 1.1.43 1.47.55.62.2 1.18.17 1.63.1.5-.07 1.52-.62 1.74-1.22.21-.6.21-1.11.15-1.22-.06-.11-.24-.17-.5-.3z" />
                  </svg>
                </a>
              </div>
            )}
          </div>
        </div>
      </div>
    </main>
  )
}
