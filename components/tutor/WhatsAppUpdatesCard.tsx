'use client'

import { useEffect, useState } from 'react'

import { useToast } from '@/components/ui/Toast'

// "Send me updates on WhatsApp" (PR-06, owner 18 Nov 2026) — Edit Profile →
// Account. On by default. Off: our team stops sending you WhatsApp updates
// (a parent opened your application, your weekly summary); the updates in your
// notifications still show. Saved and logged by /api/tutor/whatsapp-updates.

export default function WhatsAppUpdatesCard() {
  const toast = useToast()
  const [on, setOn] = useState<boolean | null>(null)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    let live = true
    void (async () => {
      try {
        const r = await fetch('/api/tutor/whatsapp-updates', { cache: 'no-store' })
        const j = (await r.json().catch(() => ({}))) as { on?: boolean }
        if (live) setOn(r.ok ? j.on !== false : true)
      } catch {
        if (live) setOn(true)
      }
    })()
    return () => {
      live = false
    }
  }, [])

  const flip = async () => {
    if (busy || on === null) return
    const next = !on
    setBusy(true)
    try {
      const r = await fetch('/api/tutor/whatsapp-updates', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ on: next }),
      })
      const j = (await r.json().catch(() => ({}))) as { on?: boolean; error?: string }
      if (!r.ok) {
        toast.error(j.error ?? 'That did not save. Please try again.')
        return
      }
      setOn(j.on !== false)
      toast.success(next ? 'WhatsApp updates are on.' : 'WhatsApp updates are off. You will still see updates in your notifications.')
    } catch {
      toast.error('We could not reach TutorMint. Check your internet connection and try again.')
    } finally {
      setBusy(false)
    }
  }

  const checked = on !== false
  return (
    <div className="space-y-2" data-whatsapp-updates="">
      <label className="flex min-h-[44px] cursor-pointer items-center justify-between gap-3">
        <span className="text-sm font-bold text-tm-navy">Send me updates on WhatsApp</span>
        <button
          type="button"
          role="switch"
          aria-checked={checked}
          aria-label="Send me updates on WhatsApp"
          disabled={busy || on === null}
          onClick={() => void flip()}
          className={`relative inline-flex h-7 w-12 shrink-0 items-center rounded-full transition-colors disabled:opacity-60 ${checked ? 'bg-tm-green-deep' : 'bg-slate-300'}`}
        >
          <span className={`inline-block h-5 w-5 rounded-full bg-white shadow transition-transform ${checked ? 'translate-x-6' : 'translate-x-1'}`} />
        </button>
      </label>
      <p className="text-xs leading-relaxed text-slate-700">
        Our team sends you a short WhatsApp when a parent opens your application, and your weekly summary. Turn this off to stop them — you will
        still see updates in your notifications.
      </p>
    </div>
  )
}
