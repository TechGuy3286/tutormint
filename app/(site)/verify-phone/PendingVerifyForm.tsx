'use client'

import { useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { Check } from 'lucide-react'
import { STUCK_MESSAGE, armEscape, submitJson } from '@/lib/submit'
import OtpCodeEntry, { OtpErrorBlock } from '@/components/auth/OtpCodeEntry'
import { useToast } from '@/components/ui/Toast'
import { GENERIC_ERROR } from '@/lib/errorMessages'

// Pre-auth code entry for a mobile signup (owner, 11 Sep 2026; cleaned up
// PR106-G §3). There is NO account and NO session yet: a pending_signups row
// holds the draft, and entering the code CREATES the account and signs the
// member in. One code per number for life — no resend, no timer. The ONLY
// fallback is email signup (a free path); no WhatsApp icon here (§8).
//
// Top to bottom (§6): a small green "✓ OTP sent to <masked>", the 6-digit box,
// "Verify and then Sign In", then two small links — "Change number" and
// "Didn't get the OTP? Use email instead". Errors render as one short line
// under the box via OtpCodeEntry (English + Urdu), never raw technical text.

export default function PendingVerifyForm({ next, sentTo }: { next: string | null; sentTo?: string | null }) {
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
      if (data?.reason === 'expired' || data?.reason === 'locked' || data?.reason === 'exists' || data?.reason === 'blocked') {
        setTerminal(true)
      }
      setBusy(false)
      return
    }

    // The account exists and the member is signed in. Clear the signup draft so
    // a later /register visit starts clean (§14), then confirm before navigating.
    try { sessionStorage.removeItem('tm_signup_draft') } catch { /* non-fatal */ }
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
  if (terminal) {
    return (
      <div className="space-y-4">
        <OtpErrorBlock error={error || null} errorUr={errorUr} errorRef={errorRef} stuckHref={stuckHref}>
          <Link
            href="/register"
            className="inline-flex min-h-[40px] items-center justify-center rounded-xl bg-tm-red px-4 text-xs font-bold text-white hover:bg-tm-red-hover"
          >
            Start over
          </Link>
        </OtpErrorBlock>
      </div>
    )
  }

  return (
    <div className="space-y-4">
      {/* §6: small green confirmation that the OTP was sent. */}
      {sentTo && (
        <p className="flex items-center justify-center gap-1.5 rounded-xl bg-tm-tint-green px-3 py-2 text-xs font-bold text-tm-green-deep">
          <Check size={15} aria-hidden /> OTP sent to {sentTo}
        </p>
      )}

      <OtpCodeEntry
        code={code}
        onChange={setCode}
        onVerify={() => void submit()}
        busy={busy}
        busyLabel="Checking…"
        verifyLabel="Verify and then Sign In"
        verifyLabelUr="تصدیق کریں اور سائن ان ہوں"
        error={error || null}
        errorUr={errorUr}
        errorRef={errorRef}
        stuckHref={stuckHref}
      />

      {/* §6/§7: two small links. One code per number, no resend — the only
          alternative is email signup, which keeps the name + role. */}
      <div className="space-y-1 text-center">
        <Link href="/register" className="block min-h-[36px] text-xs font-bold text-tm-navy underline-offset-2 hover:underline">
          Change number
        </Link>
        <Link href="/register" className="block min-h-[36px] text-xs font-bold text-tm-navy underline-offset-2 hover:underline">
          Didn&rsquo;t get the OTP? Use email instead
        </Link>
      </div>
    </div>
  )
}
