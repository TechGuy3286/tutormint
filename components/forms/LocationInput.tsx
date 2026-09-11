'use client'

import type { ReactNode } from 'react'

// A city / area picker that OFFERS the curated list but ACCEPTS free text
// (owner, 11 Sep 2026). 23 cities do not cover Pakistan, so a member whose
// locality is not listed types their own and it round-trips as a plain string —
// never blocked, never discarded. A native <datalist> gives both at once: the
// curated names as suggestions, and any typed value preserved verbatim.
//
// Used for every city/area field on the platform (the shared job form, browse
// filters, tutor profile completion and settings, parent settings), so there is
// one control and one source.

export default function LocationInput({
  id,
  label,
  value,
  onChange,
  options,
  placeholder,
  icon,
  disabled,
  required,
}: {
  id: string
  /** Names the control for assistive tech; the placeholder shows the same word. */
  label: string
  value: string
  onChange: (value: string) => void
  /** The curated suggestions. Free text outside this list is still accepted. */
  options: string[]
  placeholder?: string
  icon?: ReactNode
  disabled?: boolean
  required?: boolean
}) {
  return (
    <label className="space-y-1">
      <span className="sr-only">{label}</span>
      <div className="relative">
        {icon && (
          <span
            aria-hidden
            className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-gray-500"
          >
            {icon}
          </span>
        )}
        <input
          list={`${id}-options`}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={placeholder ?? label}
          disabled={disabled}
          required={required}
          // The datalist is the suggestion source; the browser's own history
          // must not compete with it.
          autoComplete="off"
          className={`min-h-[44px] w-full rounded-xl border border-gray-200 bg-white ${
            icon ? 'pl-9' : 'px-3'
          } pr-3 text-xs font-semibold text-tm-navy outline-none focus:border-tm-red disabled:opacity-60`}
        />
        <datalist id={`${id}-options`}>
          {options.map((o) => (
            <option key={o} value={o} />
          ))}
        </datalist>
      </div>
    </label>
  )
}
