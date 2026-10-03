'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { STUCK_MESSAGE, armEscape, submitJson } from '@/lib/submit'
import OtpCodeEntry from '@/components/auth/OtpCodeEntry'
import OtpAlreadySentNotice from '@/components/auth/OtpAlreadySentNotice'
import { useToast } from '@/components/ui/Toast'
import { GENERIC_ERROR } from '@/lib/errorMessages'

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
  const [errorUr, setErrorUr] = useState<string | null>(null)
  const [errorRef, setErrorRef] = useState<string | null>(null)
  const [locked, setLocked] = useState(false)
  const [stuckHref, setStuckHref] = useState<string | null>(null)

  async function submit() {
    setBusy(true)
    setError('')
    setErrorUr(null)
    setErrorRef(null)

    const { ok, data, error: failed } = await submitJson<{ locked?: boolean; errorUr?: string; ref?: string }>(
      '/api/auth/otp',
      { action: 'verify', phone: mobile, code },
    )

    if (!ok) {
      setError(failed ?? 'That code was not accepted.')
      setErrorUr(data?.errorUr ?? (data?.ref ? GENERIC_ERROR.ur : null))
      setErrorRef(data?.ref ?? null)
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
    // The shared code entry (PR82). No Resend and no "wrong number?" — one code per
    // account, and number changes go through support (PR16 §3). The standing
    // notice (PR93) says to use the code already sent; the support box in the page
    // shell below is the way through if the code was lost or is locked.
    <div className="space-y-4">
      <OtpAlreadySentNotice emailSignupHref="/register" />
      <OtpCodeEntry
        code={code}
        onChange={setCode}
        onVerify={() => void submit()}
        busy={busy}
        busyLabel="Checking…"
        verifyLabel="Verify and then Sign In"
        verifyLabelUr="تصدیق کریں اور سائن ان ہوں"
        locked={locked}
        error={error || null}
        errorUr={errorUr}
        errorRef={errorRef}
        stuckHref={stuckHref}
      />
    </div>
  )
}
