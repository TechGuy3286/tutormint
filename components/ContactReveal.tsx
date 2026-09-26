'use client'

import { useCallback, useEffect, useState } from 'react'
import { Phone, Mail, MessageCircle, MapPin, Globe, Loader2, Eye } from 'lucide-react'
import { useUpgradeSheet } from '@/components/upgrade/UpgradeProvider'
import { submitSignal } from '@/lib/submit'
import { formatPkMobile } from '@/lib/phone'
import type { Gate } from '@/lib/gate'

// The tutor-only "Show phone & email" control (PR56 parent card / thread /
// real-parent tuition; PR57 staff-posted tuition).
//
// It NEVER holds a contact until a reveal succeeds: on mount it fetches only a
// status (eligible / plan / reveals-left), and the phone/email arrive only in
// the POST response after the server has counted the reveal. Pass exactly one of
// parentId (a real parent account) or jobId (a staff-posted tuition's job
// contact).

type Status = {
  eligible: boolean
  plan: 'basic' | 'premium' | 'featured' | null
  remaining: number | null
  alreadyRevealed: boolean
  reason?: string
  gate?: Gate
}

type Contact = {
  phone: string | null
  whatsapp: string | null
  email: string | null
  name: string | null
  address: string | null
  social: string | null
}

export default function ContactReveal({
  parentId,
  jobId,
  className,
}: {
  parentId?: string
  jobId?: string
  className?: string
}) {
  const upgradeSheet = useUpgradeSheet()
  const [status, setStatus] = useState<Status | null>(null)
  const [contact, setContact] = useState<Contact | null>(null)
  const [remaining, setRemaining] = useState<number | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const target = jobId ? { jobId } : { parentId }

  useEffect(() => {
    let live = true
    const qs = jobId ? `jobId=${encodeURIComponent(jobId)}` : `parentId=${encodeURIComponent(parentId ?? '')}`
    fetch(`/api/contact/reveal?${qs}`)
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
  }, [parentId, jobId])

  const reveal = useCallback(async () => {
    setBusy(true)
    setError(null)
    try {
      const res = await fetch('/api/contact/reveal', {
        method: 'POST',
        signal: submitSignal(),
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(target),
      })
      const json = await res.json().catch(() => ({}))
      if (!res.ok) {
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
    // target is derived from the stable props above
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [parentId, jobId, upgradeSheet])

  if (!status || (!status.eligible && status.reason !== 'verify')) return null

  // Basic and Premium both show a monthly counter ("N of 5 / 120 left"); Featured
  // is unlimited and shows none.
  const showCounter = status.plan === 'basic' || status.plan === 'premium'
  const capText = status.plan === 'premium' ? 120 : 5
  const social = contact?.social
  const socialHref = social && /^https?:\/\//i.test(social) ? social : null
  // A separate WhatsApp link only when the WhatsApp number differs from phone.
  const waNumber = contact?.whatsapp && contact.whatsapp !== contact.phone ? contact.whatsapp : null

  if (contact) {
    return (
      <div className={`space-y-1.5 ${className ?? ''}`}>
        {contact.name && <p className="text-sm font-black text-tm-navy">{contact.name}</p>}
        {contact.phone && (
          <div className="flex flex-wrap items-center gap-3 text-xs font-bold text-tm-navy">
            <a href={`tel:+${contact.phone}`} className="inline-flex items-center gap-1.5 hover:underline">
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
        {waNumber && (
          <a
            href={`https://wa.me/${waNumber}`}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1.5 text-xs font-bold text-tm-green-deep hover:underline"
          >
            <MessageCircle size={14} aria-hidden />
            WhatsApp {formatPkMobile(waNumber)}
          </a>
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
        {contact.address && (
          <p className="inline-flex items-start gap-1.5 text-xs font-semibold text-tm-navy">
            <MapPin size={14} aria-hidden className="mt-0.5 shrink-0" />
            {contact.address}
          </p>
        )}
        {social && (
          <p className="inline-flex items-start gap-1.5 text-xs font-semibold text-tm-navy">
            <Globe size={14} aria-hidden className="mt-0.5 shrink-0" />
            {socialHref ? (
              <a href={socialHref} target="_blank" rel="noopener noreferrer nofollow" className="underline break-all">
                {social}
              </a>
            ) : (
              <span className="break-all">{social}</span>
            )}
          </p>
        )}
        {showCounter && remaining !== null && (
          <p className="text-[11px] text-gray-500">{remaining} of {capText} left this month</p>
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
      {showCounter && remaining !== null && (
        <span className="text-[11px] text-gray-500">{remaining} of {capText} left this month</span>
      )}
      {error && <span className="text-[11px] font-bold text-tm-red">{error}</span>}
    </div>
  )
}
