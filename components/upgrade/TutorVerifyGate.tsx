'use client'

import { useCallback, useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { Loader2, RefreshCw } from 'lucide-react'

import CnicCapture, { cnicChecklistItems, type CnicCaptureState } from '@/components/identity/CnicCapture'
import { ChecklistStatus } from '@/components/forms/FormChecklist'
import { armEscape, STUCK_MESSAGE, submitJson } from '@/lib/submit'
import SubmitEscape from '@/components/SubmitEscape'
import FriendlyPaymentError from '@/components/ui/FriendlyPaymentError'
import CheckoutClosedNotice from '@/components/ui/CheckoutClosedNotice'
import Link from 'next/link'
import ManualPayDetails from '@/components/payments/ManualPayDetails'
import type { ManualInstructions } from '@/lib/payments/provider'
import type { IdentityState } from '@/lib/identity'
import { DEFAULT_CHECKOUT_METHODS, type CheckoutMethods } from '@/lib/payments/gatewaySettingsCore'

// The verification gate an UNVERIFIED tutor meets when they tap Apply (owner,
// 15 Sep 2026). Deliberately minimal — a tutor on a phone does not read paragraphs.
//
// It reads the CNIC review state first (owner PR6 §2): a tutor who has ALREADY
// submitted (or had approved) their CNIC is never shown the camera tiles again —
// they go straight to the payment step. The tiles appear only when there is no
// CNIC on file yet, or a submission was rejected (then with the reason).
//
//   * CNIC not submitted / rejected → the shared CnicCapture (number + FRONT and
//     BACK tiles + checklist, PR81), then Verify (enabled once it is complete),
//   * CNIC submitted / approved → a status line and a single Verify button
//     straight to the payment page,
//   * "Verify" routes to the payment page and does nothing else — NO price here.
//
// The images save to the tutor's profile automatically (kind 'cnic' — the private
// identity-docs bucket; never re-uploaded elsewhere, never shown publicly).


export default function TutorVerifyGate({
  onClose,
  // PR78 §D: in the onboarding flow there is NO "Not now" (no skip — the fee step
  // is the last step and stays until paid; the tutor leaves via the site nav). In
  // the upgrade-sheet MODAL the dismiss is needed, so it defaults on.
  showDismiss = true,
  // PR106-E §1/§2 — the manual account details (from app_settings, one source) and
  // a "Pay later" link to the dashboard. Passed by the onboarding flow; absent in
  // the upgrade sheet (then the bank line links to /pay/manual without numbers).
  manual = null,
  payLaterHref,
  // PR106-G4b §3 — owner/staff (switch "Staff only") hide the bank/manual
  // transfer and the "Pay later" link on every payment surface. Default false
  // keeps today's screen unchanged for everyone else.
  hideManual = false,
  // Payment gateways (owner, 6 Oct 2026, item 19): which options the owner has
  // switched on. Bank transfer and "Pay later" show ONLY when on; with online
  // payment off, Verify goes to bank transfer. The checkout route enforces the
  // same switches on the server.
  methods = DEFAULT_CHECKOUT_METHODS,
}: {
  onClose: () => void
  showDismiss?: boolean
  manual?: ManualInstructions | null
  payLaterHref?: string
  hideManual?: boolean
  methods?: CheckoutMethods
}) {
  // `hideManual` (owner/staff) can still hide the transfer; the owner's switch
  // decides it for everyone else.
  const showTransfer = methods.bankTransfer && !hideManual
  const showPayLater = methods.payLater && !hideManual
  const router = useRouter()
  const [cap, setCap] = useState<CnicCaptureState | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [closed, setClosed] = useState(false)
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


  async function start(method?: 'transfer') {
    setStarting(true)
    setError(null)
    setClosed(false)
    // The one-time fee is a checkout for the 'verified' fee marker (Rs 199).
    // No method → the normal online (PayPro) option; 'transfer' → bank transfer
    // (the second option, activated after staff approval). PR106-C0 §2.
    const { ok, data, error: failed } = await submitJson<{ mode?: string; url?: string; next?: string; code?: string }>(
      '/api/payments/checkout',
      { planCode: 'verified', ...(method ? { method } : {}) },
    )
    if (!ok || !data) {
      // Online card isn't open for this account yet (PR106-G2 §0) → go straight
      // to the always-available bank transfer rather than showing an error.
      if (data?.code === 'use_transfer' && method !== 'transfer' && showTransfer) {
        setStarting(false)
        void start('transfer')
        return
      }
      // Checkout not open to this account yet (403) → its own plain notice.
      if (data?.code === 'checkout_closed') {
        setClosed(true)
        setStarting(false)
        return
      }
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
      {closed && <CheckoutClosedNotice />}
      {error && (
        <div className="space-y-2">
          {/* Never show raw error text on the payment/verify flow (PR66 §2). */}
          {stuck ? <SubmitEscape href={stuck} /> : <FriendlyPaymentError />}
        </div>
      )}
      <div className="flex flex-col gap-2 sm:flex-row-reverse">
        <button
          type="button"
          onClick={() => void start(methods.online ? undefined : 'transfer')}
          disabled={starting || (!hasCnic && !cap?.ready)}
          className="flex min-h-[44px] flex-1 items-center justify-center rounded-xl bg-tm-red px-4 text-xs font-bold text-white hover:bg-tm-red-hover disabled:opacity-60"
        >
          {starting ? 'Starting…' : 'Verify'}
        </button>
        {showDismiss && (
          <button
            type="button"
            onClick={onClose}
            className="flex min-h-[44px] flex-1 items-center justify-center rounded-xl border border-gray-200 px-4 text-xs font-bold text-slate-700"
          >
            Not now
          </button>
        )}
      </div>
      {/* Manual payment — the account details (one source: app_settings) directly
          below the PayPro button, with "Pay by bank transfer" to submit proof and
          the plain activation line (PR106-E §2). The online option above is
          instant; a transfer is checked by staff first. PR106-G4b §3: hidden for
          owner/staff, who go straight to PayPro. */}
      {showTransfer && methods.online && (manual ? (
        <ManualPayDetails instructions={manual} onTransfer={() => void start('transfer')} />
      ) : (
        <button
          type="button"
          onClick={() => void start('transfer')}
          disabled={starting || (!hasCnic && !cap?.ready)}
          className="min-h-[40px] w-full text-center text-[11px] font-bold text-tm-navy underline-offset-2 hover:underline disabled:opacity-60"
        >
          Or pay by bank transfer
          <span lang="ur" dir="rtl" className="ms-1.5 font-semibold text-gray-500">یا بینک ٹرانسفر سے ادائیگی کریں</span>
        </button>
      ))}

      {/* PR106-E §1 — Pay later returns to the dashboard with nothing lost.
          PR106-G4b §3: hidden for owner/staff. */}
      {showPayLater && payLaterHref && (
        <Link href={payLaterHref} className="block min-h-[40px] text-center text-[11px] font-bold text-gray-500 underline-offset-2 hover:underline">
          Pay later
          <span lang="ur" dir="rtl" className="ms-1.5 font-semibold">بعد میں ادائیگی کریں</span>
        </Link>
      )}
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
        <span className="text-xs font-semibold text-slate-700">Enter your CNIC, front and back.</span>
        <span className="text-[11px] text-gray-500" lang="ur" dir="rtl">
          اپنا شناختی کارڈ درج کریں — سامنے اور پیچھے
        </span>
      </p>

      {/* The ONE shared CNIC entry (PR81) — number with auto-dashes + front/back
          tiles + the checklist, identical to onboarding and Settings. The verify
          gate keeps its own action: Verify → checkout (unchanged). */}
      <CnicCapture onState={setCap} />

      {/* The apply-gate green box (owner PR): the capability verifying unlocks —
          applying. Not an outcome promise (no replies, students or income). */}
      <p className="flex flex-col gap-0.5 rounded-xl bg-tm-tint-green p-3 leading-tight text-tm-green-deep">
        <span className="text-xs font-bold">Once verified, you can apply to tuitions and jobs.</span>
        <span className="text-[11px] font-semibold" lang="ur" dir="rtl">
          تصدیق کے بعد آپ ٹیوشنز اور جابز کے لیے اپلائی کر سکتے ہیں۔
        </span>
      </p>

      {buttons}
      {cap && <ChecklistStatus items={cnicChecklistItems(cap)} />}
    </div>
  )
}
