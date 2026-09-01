'use client'

import { useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { Check } from 'lucide-react'

// Terms, then OTP, then claim.
//
// The photo-use consent is called out as its own sentence rather than buried
// in a link nobody opens: TutorMint puts tutor photographs in promotional
// posts, and somebody agreeing to that should have read the words. The
// checkbox covers both because the terms contain the consent — but the screen
// says so out loud.
//
// The OTP step reuses /api/auth/otp exactly as profile completion does. In
// development DEV_DEFAULT_OTP works here too, which is what makes this flow
// testable without an SMS provider.

export default function ClaimFlow({
  termsAccepted,
  phoneVerified,
  phone,
  rawPhone,
}: {
  termsAccepted: boolean
  phoneVerified: boolean
  phone: string
  rawPhone: string
}) {
  const router = useRouter()
  const [accepted, setAccepted] = useState(termsAccepted)
  const [checked, setChecked] = useState(false)
  const [verified, setVerified] = useState(phoneVerified)
  const [code, setCode] = useState('')
  const [sent, setSent] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [note, setNote] = useState<string | null>(null)

  const call = async (url: string, body: Record<string, unknown>) => {
    setBusy(true)
    setError(null)
    setNote(null)
    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      const json = await res.json()
      if (!res.ok) throw new Error(json.error ?? 'That did not work.')
      return json
    } catch (e) {
      setError(e instanceof Error ? e.message : 'That did not work.')
      return null
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="space-y-3">
      {/* ------------------------------------------------------- 1. terms --- */}
      <section className="space-y-3 rounded-2xl border border-gray-200 bg-white p-4 sm:p-5">
        <h2 className="flex items-center gap-2 text-sm font-black text-[#0F172A]">
          {accepted && <Check size={16} className="text-[#059669]" />}
          1. Accept the terms
        </h2>

        {accepted ? (
          <p className="text-xs font-bold text-[#059669]">Accepted.</p>
        ) : (
          <>
            <label className="flex cursor-pointer items-start gap-2 rounded-xl bg-[#F8FAFC] p-3">
              <input
                type="checkbox"
                checked={checked}
                onChange={(e) => setChecked(e.target.checked)}
                className="mt-0.5 h-4 w-4 shrink-0"
              />
              <span className="text-xs leading-relaxed">
                I agree to the{' '}
                <Link href="/terms" className="font-bold text-[#d60008] underline">
                  Terms
                </Link>{' '}
                and{' '}
                <Link href="/privacy" className="font-bold text-[#d60008] underline">
                  Privacy Policy
                </Link>
                , and I agree that TutorMint may use my profile photo and profile details in its
                promotional posts.
              </span>
            </label>

            <button
              type="button"
              disabled={!checked || busy}
              onClick={async () => {
                const json = await call('/api/tutor/claim', {
                  action: 'accept-terms',
                  acceptTerms: true,
                })
                if (json) setAccepted(true)
              }}
              className="min-h-[44px] w-full rounded-xl bg-[#0F172A] px-4 text-xs font-bold text-white disabled:bg-gray-300"
            >
              Accept and continue
            </button>
          </>
        )}
      </section>

      {/* --------------------------------------------------------- 2. OTP --- */}
      <section className="space-y-3 rounded-2xl border border-gray-200 bg-white p-4 sm:p-5">
        <h2 className="flex items-center gap-2 text-sm font-black text-[#0F172A]">
          {verified && <Check size={16} className="text-[#059669]" />}
          2. Verify {phone || 'your mobile number'}
        </h2>

        {verified ? (
          <p className="text-xs font-bold text-[#059669]">Verified.</p>
        ) : !accepted ? (
          <p className="text-xs text-gray-400">Accept the terms first.</p>
        ) : (
          <>
            <p className="text-[11px] leading-relaxed text-gray-500">
              This is the number your profile was created from. Verifying it is what proves the
              account reached the right person.
            </p>

            {!sent ? (
              <button
                type="button"
                disabled={busy}
                onClick={async () => {
                  const json = await call('/api/auth/otp', { action: 'send', phone: rawPhone })
                  if (json) {
                    setSent(true)
                    setNote(json.message ?? 'Code sent.')
                  }
                }}
                className="min-h-[44px] w-full rounded-xl bg-[#0F172A] px-4 text-xs font-bold text-white disabled:bg-gray-300"
              >
                Send me a code
              </button>
            ) : (
              <div className="space-y-2">
                <input
                  value={code}
                  onChange={(e) => setCode(e.target.value)}
                  inputMode="numeric"
                  placeholder="6-digit code"
                  aria-label="Verification code"
                  className="min-h-[44px] w-full rounded-xl border border-gray-200 px-3 text-center text-sm font-black tracking-[0.3em]"
                />
                <button
                  type="button"
                  disabled={busy || code.trim().length < 4}
                  onClick={async () => {
                    const json = await call('/api/auth/otp', {
                      action: 'verify',
                      phone: rawPhone,
                      code: code.trim(),
                    })
                    if (json) setVerified(true)
                  }}
                  className="min-h-[44px] w-full rounded-xl bg-[#059669] px-4 text-xs font-bold text-white disabled:bg-gray-300"
                >
                  Verify
                </button>
              </div>
            )}
          </>
        )}
      </section>

      {note && <p className="text-[11px] font-bold text-[#059669]">{note}</p>}
      {error && <p className="text-[11px] font-bold text-[#d60008]">{error}</p>}

      {/* ------------------------------------------------------- 3. claim --- */}
      <button
        type="button"
        disabled={!accepted || !verified || busy}
        onClick={async () => {
          const json = await call('/api/tutor/claim', { action: 'finish' })
          if (json) {
            router.push('/tutor/complete-profile')
            router.refresh()
          }
        }}
        className="min-h-[44px] w-full rounded-xl bg-[#d60008] px-4 text-xs font-bold uppercase tracking-wider text-white disabled:bg-gray-300"
      >
        Claim my profile
      </button>

      <p className="text-center text-[11px] leading-relaxed text-gray-400">
        Claiming does not put you in search yet — you will still need a complete profile, like every
        other tutor.
      </p>
    </div>
  )
}
