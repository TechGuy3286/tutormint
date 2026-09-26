'use client'

import { useCallback, useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { Loader2, RefreshCw } from 'lucide-react'

import CnicCameraField from '@/components/tutor/CnicCameraField'
import { armEscape, STUCK_MESSAGE, submitJson } from '@/lib/submit'
import SubmitEscape from '@/components/SubmitEscape'
import FriendlyPaymentError from '@/components/ui/FriendlyPaymentError'
import type { IdentityState } from '@/lib/identity'

// The verification gate an UNVERIFIED tutor meets when they tap Apply (owner,
// 15 Sep 2026). Deliberately minimal — a tutor on a phone does not read paragraphs.
//
// It reads the CNIC review state first (owner PR6 §2): a tutor who has ALREADY
// submitted (or had approved) their CNIC is never shown the camera tiles again —
// they go straight to the payment step. The tiles appear only when there is no
// CNIC on file yet, or a submission was rejected (then with the reason).
//
//   * CNIC not submitted / rejected → FRONT and BACK camera tiles (the shared
//     CnicCameraField), then Verify (enabled once both are taken),
//   * CNIC submitted / approved → a status line and a single Verify button
//     straight to the payment page,
//   * "Verify" routes to the payment page and does nothing else — NO price here.
//
// The images save to the tutor's profile automatically (kind 'cnic' — the private
// identity-docs bucket; never re-uploaded elsewhere, never shown publicly).

type Side = 'front' | 'back'

export default function TutorVerifyGate({ onClose }: { onClose: () => void }) {
  const router = useRouter()
  const [done, setDone] = useState<{ front: boolean; back: boolean }>({ front: false, back: false })
  const [error, setError] = useState<string | null>(null)
  const [starting, setStarting] = useState(false)
  const [stuck, setStuck] = useState<string | null>(null)
  // The CNIC review state, loaded before anything renders, so a submitted card
  // is never asked for again (§2.1). null = still loading; loadError = the read
  // failed or timed out, so the step shows Retry rather than spinning forever
  // (owner PR8 §2.1).
  const [cnicState, setCnicState] = useState<IdentityState | null>(null)
  const [rejectionReason, setRejectionReason] = useState<string | null>(null)
  const [loadError, setLoadError] = useState(false)

  const loadIdentityState = useCallback(async () => {
    setLoadError(false)
    try {
      // A hard timeout so a hung request can never leave the step on a spinner.
      const res = await fetch('/api/identity', {
        headers: { accept: 'application/json' },
        signal: AbortSignal.timeout(8000),
      })
      if (!res.ok) throw new Error(String(res.status))
      const j = await res.json()
      setCnicState((j?.identity?.state as IdentityState) ?? 'none')
      setRejectionReason((j?.identity?.rejectionReason as string | null) ?? null)
    } catch {
      setLoadError(true)
    }
  }, [])

  useEffect(() => {
    void loadIdentityState()
  }, [loadIdentityState])

  const both = done.front && done.back

  const markDone = (side: Side) => setDone((d) => ({ ...d, [side]: true }))

  async function verify() {
    setStarting(true)
    setError(null)
    // The one-time fee is a checkout for the 'verified' fee marker (Rs 199).
    const { ok, data, error: failed } = await submitJson<{ mode?: string; url?: string; next?: string }>(
      '/api/payments/checkout',
      { planCode: 'verified' },
    )
    if (!ok || !data) {
      setError(failed ?? 'Could not start the payment.')
      setStarting(false)
      return
    }
    const target = data.mode === 'redirect' ? (data.url ?? '') : (data.next ?? '')
    if (!target) {
      setError('Could not start the payment.')
      setStarting(false)
      return
    }
    armEscape(() => {
      setStarting(false)
      setStuck(target)
      setError(STUCK_MESSAGE)
    })
    if (data.mode === 'redirect') {
      window.location.assign(target)
      return
    }
    router.push(target)
  }

  if (loadError) {
    return (
      <div className="mt-3 space-y-3 py-2 text-center">
        <p className="text-xs font-semibold text-slate-700">
          We couldn&rsquo;t load this step. Please try again.
        </p>
        <button
          type="button"
          onClick={() => void loadIdentityState()}
          className="inline-flex min-h-[44px] items-center justify-center gap-1.5 rounded-xl bg-tm-navy px-4 text-xs font-bold text-white"
        >
          <RefreshCw aria-hidden size={14} /> Retry
        </button>
      </div>
    )
  }

  if (cnicState === null) {
    return (
      <div className="mt-3 grid place-items-center py-6">
        <Loader2 aria-hidden size={22} className="animate-spin text-gray-500" />
      </div>
    )
  }

  // A submitted or approved CNIC is NEVER asked for again (§2.1/§2.3): show its
  // status and a single button straight to the payment step.
  const hasCnic = cnicState === 'submitted' || cnicState === 'approved'

  const buttons = (
    <>
      {error && (
        <div className="space-y-2">
          {/* Never show raw error text on the payment/verify flow (PR66 §2). */}
          {stuck ? <SubmitEscape href={stuck} /> : <FriendlyPaymentError />}
        </div>
      )}
      <div className="flex flex-col gap-2 sm:flex-row-reverse">
        <button
          type="button"
          onClick={() => void verify()}
          disabled={starting || (!hasCnic && !both)}
          className="flex min-h-[44px] flex-1 items-center justify-center rounded-xl bg-tm-red px-4 text-xs font-bold text-white hover:bg-tm-red-hover disabled:opacity-60"
        >
          {starting ? 'Starting…' : 'Verify'}
        </button>
        <button
          type="button"
          onClick={onClose}
          className="flex min-h-[44px] flex-1 items-center justify-center rounded-xl border border-gray-200 px-4 text-xs font-bold text-slate-700"
        >
          Not now
        </button>
      </div>
    </>
  )

  if (hasCnic) {
    const approved = cnicState === 'approved'
    return (
      <div className="mt-3 space-y-4">
        <div className="flex flex-col gap-0.5 rounded-xl bg-tm-tint-green p-3 leading-tight text-tm-green-deep">
          <span className="text-xs font-bold">
            {approved ? 'CNIC approved' : 'CNIC being checked'}
          </span>
          <span className="text-[11px] font-semibold" lang="ur" dir="rtl">
            {approved ? 'شناختی کارڈ منظور ہو گیا' : 'شناختی کارڈ کی جانچ ہو رہی ہے'}
          </span>
        </div>
        <p className="flex flex-col leading-tight">
          <span className="text-xs font-semibold text-slate-700">
            Continue to become a verified tutor.
          </span>
          <span className="text-[11px] text-gray-500" lang="ur" dir="rtl">
            تصدیق شدہ ٹیوٹر بننے کے لیے آگے بڑھیں۔
          </span>
        </p>
        {buttons}
      </div>
    )
  }

  // No CNIC yet, or a rejected one — show the camera tiles (with the reason when
  // rejected, §2.4).
  return (
    <div className="mt-3 space-y-4">
      {cnicState === 'rejected' && rejectionReason && (
        <p className="rounded-xl bg-tm-tint-red p-3 text-[11px] font-semibold leading-relaxed text-tm-red">
          Your CNIC was not accepted: {rejectionReason}
        </p>
      )}
      {/* One line — what to do. Nothing about what verification is, or the fee. */}
      <p className="flex flex-col leading-tight">
        <span className="text-xs font-semibold text-slate-700">Upload your CNIC, front and back.</span>
        <span className="text-[11px] text-gray-500" lang="ur" dir="rtl">
          اپنا شناختی کارڈ اپلوڈ کریں — سامنے اور پیچھے
        </span>
      </p>

      {/* Front + back, side by side. Each fills with the real photo once taken. */}
      <div className="flex gap-3">
        <CnicCameraField
          side="front"
          label="Front"
          urdu="سامنے کا رخ"
          onUploaded={() => markDone('front')}
          onError={(m) => setError(m || null)}
        />
        <CnicCameraField
          side="back"
          label="Back"
          urdu="پچھلا رخ"
          onUploaded={() => markDone('back')}
          onError={(m) => setError(m || null)}
        />
      </div>

      <p className="text-[10px] leading-relaxed text-gray-500">
        Only our verification team sees it. Never on your profile.
      </p>

      {/* The apply-gate green box (owner PR): the capability verifying unlocks —
          applying. Not an outcome promise (no replies, students or income). */}
      <p className="flex flex-col gap-0.5 rounded-xl bg-tm-tint-green p-3 leading-tight text-tm-green-deep">
        <span className="text-xs font-bold">Once verified, you can apply to tuitions and jobs.</span>
        <span className="text-[11px] font-semibold" lang="ur" dir="rtl">
          تصدیق کے بعد آپ ٹیوشنز اور جابز کے لیے اپلائی کر سکتے ہیں۔
        </span>
      </p>

      {buttons}
    </div>
  )
}
