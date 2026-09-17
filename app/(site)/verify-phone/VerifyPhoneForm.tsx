'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { STUCK_MESSAGE, armEscape, submitJson } from '@/lib/submit'
import SubmitEscape from '@/components/SubmitEscape'
import { useToast } from '@/components/ui/Toast'

// The code entry — the AUTHENTICATED gate (a legacy mobile-first account, or a
// bridge-verified one re-verifying once the real provider lands). The pre-auth
// signup flow uses PendingVerifyForm; this is only reached with a session.
//
// PR16 §3 — ONE CODE PER ACCOUNT, NO RESEND, NO COUNTDOWN, NO SELF-SERVICE NUMBER
// CHANGE. The account already has its one code (sent at signup, or by the account
// gate); there is no Resend button and no expiry. Five wrong attempts lock the
// code, after which the server returns the "contact support" message — and the
// page shell's support box (WhatsApp 0321 5872222) is how the member gets
// verified. Changing the number goes through support too (§3.2), so the old
// "Wrong number?" self-service form is gone.
//
// On success it routes straight to the dashboard, never to /login.

export default function VerifyPhoneForm({ mobile, home }: { mobile: string; home: string }) {
  const router = useRouter()
  const toast = useToast()

  const [code, setCode] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [locked, setLocked] = useState(false)
  const [stuckHref, setStuckHref] = useState<string | null>(null)

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    setBusy(true)
    setError('')

    const { ok, data, error: failed } = await submitJson<{ locked?: boolean }>(
      '/api/auth/otp',
      { action: 'verify', phone: mobile, code },
    )

    if (!ok) {
      setError(failed ?? 'That code was not accepted.')
      if (data?.locked) setLocked(true)
      setBusy(false)
      return
    }

    // No silent successes: confirm the number is verified before we navigate.
    toast.success('Number verified.')

    armEscape(() => {
      setBusy(false)
      setStuckHref(home)
      setError(STUCK_MESSAGE)
    })
    router.refresh()
    router.push(home)
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

      {/* No Resend and no "wrong number?" — one code per account, and number
          changes go through support (PR16 §3). The support box in the page shell
          below is the way through if the code was lost or is locked. */}
    </div>
  )
}
