'use client'
import { MessageSquare } from 'lucide-react'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { STUCK_MESSAGE, armEscape, submitJson, submitSignal } from '@/lib/submit'
import SubmitEscape from '@/components/SubmitEscape'
import { formatPkMobile } from '@/lib/phone'

// The code entry itself.
//
// Three things a person stuck on this screen might need, all reachable without
// leaving it: enter the code, ask for another one, or correct the number they
// typed at signup. Without the third, a single mistyped digit at signup is
// unrecoverable — the code goes to a stranger's handset and this page can
// never be passed.
//
// On success it routes straight to the dashboard. Never to /login: the member
// has been signed in since the moment the account was created, and bouncing
// them to a sign-in form would ask them to prove something they just proved.

const RESEND_COOLDOWN_SECONDS = 60

export default function VerifyPhoneForm({ mobile, home }: { mobile: string; home: string }) {
  const router = useRouter()

  const [code, setCode] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [locked, setLocked] = useState(false)
  const [stuckHref, setStuckHref] = useState<string | null>(null)

  const [cooldown, setCooldown] = useState(RESEND_COOLDOWN_SECONDS)
  const [changing, setChanging] = useState(false)
  const [newMobile, setNewMobile] = useState('')
  const [currentMobile, setCurrentMobile] = useState(mobile)

  // A code was sent when the account was created, so the countdown starts on
  // arrival rather than at zero — otherwise the first thing the screen offers
  // is a second message nobody needs.
  useEffect(() => {
    if (cooldown <= 0) return
    const t = setTimeout(() => setCooldown((c) => c - 1), 1000)
    return () => clearTimeout(t)
  }, [cooldown])

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    setBusy(true)
    setError('')
    setNotice('')

    const { ok, data, error: failed } = await submitJson<{ locked?: boolean }>(
      '/api/auth/otp',
      { action: 'verify', phone: currentMobile, code },
    )

    if (!ok) {
      setError(failed ?? 'That code was not accepted.')
      if (data?.locked) {
        setLocked(true)
        setCooldown(0) // they need a new code now, so do not make them wait
      }
      setBusy(false)
      return
    }

    // The number is verified whatever happens next, so a stalled navigation
    // must not read as a failed verification -- the member would ask for
    // another code they no longer need.
    armEscape(() => {
      setBusy(false)
      setStuckHref(home)
      setError(STUCK_MESSAGE)
    })
    // router.refresh() first so the proxy re-reads the profile it is gating on
    // before the dashboard is requested; without it the push can race the
    // cookie-backed session and bounce straight back here.
    router.refresh()
    router.push(home)
  }

  async function resend() {
    setBusy(true)
    setError('')
    setNotice('')

    const res = await fetch('/api/auth/otp', { signal: submitSignal(),
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'send', phone: currentMobile }),
    })
    const data = await res.json().catch(() => ({}))

    if (!res.ok) {
      setError(data.error ?? 'Could not send a new code.')
      if (typeof data.retryAfterSeconds === 'number') setCooldown(data.retryAfterSeconds)
    } else {
      setLocked(false)
      setCode('')
      setCooldown(RESEND_COOLDOWN_SECONDS)
      setNotice(
        data.devBypassActive
          ? 'Development mode: use the configured test code.'
          : 'A new code is on its way.',
      )
    }
    setBusy(false)
  }

  async function changeNumber(e: React.FormEvent) {
    e.preventDefault()
    setBusy(true)
    setError('')
    setNotice('')

    const res = await fetch('/api/auth/phone', { signal: submitSignal(),
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ mobile: newMobile }),
    })
    const data = await res.json().catch(() => ({}))

    if (!res.ok) {
      setError(data.error ?? 'Could not change the number.')
      setBusy(false)
      return
    }

    setCurrentMobile(data.mobile)
    setChanging(false)
    setNewMobile('')
    setCode('')
    setLocked(false)
    setCooldown(RESEND_COOLDOWN_SECONDS)
    setNotice(
      data.codeSent === false
        ? 'Number updated, but the code could not be sent. Try Resend in a moment.'
        : `Code sent to ${formatPkMobile(data.mobile)}.`,
    )
    setBusy(false)
  }

  return (
    <div className="space-y-4">
      {error && (
        <div
          role="alert"
          className="space-y-2 rounded-xl border border-tm-red/30 bg-tm-tint-red p-3 text-center text-xs font-bold text-tm-red"
        >
          <p>{error}</p>
          {stuckHref && <SubmitEscape href={stuckHref} />}
        </div>
      )}
      {notice && (
        <p className="rounded-xl border border-tm-green-deep/30 bg-tm-tint-green p-3 text-center text-xs font-bold text-tm-green-deep">
          {notice}
        </p>
      )}

      <form onSubmit={submit} className="space-y-4">
        <div className="space-y-1">
          <label htmlFor="code" className="text-xs font-bold text-tm-navy">
            6-digit code
          </label>
          <input
            id="code"
            value={code}
            onChange={(e) => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
            inputMode="numeric"
            autoComplete="one-time-code"
            // autoFocus is right here and almost nowhere else: this screen has
            // one field and the member arrived with a code already in hand.
            autoFocus
            placeholder="000000"
            className="w-full min-h-[52px] rounded-xl border border-gray-200 bg-tm-bg p-3 text-center text-2xl font-black tracking-[0.4em] text-tm-navy outline-none focus:border-tm-navy focus:bg-white"
          />
        </div>

        <button
          type="submit"
          disabled={busy || code.length < 6 || locked}
          className="w-full min-h-[44px] rounded-xl bg-tm-red py-3.5 text-xs font-bold text-white shadow-md transition-colors hover:bg-tm-red-hover disabled:opacity-50"
        >
          {busy ? 'Checking…' : 'Verify and continue'}
        </button>
      </form>

      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <button
          type="button"
          onClick={resend}
          disabled={busy || cooldown > 0}
          className="flex min-h-[44px] items-center justify-center rounded-xl px-3 text-xs font-bold text-tm-navy hover:underline disabled:text-gray-500 disabled:no-underline"
        >
          {cooldown > 0 ? `Resend code in ${cooldown}s` : 'Resend code'}
        </button>

        <button
          type="button"
          onClick={() => setChanging((v) => !v)}
          className="flex min-h-[44px] items-center justify-center rounded-xl px-3 text-xs font-bold text-tm-red hover:underline"
        >
          {changing ? 'Keep this number' : 'Wrong number?'}
        </button>
      </div>

      {changing && (
        <form onSubmit={changeNumber} className="space-y-3 rounded-2xl border border-gray-200 bg-tm-bg p-4">
          <label htmlFor="newMobile" className="text-xs font-bold text-tm-navy">
            New mobile number
          </label>
          <input
            id="newMobile"
            value={newMobile}
            onChange={(e) => setNewMobile(e.target.value)}
            inputMode="tel"
            autoComplete="tel"
            placeholder="0300 1234567"
            className="w-full min-h-[44px] rounded-xl border border-gray-200 bg-white p-3 text-sm outline-none focus:border-tm-navy"
          />
          <p className="text-[11px] leading-relaxed text-gray-500">
            If you signed up without an email address, this is also the number you sign in with —
            it will be updated too.
          </p>
          <button
            type="submit"
            disabled={busy || !newMobile.trim()}
            className="inline-flex items-center gap-1.5 w-full min-h-[44px] rounded-xl bg-tm-navy py-3 text-xs font-bold text-white transition-colors hover:bg-tm-navy-hover disabled:opacity-50"
          >
            <MessageSquare aria-hidden size={14} />
            Send code to this number
          </button>
        </form>
      )}
    </div>
  )
}
