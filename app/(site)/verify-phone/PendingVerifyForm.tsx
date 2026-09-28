'use client'

import { useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { Mail } from 'lucide-react'
import { STUCK_MESSAGE, armEscape, submitJson } from '@/lib/submit'
import OtpCodeEntry, { OtpErrorBlock } from '@/components/auth/OtpCodeEntry'
import { useToast } from '@/components/ui/Toast'
import { GENERIC_ERROR } from '@/lib/errorMessages'

// Pre-auth code entry for a mobile signup (owner, 11 Sep 2026).
//
// There is NO account and NO session yet: a pending_signups row holds the draft,
// and entering the code CREATES the account and signs the member in. So this
// form differs from the authenticated gate in three deliberate ways:
//
//   * NO resend button. One SMS per number; the code lasts ten minutes, and the
//     way to get a new one is to start over (which sends exactly one message).
//   * The fallback is EMAIL SIGNUP, not a resend — a free path that already
//     works. A verified mobile can be added later from settings; it is only
//     required to be LISTED in search.
//   * A terminal state (expired code, too many wrong tries) offers "Start over"
//     back to /register rather than a resend.

export default function PendingVerifyForm({ next }: { next: string | null }) {
  const router = useRouter()
  const toast = useToast()

  const [code, setCode] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [errorUr, setErrorUr] = useState<string | null>(null)
  const [errorRef, setErrorRef] = useState<string | null>(null)
  const [terminal, setTerminal] = useState(false) // expired / locked → start over
  const [stuckHref, setStuckHref] = useState<string | null>(null)

  async function submit() {
    setBusy(true)
    setError('')
    setErrorUr(null)
    setErrorRef(null)

    const { ok, data, error: failed } = await submitJson<{
      next?: string
      reason?: string
      errorUr?: string
      ref?: string
    }>('/api/auth/register/verify', { code, next: next ?? undefined })

    if (!ok) {
      setError(failed ?? 'That code was not accepted.')
      setErrorUr(data?.errorUr ?? (data?.ref ? GENERIC_ERROR.ur : null))
      setErrorRef(data?.ref ?? null)
      // On a terminal reason the draft is gone: swap the field for "start over".
      if (data?.reason === 'expired' || data?.reason === 'locked' || data?.reason === 'exists' || data?.reason === 'blocked') {
        setTerminal(true)
      }
      setBusy(false)
      return
    }

    // The account exists and the member is signed in. Confirm before navigating.
    toast.success('Number verified — welcome to TutorMint.')

    const target = data?.next ?? '/login'
    armEscape(() => {
      setBusy(false)
      setStuckHref(target)
      setError(STUCK_MESSAGE)
    })
    router.refresh()
    router.push(target)
  }

  // A terminal reason (expired / locked / exists / blocked) means the draft is
  // gone — show only the error block with "Start over", not the code field.
  const startOver = (
    <Link
      href="/register"
      className="inline-flex min-h-[40px] items-center justify-center rounded-xl bg-tm-red px-4 text-xs font-bold text-white hover:bg-tm-red-hover"
    >
      Start over
    </Link>
  )

  return (
    <div className="space-y-4">
      {terminal ? (
        <OtpErrorBlock error={error || null} errorUr={errorUr} errorRef={errorRef} stuckHref={stuckHref}>
          {startOver}
        </OtpErrorBlock>
      ) : (
        // The shared code entry (PR82). No resend/"different number" — the way to a
        // new code is Start over (the terminal path) or the email fallback below.
        <OtpCodeEntry
          code={code}
          onChange={setCode}
          onVerify={() => void submit()}
          busy={busy}
          busyLabel="Checking…"
          verifyLabel="Verify and continue"
          error={error || null}
          errorUr={errorUr}
          errorRef={errorRef}
          stuckHref={stuckHref}
        />
      )}

      {/* Email fallback (owner). Not a resend — a free path that already works.
          Verifying a mobile can wait for settings; it is only required to be
          LISTED in search. */}
      <div className="space-y-2 rounded-2xl border border-gray-200 bg-white p-4">
        <p className="text-xs font-bold text-tm-navy">Didn&rsquo;t get the code?</p>
        <p className="text-[11px] leading-relaxed text-gray-500">
          You can sign up with your email instead — it&rsquo;s free and works right away. Add and
          verify a mobile number later from Settings; a verified mobile is only needed to be listed
          in search.
        </p>
        <Link
          href="/register"
          className="inline-flex min-h-[40px] items-center justify-center gap-2 rounded-xl border border-gray-200 px-4 text-xs font-bold text-tm-navy transition-colors hover:border-tm-navy"
        >
          <Mail aria-hidden size={14} />
          Sign up with your email instead
        </Link>
      </div>
    </div>
  )
}
