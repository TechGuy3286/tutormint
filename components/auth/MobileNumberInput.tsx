'use client'

import { normalisePkMobile } from '@/lib/phone'

// The ONE shared mobile-number input (PR82), used on every member surface that
// asks for a Pakistani mobile: the onboarding contact step, forgot-password,
// add/verify-mobile in tutor and parent Settings, and parent verification.
//
// It accepts 03xxxxxxxxx and the +92 / 0092 forms; validity is normalisePkMobile
// — the SAME normalisation the server uses — so what a member types maps to one
// MSISDN everywhere and the format check never disagrees with the backend. tel
// keypad on phones. Controlled: the surface owns the value and its "send" action.

export const MOBILE_HINT = 'Enter a Pakistani mobile number like 0300 1234567.'
export const MOBILE_HINT_UR = 'پاکستانی موبائل نمبر درج کریں، جیسے 0300 1234567۔'

/** True when the value normalises to a Pakistani MSISDN (the one format check). */
export function isValidPkMobile(v: string): boolean {
  return !!normalisePkMobile(v)
}

export default function MobileNumberInput({
  value,
  onChange,
  disabled = false,
  readOnly = false,
  required = false,
  id,
  name,
  ariaLabel = 'Mobile number',
  className,
}: {
  value: string
  onChange: (v: string) => void
  disabled?: boolean
  readOnly?: boolean
  required?: boolean
  id?: string
  name?: string
  ariaLabel?: string
  className?: string
}) {
  return (
    <input
      id={id}
      name={name}
      type="tel"
      inputMode="tel"
      autoComplete="tel"
      required={required}
      value={value}
      readOnly={readOnly}
      disabled={disabled}
      onChange={(e) => onChange(e.target.value)}
      placeholder="0300 1234567"
      aria-label={ariaLabel}
      className={
        className ??
        `min-h-[48px] w-full rounded-xl border border-gray-200 p-3 text-sm outline-none focus:border-tm-navy ${
          readOnly ? 'bg-gray-50 text-gray-500' : 'bg-white'
        }`
      }
    />
  )
}
