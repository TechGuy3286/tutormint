'use client'

import { useState } from 'react'
import { Check, Copy } from 'lucide-react'

// A small copy-to-clipboard affordance for admin lists (e.g. a member's mobile).
// It stops event propagation so it works when it sits over a "stretched link"
// card without triggering the card's navigation.

export default function CopyButton({
  text,
  label = 'value',
  className = '',
}: {
  text: string
  label?: string
  className?: string
}) {
  const [done, setDone] = useState(false)

  return (
    <button
      type="button"
      onClick={(e) => {
        e.preventDefault()
        e.stopPropagation()
        navigator.clipboard
          ?.writeText(text)
          .then(() => {
            setDone(true)
            setTimeout(() => setDone(false), 1500)
          })
          .catch(() => {})
      }}
      aria-label={done ? `Copied ${label}` : `Copy ${label}`}
      title={done ? 'Copied' : `Copy ${label}`}
      className={`relative z-10 inline-flex h-8 w-8 items-center justify-center rounded-lg border border-gray-200 bg-white text-gray-500 transition-colors hover:border-tm-navy hover:text-tm-navy ${className}`}
    >
      {done ? (
        <Check aria-hidden size={13} className="text-tm-green-deep" />
      ) : (
        <Copy aria-hidden size={13} />
      )}
    </button>
  )
}
