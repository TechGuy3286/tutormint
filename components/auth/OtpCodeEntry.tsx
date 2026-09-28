'use client'

import { type ReactNode } from 'react'
import { ShieldCheck } from 'lucide-react'
import SubmitEscape from '@/components/SubmitEscape'
import { supportWhatsappHref } from '@/lib/errorMessages'

// The ONE shared SMS code (OTP) entry (PR82), used on every member surface that
// enters a code from an SMS: the onboarding contact step, the verify-phone gate
// (authenticated and pre-auth), forgot-password reset, and add/verify-mobile in
// tutor and parent Settings and parent verification.
//
// It owns exactly the parts that were duplicated (or had drifted) across those
// surfaces:
//   • the 6-digit input — numeric keypad, paste + SMS auto-fill
//     (autocomplete="one-time-code"), and the one sanitiser (digits only, max 6),
//   • the Verify button (its label varies — "Verify", "Verify and continue",
//     "Set new password" — but the styling, the icon and the "< 6 digits / busy /
//     locked" disable rule are the same everywhere),
//   • the "Use a different number" link,
//   • the inline error block — the SAME treatment for a wrong-code / attempts-left
//     / locked message. Those strings all come from lib/otp (server-side), so the
//     component renders whatever the surface passes and never invents copy.
//
// It does NOT own the flow: each surface keeps its own endpoint, its send/verify
// handlers, its rate-limit and one-code-for-life rules, and any surrounding fields
// (a new password on reset) via `children`. Enter submits (it wraps a <form>).

export const OTP_LENGTH = 6

/** The one sanitiser for an SMS code: digits only, at most six. */
export function sanitiseOtp(v: string): string {
  return v.replace(/\D/g, '').slice(0, OTP_LENGTH)
}

/** The shared inline error block for code entry: the English message, the Urdu
 *  line, the reference + WhatsApp support link, the "stuck" escape, and an extra
 *  slot (e.g. a "Start over" link on a terminal pre-auth state). Rendered by
 *  OtpCodeEntry, and exported for surfaces that show it without the input (a
 *  terminal state where the field is gone). */
export function OtpErrorBlock({
  error,
  errorUr,
  errorRef,
  stuckHref,
  children,
}: {
  error?: string | null
  errorUr?: string | null
  errorRef?: string | null
  stuckHref?: string | null
  children?: ReactNode
}) {
  if (!error) return null
  return (
    <div
      role="alert"
      className="space-y-2 rounded-xl border border-tm-red/30 bg-tm-tint-red p-3 text-center text-xs font-bold text-tm-red"
    >
      <p>{error}</p>
      {errorUr && (
        <p lang="ur" dir="rtl" className="leading-relaxed">
          {errorUr}
        </p>
      )}
      {errorRef && (
        <p className="text-[11px] font-normal text-tm-red/80">
          Ref: <span className="font-mono">{errorRef}</span>{' '}
          <a
            href={supportWhatsappHref(errorRef)}
            target="_blank"
            rel="noopener noreferrer"
            className="underline"
          >
            WhatsApp support
          </a>
        </p>
      )}
      {stuckHref && <SubmitEscape href={stuckHref} />}
      {children}
    </div>
  )
}

export default function OtpCodeEntry({
  code,
  onChange,
  onVerify,
  busy = false,
  locked = false,
  disabled = false,
  verifyLabel = 'Verify',
  busyLabel = 'Verifying…',
  label = '6-digit code',
  autoFocus = true,
  onDifferentNumber,
  children,
  error,
  errorUr,
  errorRef,
  stuckHref,
  errorExtra,
}: {
  code: string
  /** Receives the already-sanitised value (digits only, max 6). */
  onChange: (v: string) => void
  onVerify: () => void
  busy?: boolean
  /** Server told us the code is locked after five wrong attempts — disables Verify. */
  locked?: boolean
  /** An extra disable a surface may add (never loosens the < 6 / busy / locked rule). */
  disabled?: boolean
  verifyLabel?: string
  busyLabel?: string
  /** The label above the input; pass '' to hide it where surrounding text says it. */
  label?: string
  autoFocus?: boolean
  onDifferentNumber?: () => void
  /** Extra fields inside the same form (e.g. a new password on reset). */
  children?: ReactNode
  error?: string | null
  errorUr?: string | null
  errorRef?: string | null
  stuckHref?: string | null
  /** Extra content inside the error block (e.g. a "Start over" link). */
  errorExtra?: ReactNode
}) {
  const blocked = busy || locked || disabled || code.length < OTP_LENGTH

  return (
    <div className="space-y-4">
      <OtpErrorBlock error={error} errorUr={errorUr} errorRef={errorRef} stuckHref={stuckHref}>
        {errorExtra}
      </OtpErrorBlock>

      <form
        onSubmit={(e) => {
          e.preventDefault()
          if (!blocked) onVerify()
        }}
        className="space-y-4"
      >
        <div className="space-y-1">
          {label && (
            <label htmlFor="otp-code" className="text-xs font-bold text-tm-navy">
              {label}
            </label>
          )}
          <input
            id="otp-code"
            value={code}
            onChange={(e) => onChange(sanitiseOtp(e.target.value))}
            inputMode="numeric"
            autoComplete="one-time-code"
            autoFocus={autoFocus}
            placeholder="000000"
            aria-label="Verification code"
            className="min-h-[52px] w-full rounded-xl border border-gray-200 bg-tm-bg p-3 text-center text-2xl font-black tracking-[0.4em] text-tm-navy outline-none focus:border-tm-navy focus:bg-white"
          />
        </div>

        {children}

        <button
          type="submit"
          disabled={blocked}
          className="flex min-h-[48px] w-full items-center justify-center gap-2 rounded-xl bg-tm-red px-4 text-sm font-black text-white shadow-md transition-colors hover:bg-tm-red-hover disabled:opacity-50"
        >
          <ShieldCheck aria-hidden size={16} />
          {busy ? busyLabel : verifyLabel}
        </button>
      </form>

      {onDifferentNumber && (
        <button
          type="button"
          onClick={onDifferentNumber}
          className="flex min-h-[44px] w-full items-center justify-center px-1 text-xs font-bold text-tm-navy hover:underline"
        >
          Use a different number
        </button>
      )}
    </div>
  )
}
