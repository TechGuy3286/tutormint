'use client'

import { useId, useState } from 'react'
import { Eye, EyeOff } from 'lucide-react'

// The one password field on the platform, so the show/hide eye is built once
// and behaves identically on register, login, forgot-password and the forced
// change screen (owner, Sunday 6 Sep — "an eye on EVERY password field").
//
// It forwards every standard input prop, so a caller styles it exactly as it
// styled its old <input type="password">: pass the same `className`. The eye is
// an overlay button inside the field's right padding, 44px, never submits the
// form (type="button"), and toggles the input between password and text. The
// toggle is per-field local state — a shown password is never persisted.

type Props = Omit<React.InputHTMLAttributes<HTMLInputElement>, 'type'> & {
  /** Extra padding-right is added for the eye; pass the field's own classes. */
  className?: string
}

export default function PasswordInput({ className = '', ...rest }: Props) {
  const [shown, setShown] = useState(false)
  const labelId = useId()

  return (
    <div className="relative">
      <input
        {...rest}
        type={shown ? 'text' : 'password'}
        // Leave room for the eye so a long password never slides under it.
        className={`${className} pr-11`}
      />
      <button
        type="button"
        onClick={() => setShown((s) => !s)}
        aria-label={shown ? 'Hide password' : 'Show password'}
        aria-pressed={shown}
        title={shown ? 'Hide password' : 'Show password'}
        id={labelId}
        className="absolute inset-y-0 right-0 flex h-full w-11 items-center justify-center text-gray-500 hover:text-tm-navy"
        // Keep it off the tab order between the field and the submit button —
        // it is a convenience, not a step in the form.
        tabIndex={-1}
      >
        {shown ? <EyeOff aria-hidden size={16} /> : <Eye aria-hidden size={16} />}
      </button>
    </div>
  )
}
