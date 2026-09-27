'use client'

import Link from 'next/link'
import { AlertCircle } from 'lucide-react'
import { GENERIC_ERROR, supportWhatsappHref } from '@/lib/errorMessages'

// One error block for every auth screen (PR75 §2): the plain English message,
// the Urdu line beneath it (same style as elsewhere), a "Sign in" link when the
// identifier is already taken, and — for the generic case — the reference code
// and a WhatsApp link. Nothing here shows database, SQL or stack text.

export default function AuthError({
  message,
  messageUr,
  ref,
  signIn = false,
}: {
  message: string
  /** The Urdu rendering; falls back to the generic Urdu when a ref is present. */
  messageUr?: string | null
  ref?: string | null
  signIn?: boolean
}) {
  if (!message) return null
  const ur = messageUr || (ref ? GENERIC_ERROR.ur : '')
  return (
    <div role="alert" className="space-y-1.5 rounded-xl border border-tm-red/30 bg-tm-tint-red p-3 text-xs text-tm-red">
      <p className="flex items-start gap-1.5 font-semibold">
        <AlertCircle aria-hidden size={14} className="mt-px shrink-0" />
        <span>{message}</span>
      </p>
      {ur && (
        <p lang="ur" dir="rtl" className="font-semibold leading-relaxed">
          {ur}
        </p>
      )}
      {signIn && (
        <Link href="/login" className="inline-block font-black underline">
          Sign in
        </Link>
      )}
      {ref && (
        <p className="text-[11px] text-tm-red/80">
          Ref: <span className="font-mono">{ref}</span>{' '}
          <a href={supportWhatsappHref(ref)} target="_blank" rel="noopener noreferrer" className="underline">
            WhatsApp support
          </a>
        </p>
      )}
    </div>
  )
}
