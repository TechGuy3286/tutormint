'use client'

import { useCallback, useEffect, useState } from 'react'
import { Phone, Mail, MessageCircle, Loader2, Eye } from 'lucide-react'
import { useUpgradeSheet } from '@/components/upgrade/UpgradeProvider'
import { submitSignal } from '@/lib/submit'
import { formatPkMobile } from '@/lib/phone'
import type { Gate } from '@/lib/gate'

// The tutor-only "Show phone & email" control (PR56).
//
// It NEVER holds a parent's contact until a reveal succeeds: on mount it fetches
// only a status (eligible / plan / reveals-left), and the phone/email arrive only
// in the POST response after the server has counted the reveal. Rendered on the
// parent card, the tuition page (real-parent tuitions) and the message thread.

type Status = {
  eligible: boolean
  plan: 'basic' | 'premium' | 'featured' | null
  remaining: number | null
  alreadyRevealed: boolean
  reason?: string
  gate?: Gate
}

type Contact = { phone: string | null; email: string | null }

export default function ContactReveal({
  parentId,
  className,
}: {
  parentId: string
  className?: string
}) {
  const upgradeSheet = useUpgradeSheet()
  const [status, setStatus] = useState<Status | null>(null)
  const [contact, setContact] = useState<Contact | null>(null)
  const [remaining, setRemaining] = useState<number | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let live = true
    fetch(`/api/contact/reveal?parentId=${encodeURIComponent(parentId)}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((d: Status | null) => {
        if (live && d) {
          setStatus(d)
          setRemaining(d.remaining)
        }
      })
      .catch(() => {})
    return () => {
      live = false
    }
  }, [parentId])

  const reveal = useCallback(async () => {
    setBusy(true)
    setError(null)
    try {
      const res = await fetch('/api/contact/reveal', {
        method: 'POST',
        signal: submitSignal(),
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ parentId }),
      })
      const json = await res.json().catch(() => ({}))
      if (!res.ok) {
        // A verify or upgrade gate opens the one sheet; anything else is a plain
        // message.
        if (json.gate && upgradeSheet?.showGate) upgradeSheet.showGate(json.gate)
        else setError(json.error ?? 'Could not show contact details.')
        return
      }
      setContact(json.contact as Contact)
      setRemaining((json.remaining as number | null) ?? null)
    } catch {
      setError('Could not show contact details. Please try again.')
    } finally {
      setBusy(false)
    }
  }, [parentId, upgradeSheet])

  // Nothing to show: not a tutor, not eligible, or reveals turned off. The
  // verify case still shows a button (it opens the verify sheet on click).
  if (!status || (!status.eligible && status.reason !== 'verify')) return null

  const isBasic = status.plan === 'basic'

  if (contact) {
    return (
      <div className={`space-y-1.5 ${className ?? ''}`}>
        {contact.phone && (
          <div className="flex flex-wrap items-center gap-3 text-xs font-bold text-tm-navy">
            <a href={`tel:${contact.phone}`} className="inline-flex items-center gap-1.5 hover:underline">
              <Phone size={14} aria-hidden />
              {formatPkMobile(contact.phone)}
            </a>
            <a
              href={`https://wa.me/${contact.phone}`}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1.5 text-tm-green-deep hover:underline"
            >
              <MessageCircle size={14} aria-hidden />
              WhatsApp
            </a>
          </div>
        )}
        {contact.email && (
          <a
            href={`mailto:${contact.email}`}
            className="inline-flex items-center gap-1.5 text-xs font-bold text-tm-navy hover:underline"
          >
            <Mail size={14} aria-hidden />
            {contact.email}
          </a>
        )}
        {isBasic && remaining !== null && (
          <p className="text-[11px] text-gray-500">{remaining} of 5 left this month</p>
        )}
      </div>
    )
  }

  return (
    <div className={`flex flex-wrap items-center gap-2 ${className ?? ''}`}>
      <button
        type="button"
        onClick={reveal}
        disabled={busy}
        className="inline-flex min-h-[44px] items-center justify-center gap-1.5 rounded-xl border border-tm-navy/30 px-4 text-xs font-bold text-tm-navy transition-colors hover:bg-tm-tint-navy disabled:opacity-50"
      >
        {busy ? <Loader2 size={14} className="animate-spin" aria-hidden /> : <Eye size={14} aria-hidden />}
        Show phone &amp; email
      </button>
      {isBasic && remaining !== null && (
        <span className="text-[11px] text-gray-500">{remaining} of 5 left this month</span>
      )}
      {error && <span className="text-[11px] font-bold text-tm-red">{error}</span>}
    </div>
  )
}
