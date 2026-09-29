'use client'

import { useCallback, useState } from 'react'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { Loader2 } from 'lucide-react'
import { useUpgradeSheet } from '@/components/upgrade/UpgradeProvider'
import { submitSignal } from '@/lib/submit'
import { goCompleteProfile } from '@/lib/gatedFetch'
import { formatPkMobile } from '@/lib/phone'

// The inline "View number" affordance (PR91 Part A/B) that sits after a masked
// tuition sentence — a plain text link, same size as the sentence, not a button.
//
//   * a guest → "Sign up first to view numbers" (English + Urdu) + a sign-up link
//   * a signed-in tutor → the pool reveal: POST /api/contact/reveal { jobId },
//     which spends ONE pool unit (once per tuition) and returns the number(s) and
//     email(s) written in the listing plus the contact field. On a gate it opens
//     the upgrade sheet; on an unfinished profile it routes to onboarding.
//
// It never holds a number until the reveal succeeds server-side.

type RevealedContact = {
  phone: string | null
  whatsapp: string | null
  email: string | null
  textPhones?: string[]
  textEmails?: string[]
}

export default function ViewNumberLink({
  jobId,
  signedIn,
  canReveal,
  initialContact = null,
}: {
  jobId: string
  /** Whether a session exists at all. */
  signedIn: boolean
  /** Whether this viewer is a tutor (only a tutor can reveal). */
  canReveal: boolean
  /** PR92 Part A.3: when the viewer already has access, the full contact is
   *  passed in and shown directly — no "View number" link, no spend. */
  initialContact?: RevealedContact | null
}) {
  const pathname = usePathname()
  const upgradeSheet = useUpgradeSheet()
  const [state, setState] = useState<'idle' | 'busy' | 'guest'>('idle')
  const flatten = (c: RevealedContact | null) =>
    c
      ? {
          phones: Array.from(new Set([c.phone, c.whatsapp, ...(c.textPhones ?? [])].filter((x): x is string => !!x))),
          emails: Array.from(new Set([c.email, ...(c.textEmails ?? [])].filter((x): x is string => !!x))),
        }
      : null
  const initial = flatten(initialContact)
  const [phones, setPhones] = useState<string[] | null>(initial?.phones ?? null)
  const [emails, setEmails] = useState<string[]>(initial?.emails ?? [])
  const [error, setError] = useState<string | null>(null)

  const reveal = useCallback(async () => {
    if (!signedIn || !canReveal) {
      setState('guest')
      return
    }
    setState('busy')
    setError(null)
    try {
      const res = await fetch('/api/contact/reveal', {
        method: 'POST',
        signal: submitSignal(),
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ jobId }),
      })
      const json = await res.json().catch(() => ({}))
      if (!res.ok) {
        if (json.completeProfile) return goCompleteProfile()
        if (json.gate && upgradeSheet?.showGate) upgradeSheet.showGate(json.gate)
        else setError(json.error ?? 'Could not show the number.')
        setState('idle')
        return
      }
      const c = (json.contact ?? {}) as RevealedContact
      const p = [c.phone, c.whatsapp, ...(c.textPhones ?? [])].filter((x): x is string => !!x)
      const e = [c.email, ...(c.textEmails ?? [])].filter((x): x is string => !!x)
      setPhones(Array.from(new Set(p)))
      setEmails(Array.from(new Set(e)))
      setState('idle')
    } catch {
      setError('Could not show the number.')
      setState('idle')
    }
  }, [signedIn, canReveal, jobId, upgradeSheet])

  if (phones) {
    const parts = [...phones.map(formatPkMobile), ...emails]
    return <span className="font-bold text-tm-navy">{parts.join(' · ') || 'No number on file'}</span>
  }

  if (state === 'guest') {
    const next = encodeURIComponent(pathname || '/')
    return (
      <span className="text-tm-navy">
        <Link href={`/login?next=${next}`} className="font-bold text-tm-red hover:underline">
          Sign up first to view numbers
        </Link>
        <span lang="ur" dir="rtl" className="ms-1 text-gray-500">
          نمبر دیکھنے کے لیے پہلے سائن اپ کریں
        </span>
      </span>
    )
  }

  return (
    <>
      <button
        type="button"
        onClick={reveal}
        disabled={state === 'busy'}
        className="inline-flex items-center gap-1 font-bold text-tm-red hover:underline disabled:opacity-50"
      >
        {state === 'busy' && <Loader2 size={12} className="animate-spin" aria-hidden />}
        View number
      </button>
      {error && <span className="ms-1 text-tm-red">{error}</span>}
    </>
  )
}
